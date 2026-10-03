import React, { useRef } from "react";
import { MaskPainter } from "./MaskPainter";
import { useComposerLayout } from "./useComposerLayout";
import { QuickModelSwitcher } from "./QuickModelSwitcher";
import { ProgressBar } from "./ProgressBar";
import { useProgressEvent } from "./ProgressContext";
import { NavIcon } from "./icons";
import { Tooltip, InfoHint } from "./Tooltip";
import { ImageDropInput } from "./ImageDropInput";
import { qualities } from "./useComposer";
import type { ComposerActions, ComposerState } from "./useComposer";
import { outpaintQuickRatios, ratioOptions, resolutionOptions } from "../lib/creative";
import { compositeFileKey } from "../lib/format";
import { decodeLayoutCode, encodeLayoutCode, moduleLabel, type LayoutMode } from "../lib/layout";
import { useDialog } from "./Dialogs";
import { useStudio } from "./StudioContext";
import { useCopyText } from "./useCopy";
import { useObjectUrl } from "./useObjectUrl";
import type { Mode } from "./types";

function ReferenceThumbnail({
  file,
  index,
  onCopy,
  onRemove,
}: {
  file: File;
  index: number;
  onCopy: (file: File) => void;
  onRemove: () => void;
}) {
  const src = useObjectUrl(file);
  return <div className="reference-item">
    <img src={src} alt={`参考图 ${index + 1}`} />
    <div><strong>参考图 {index + 1}</strong><Tooltip content={file.name}><span>{file.name}</span></Tooltip></div>
    <button type="button" onClick={() => onCopy(file)}>复制</button>
    <button type="button" className="remove-reference" onClick={onRemove} aria-label={`移除参考图 ${index + 1}`}><NavIcon name="x" size={14} /></button>
  </div>;
}

export function ComposerPanel({
  mode,
  projects,
  activeJobId,
  isEnqueueing,
  progress,
  composerState,
  composerActions,
  onOpenSettings,
}: {
  mode: Mode;
  projects: GalleryProject[];
  activeJobId: string;
  isEnqueueing: boolean;
  progress: AppProgress | null;
  composerState: ComposerState;
  composerActions: ComposerActions;
  onOpenSettings: () => void;
}) {
  const { projectId, setProjectId, tagsText, setTagsText, chatModel, roles, autoArchive, notify } = useStudio();
  const copyText = useCopyText(notify);
  // 增强 / 反推的进度事件（主进程在等待期推送；两者均为单例操作，id 固定）。
  const enhanceProgress = useProgressEvent("prompt-enhance");
  const reverseProgress = useProgressEvent("prompt-reverse");
  const {
    prompt,
    negativePrompt,
    originalPrompt,
    quality,
    resolution,
    ratio,
    n,
    customSizeEnabled,
    customSize,
    customCheck,
    image,
    externalMask,
    references,
    templates,
    selectedTemplate,
    selectedNegativeTemplate,
    reverseImage,
    reverseResult,
    reversing,
    outpaintStrategy,
    outpaintMargins,
    outpaintTargetSize,
    outpaintPreset,
    sourceDimensions,
    outpaintCheck,
    displaySize,
    heavyRequest,
    enhancing,
  } = composerState;
  const {
    setPrompt,
    setNegativePrompt,
    setQuality,
    setResolution,
    setRatio,
    setN,
    setCustomSizeEnabled,
    setCustomSize,
    setImage,
    setExternalMask,
    setReferences,
    maskChange,
    applyTemplate,
    applyNegativeTemplate,
    saveTemplate,
    deleteTemplate,
    optimizeLocal,
    enhanceOnline,
    reversePrompt,
    applyReversePrompt,
    setReverseImage,
    setReverseResult,
    addReferenceFiles,
    pasteReferenceImage,
    copyReferenceImage,
    chooseOutpaintPreset,
    setOutpaintStrategy,
    setOutpaintMargins,
    setOutpaintTargetSize,
    setOutpaintPreset,
    quickPreset,
    enqueue,
    cancelActive,
  } = composerActions;
  // 布局编辑（仅创作页三种模式；ComposerPanel 不会在 gallery/queue/settings 下渲染）。
  const layoutMode: LayoutMode = mode === "edit" ? "edit" : mode === "outpaint" ? "outpaint" : "generate";
  const modulesRef = useRef<HTMLDivElement | null>(null);
  const layout = useComposerLayout({ mode: layoutMode, containerRef: modulesRef });
  const { requestText, requestConfirm } = useDialog();

  /** 恢复默认布局（有损操作，需确认）：清除自定义位置并回到默认排列。 */
  const handleResetLayout = async () => {
    const confirmed = await requestConfirm({
      title: "恢复默认布局",
      message: "将清除自定义的模块位置、大小与隐藏设置，恢复为默认排列。此操作不可撤销，确定继续吗？",
      confirmLabel: "恢复默认",
      danger: true,
    });
    if (confirmed) layout.resetLayout();
  };

  /** 复制当前布局的分享码（只含通用模块的坐标与隐藏状态）。 */
  const handleCopyLayoutCode = async () => {
    if (!layout.snapshot) {
      notify("先调整布局，再复制分享码", true);
      return;
    }
    await copyText(encodeLayoutCode(layout.snapshot), "布局分享码已复制，可粘贴分享");
  };

  /** 导入分享码：只替换通用模块，专属模块与其余设置保持不动。 */
  const handleImportLayoutCode = async () => {
    const code = await requestText({
      title: "导入布局分享码",
      message: "粘贴布局分享码（ITL2；ITL1 旧码将按当前窗口近似换算）。导入只替换通用模块的位置与隐藏状态，专属模块保持不动。",
      confirmLabel: "导入",
    });
    if (!code?.trim()) return;
    const decoded = decodeLayoutCode(code, layout.colWidth);
    if (!decoded) {
      notify("分享码无效或已损坏", true);
      return;
    }
    layout.importSharedLayout(decoded);
    if (decoded.legacy) {
      notify("旧版分享码已按当前窗口换算，可能需要微调", true);
      return;
    }
    notify("布局已导入（通用模块已更新）");
  };

  /** 另存为新方案（复制当前布局）。 */
  const handleCreatePreset = async () => {
    const name = await requestText({ title: "保存为新方案", message: "为新方案取一个名字（当前布局会被复制）", confirmLabel: "保存" });
    if (!name?.trim()) return;
    layout.createPreset(name);
    notify(`已保存方案「${name.trim()}」`);
  };

  /** 重命名当前方案。 */
  const handleRenamePreset = async () => {
    const current = layout.presets.find((item) => item.id === layout.activePresetId);
    if (!current) return;
    const name = await requestText({ title: "重命名方案", message: "输入新的方案名称", defaultValue: current.name, confirmLabel: "重命名" });
    if (!name?.trim()) return;
    layout.renamePreset(current.id, name);
  };

  /** 删除当前方案（「默认」方案不可删除）。 */
  const handleDeletePreset = async () => {
    const current = layout.presets.find((item) => item.id === layout.activePresetId);
    if (!current || current.id === "default") return;
    const confirmed = await requestConfirm({
      title: "删除方案",
      message: `删除方案「${current.name}」？该方案保存的布局将丢失（不可撤销）。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (confirmed) layout.deletePreset(current.id);
  };

  return (
    <section className={layout.editing ? "card composer composer-editing" : "card composer"} data-tutorial="creation-form">
      <div className="mode-title">
        <div>
          <span className="eyebrow">{mode === "outpaint" ? "SMART OUTPAINT" : mode === "edit" ? "IMAGE EDIT" : "CREATE STUDIO"}</span>
          <Tooltip content={mode === "outpaint" ? "透明画布 + 自动蒙版" : mode === "edit" ? "原图 + 蒙版 + 参考图" : "提示词 + 参考图 + 队列"}>
            <h2>{mode === "outpaint" ? "智能扩展画面" : mode === "edit" ? "编辑与局部重绘" : "描述你想要的画面"}</h2>
          </Tooltip>
        </div>
        <div className="mode-title-side">
          <Tooltip content="自定义各模块的位置与大小">
            <button type="button" className={layout.editing ? "layout-toggle active" : "layout-toggle"} onClick={layout.toggleEditing}>
              {layout.editing ? "完成布局" : "调整布局"}
            </button>
          </Tooltip>
        </div>
      </div>

      {layout.editing && (
        <div className="layout-editor-bar">
          <span className="layout-edit-hint">
            <NavIcon name="move" size={14} /> 拖动移动 · 边角缩放 · × 隐藏
          </span>
          <div className="layout-editor-actions">
            <div className="layout-editor-group">
              <label className="layout-preset-select">
                方案
                <select value={layout.activePresetId} onChange={(event) => layout.switchPreset(event.target.value)}>
                  {layout.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </label>
              <Tooltip content="将当前布局另存为新方案">
                <button type="button" className="layout-tool-btn" onClick={() => void handleCreatePreset()}>
                  <NavIcon name="plus" size={14} />另存为
                </button>
              </Tooltip>
              <Tooltip content="重命名当前方案">
                <button type="button" className="layout-tool-btn" onClick={() => void handleRenamePreset()}>
                  <NavIcon name="pen-line" size={14} />重命名
                </button>
              </Tooltip>
              <Tooltip content="删除当前方案（默认方案不可删除）">
                <button type="button" className="layout-tool-btn danger" disabled={layout.activePresetId === "default"} onClick={() => void handleDeletePreset()}>
                  <NavIcon name="trash" size={14} />删除
                </button>
              </Tooltip>
            </div>
            <div className="layout-editor-group">
              <Tooltip content="撤销（Ctrl+Z）">
                <button type="button" className="layout-tool-btn" onClick={layout.undo} disabled={!layout.canUndo} aria-label="撤销">
                  <NavIcon name="undo" size={16} />
                </button>
              </Tooltip>
              <Tooltip content="重做（Ctrl+Shift+Z / Ctrl+Y）">
                <button type="button" className="layout-tool-btn" onClick={layout.redo} disabled={!layout.canRedo} aria-label="重做">
                  <NavIcon name="redo" size={16} />
                </button>
              </Tooltip>
              <Tooltip content="复制当前布局的分享码">
                <button type="button" className="layout-tool-btn" onClick={() => void handleCopyLayoutCode()}>
                  <NavIcon name="copy" size={14} />复制分享码
                </button>
              </Tooltip>
              <Tooltip content="粘贴布局分享码并导入">
                <button type="button" className="layout-tool-btn" onClick={() => void handleImportLayoutCode()}>
                  <NavIcon name="download" size={14} />导入分享码
                </button>
              </Tooltip>
            </div>
            {layout.hiddenIds.length > 0 && (
              <div className="layout-editor-group layout-hidden-panel">
                <span>已隐藏 {layout.hiddenIds.length} 个：</span>
                {layout.hiddenIds.map((id) => (
                  <Tooltip key={id} content="恢复显示该模块">
                    <button type="button" className="layout-hidden-restore" onClick={() => layout.showModule(id)}>
                      {moduleLabel(id)} ↺
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
            <Tooltip content="清除自定义布局并恢复默认排列（需确认）">
              <button type="button" className="layout-reset" onClick={() => void handleResetLayout()}>恢复默认布局</button>
            </Tooltip>
          </div>
        </div>
      )}

      <div ref={modulesRef} className={layout.modulesClassName} style={layout.modulesStyle}>
      <div className="project-strip" data-layout-id="project-strip" {...layout.dataFlagsOf("project-strip")} style={layout.styleOf("project-strip")}>
        <label>归属项目
          <Tooltip content="默认归档到收件箱，可随时批量移动。">
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </Tooltip>
        </label>
        <label>标签
          <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="例如：海报，蓝粉，产品" />
        </label>
      </div>

      <section className="prompt-panel" data-layout-id="prompt" {...layout.dataFlagsOf("prompt")} style={layout.styleOf("prompt")}>
        <div className="prompt-head">
          <strong>提示词 <InfoHint content="正向描述画面；可保存为模板复用。" /></strong>
          <div className="prompt-template-actions">
            <select value={selectedTemplate} onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">选择模板…</option>
              {templates.filter((item) => item.kind === "positive").map((item) => <option key={item.id} value={item.id}>[{item.category}] {item.title}</option>)}
            </select>
            <button onClick={() => void saveTemplate("positive")}>保存为模板</button>
            {selectedTemplate && !templates.find((item) => item.id === selectedTemplate)?.builtin && (
              <>
                <button onClick={() => void saveTemplate("positive", true)}>更新模板</button>
                <button onClick={() => void deleteTemplate("positive")}>删除模板</button>
              </>
            )}
          </div>
        </div>
        <div className="prompt-assistant">
          <button onClick={() => optimizeLocal("refine")}>精炼主体</button>
          <button onClick={() => optimizeLocal("detail")}>强化细节</button>
          <button onClick={() => optimizeLocal("poster")}>海报化</button>
          <button onClick={() => optimizeLocal("social")}>社媒化</button>
          <button onClick={() => optimizeLocal("realistic")}>更写实</button>
          <button onClick={() => optimizeLocal("premium")}>更高级</button>
          <button className="assistant-ai" onClick={() => void enhanceOnline()} disabled={enhancing}>
            {enhancing ? "AI 增强中…" : "AI 增强 · " + chatModel}
          </button>
          {originalPrompt && <button onClick={() => setPrompt(originalPrompt)}>恢复原提示词</button>}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={mode === "edit"
            ? "例如：保持主体不变，把背景改成未来城市夜景"
            : "例如：一张科技感产品海报，蓝白配色，干净高级"}
          rows={5}
        />
        {enhancing && enhanceProgress ? <ProgressBar event={enhanceProgress} /> : null}
      </section>

      <section className="negative-prompt" data-layout-id="negative-prompt" {...layout.dataFlagsOf("negative-prompt")} style={layout.styleOf("negative-prompt")}>
        <div className="negative-head">
          <strong>负面提示词 <InfoHint content="独立保存；提交时转换为「必须避免」的自然语言约束。" /></strong>
          <div className="negative-template-actions">
            <select value={selectedNegativeTemplate} onChange={(event) => applyNegativeTemplate(event.target.value)}>
              <option value="">选择负面词模板…</option>
              {templates.filter((item) => item.kind === "negative").map((item) => <option key={item.id} value={item.id}>[{item.category}] {item.title}</option>)}
            </select>
            <button onClick={() => void saveTemplate("negative")}>保存为模板</button>
            {selectedNegativeTemplate && !templates.find((item) => item.id === selectedNegativeTemplate)?.builtin && <button onClick={() => void saveTemplate("negative", true)}>更新模板</button>}
            {selectedNegativeTemplate && !templates.find((item) => item.id === selectedNegativeTemplate)?.builtin && <button onClick={() => void deleteTemplate("negative")}>删除模板</button>}
          </div>
        </div>
        <textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} rows={3} placeholder="例如：水印、乱码文字、重复元素、肢体畸形、塑料质感" />
      </section>

      <details
        className="reverse-prompt"
        data-layout-id="reverse-prompt"
        {...layout.dataFlagsOf("reverse-prompt")}
        style={layout.styleOf("reverse-prompt")}
        onToggle={(event) => layout.setModuleCollapsed("reverse-prompt", !event.currentTarget.open)}
      >
        <summary>图反推提示词 · {roles.reverse?.model ?? "未配置"}</summary>
        <div className="reverse-upload-row">
          <ImageDropInput accept="image/*" onFiles={(files) => { setReverseImage(files[0] ?? null); setReverseResult(null); }}>
            {({ inputId, dropProps }) => (
              <label className="upload ghost" htmlFor={inputId} {...dropProps}>
                {reverseImage ? "待分析：" + reverseImage.name : "选择需要反推的图片"}
              </label>
            )}
          </ImageDropInput>
          <button className="assistant-ai" onClick={() => void reversePrompt()} disabled={reversing}>{reversing ? "分析中…" : "生成中英文提示词"}</button>
        </div>
        {reversing && reverseProgress ? <ProgressBar event={reverseProgress} /> : null}
        {reverseResult && <div className="reverse-results">
          {[{ key: "zh", label: "中文提示词", value: reverseResult.zh }, { key: "en", label: "English Prompt", value: reverseResult.en }].map((item) => item.value && (
            <article key={item.key}>
              <strong>{item.label}</strong><p>{item.value}</p>
              <div><button onClick={() => applyReversePrompt(item.value, "replace")}>替换当前</button><button onClick={() => applyReversePrompt(item.value, "append")}>追加</button><button onClick={() => void copyText(item.value, "反推提示词已复制")}>复制</button></div>
            </article>
          ))}
        </div>}
      </details>

      {(mode === "edit" || mode === "outpaint") && (
        <>
          <div className="upload-row" data-layout-id="upload" {...layout.dataFlagsOf("upload")} style={layout.styleOf("upload")}>
            <ImageDropInput accept="image/*" onFiles={(files) => setImage(files[0] ?? null)}>
              {({ inputId, dropProps }) => (
                <label className="upload" htmlFor={inputId} {...dropProps}>
                  {image ? "原图：" + image.name : mode === "outpaint" ? "上传扩图原图" : "上传原图"}
                </label>
              )}
            </ImageDropInput>
            {mode === "edit" && <ImageDropInput accept="image/*" onFiles={(files) => setExternalMask(files[0] ?? null)}>
              {({ inputId, dropProps }) => (
                <label className="upload ghost" htmlFor={inputId} {...dropProps}>
                  {externalMask ? "外部蒙版：" + externalMask.name : "可选外部蒙版"}
                </label>
              )}
            </ImageDropInput>}
          </div>
          {mode === "edit" && <MaskPainter image={image} onMaskChange={maskChange} layoutId="mask" style={layout.styleOf("mask")} />}
        </>
      )}

      {(mode === "generate" || mode === "edit") && <section className="reference-panel" data-tutorial="reference-images" data-layout-id="references" {...layout.dataFlagsOf("references")} style={layout.styleOf("references")}>
        <div className="reference-head">
          <div>
            <strong>参考图片 <span>{references.length}/3</span> <InfoHint content={mode === "generate" ? "可参考构图、风格、配色或主体特征生成新画面。添加参考图后会自动使用兼容图片编辑接口，一次生成 1 张；不添加时仍使用普通文生图接口。" : "与原图合成参考画板，帮助模型理解风格和元素。局部蒙版与多参考图不能同时提交；需要局部修改时请先移除参考图。"} /></strong>
          </div>
          <div className="reference-actions">
            <ImageDropInput accept="image/*" multiple onFiles={addReferenceFiles}>
              {({ inputId, dropProps }) => (
                <label className="upload ghost" htmlFor={inputId} {...dropProps}>导入图片</label>
              )}
            </ImageDropInput>
            <button type="button" className="secondary" onClick={() => void pasteReferenceImage()}>从剪贴板粘贴</button>
            {references.length > 0 && <button type="button" className="secondary" onClick={() => setReferences([])}>清空</button>}
          </div>
        </div>
        {references.length > 0 ? <div className="reference-grid">
          {references.map((file, index) => <ReferenceThumbnail
            key={compositeFileKey(file)}
            file={file}
            index={index}
            onCopy={(value) => void copyReferenceImage(value)}
            onRemove={() => setReferences((current) => current.filter((_, value) => value !== index))}
          />)}
        </div> : <button type="button" className="reference-empty" onClick={() => void pasteReferenceImage()}>
          剪贴板中已有图片时，可直接点击这里粘贴
        </button>}
      </section>}

      {mode === "outpaint" && <section className="outpaint-panel" data-layout-id="outpaint-panel" {...layout.dataFlagsOf("outpaint-panel")} style={layout.styleOf("outpaint-panel")}>
        <div className="outpaint-head"><div><strong>扩图画布</strong><small>{sourceDimensions ? `原图 ${sourceDimensions.width}x${sourceDimensions.height}` : "上传原图后可设置目标画布"}</small></div><span>仅扩展，不裁剪</span></div>
        <div className="outpaint-presets">
          <span>快捷转换</span>
          {outpaintQuickRatios.map((value) => <button className={outpaintPreset === value ? "active" : ""} key={value} onClick={() => chooseOutpaintPreset(value)}>{value}</button>)}
        </div>
        <div className="outpaint-strategy">
          <label className="check"><input type="radio" checked={outpaintStrategy === "percent"} onChange={() => { setOutpaintStrategy("percent"); setOutpaintPreset(""); }} />四向百分比</label>
          <label className="check"><input type="radio" checked={outpaintStrategy === "target"} onChange={() => setOutpaintStrategy("target")} />目标分辨率</label>
        </div>
        {outpaintStrategy === "percent" ? <div className="outpaint-margins">
          {(["top", "right", "bottom", "left"] as const).map((key) => <label key={key}>{({ top: "上", right: "右", bottom: "下", left: "左" })[key]}（%）<input type="number" min="0" max="200" value={outpaintMargins[key]} onChange={(event) => setOutpaintMargins((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
        </div> : <label className="outpaint-target">目标分辨率<input value={outpaintTargetSize} onChange={(event) => { setOutpaintTargetSize(event.target.value); setOutpaintPreset(""); }} placeholder="例如 1080x1920" /></label>}
        {outpaintCheck && <p className={outpaintCheck.ok ? "outpaint-valid" : "outpaint-invalid"}>{outpaintCheck.ok ? `目标 ${outpaintCheck.layout.targetSize} · 原图位于 (${outpaintCheck.layout.x}, ${outpaintCheck.layout.y})` : outpaintCheck.error}</p>}
      </section>}

      <div className="controls" data-layout-id="controls" {...layout.dataFlagsOf("controls")} style={layout.styleOf("controls")}>
        <div className="performance-presets">
          <span>生成速度</span>
          <button type="button" onClick={() => quickPreset("fast")}>快速预览</button>
          <button type="button" onClick={() => quickPreset("stable")}>稳定创作</button>
          <button type="button" onClick={() => quickPreset("detail")}>最终高清</button>
        </div>
        <label>细节质量
          <select value={quality} onChange={(event) => setQuality(event.target.value)}>
            {qualities.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>清晰度
          <Tooltip content="推荐配置：1K、自动细节、1 张，通常响应更快、失败率更低。">
            <select value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={customSizeEnabled}>
              {resolutionOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
          </Tooltip>
        </label>
        <label>画面比例
          {customSizeEnabled && mode !== "outpaint" ? (
            <>
              <span className="ratio-custom">
                <input value={customSize} onChange={(event) => setCustomSize(event.target.value)} placeholder="例如 1536x1024" />
                <Tooltip content="返回预设比例">
                  <button type="button" className="ratio-custom-back" aria-label="返回预设比例" onClick={() => setCustomSizeEnabled(false)}><NavIcon name="undo" size={16} /></button>
                </Tooltip>
              </span>
              {customSize.trim() ? <small className={customCheck.ok ? "valid" : "invalid"}>{customCheck.message}</small> : null}
            </>
          ) : (
            <span className="ratio-select">
              <select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={mode === "outpaint"}>
                {ratioOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
              {mode !== "outpaint" && (
                <Tooltip content="自定义尺寸">
                  <button type="button" className="ratio-custom-enter" aria-label="自定义尺寸" onClick={() => setCustomSizeEnabled(true)}>
                    <NavIcon name="ruler" size={16} />
                  </button>
                </Tooltip>
              )}
            </span>
          )}
        </label>
        <label>数量
          <select value={references.length && mode === "generate" ? 1 : n} onChange={(event) => setN(Number(event.target.value))} disabled={mode !== "generate" || references.length > 0}>
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} 张</option>)}
          </select>
        </label>
      </div>
      {layout.editing && (
        <div className="layout-handle-layer">
          {layout.ghostRect && <div className="layout-ghost" style={layout.ghostRect} aria-hidden="true" />}
          {layout.handles.map((handle) => (
            <div
              key={handle.id}
              className={handle.id === layout.draggingId ? "layout-handle dragging" : "layout-handle"}
              data-layout-handle-id={handle.id}
              style={{ left: handle.left, top: handle.top, width: handle.width, height: handle.height }}
              onPointerDown={(event) => layout.beginDrag(handle.id, "move", event)}
              onPointerMove={layout.moveDrag}
              onPointerUp={layout.endDrag}
              onPointerCancel={layout.endDrag}
            >
              <span className="layout-handle-label" style={{ top: 6, left: 8 }}>{handle.label}</span>
              <Tooltip content="隐藏该模块（可从「已隐藏」列表恢复）">
                <button
                  type="button"
                  className="layout-handle-hide"
                  style={{ top: 6, right: 8 }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); layout.hideModule(handle.id); }}
                >×</button>
              </Tooltip>
              {/* 三向缩放把手：位置由本 todo 内联保证「全部落在 handle 盒内」；尺寸/配色归 todo 11 的 CSS。
                  各把手自带 kind → 只改对应维度（e 改宽、s 改高、se 改宽高），x/y 恒不变。 */}
              <span
                className="layout-handle-resize e"
                style={{ top: "50%", right: 4, bottom: "auto", transform: "translateY(-50%)", cursor: "ew-resize" }}
                onPointerDown={(event) => layout.beginDrag(handle.id, "resize-e", event)}
                aria-hidden="true"
              />
              <span
                className="layout-handle-resize s"
                style={{ left: "50%", bottom: 4, right: "auto", transform: "translateX(-50%)", cursor: "ns-resize" }}
                onPointerDown={(event) => layout.beginDrag(handle.id, "resize-s", event)}
                aria-hidden="true"
              />
              <span
                className="layout-handle-resize se"
                style={{ right: 4, bottom: 4, cursor: "nwse-resize" }}
                onPointerDown={(event) => layout.beginDrag(handle.id, "resize-se", event)}
                aria-hidden="true"
              />
            </div>
          ))}
        </div>
      )}
      </div>
      <p className="size-hint">
        当前输出：{displaySize} · {mode === "outpaint" ? outpaintPreset || "扩展画布" : ratio + " 比例"} · {resolution.toUpperCase()} 清晰度 · 项目：
        {projects.find((project) => project.id === projectId)?.name || "收件箱"}
      </p>
      {heavyRequest && (
        <p className="performance-warning">
          当前组合需要更长等待时间，也更容易遇到接口限制。建议先用 1K、自动细节、1 张确定构图。
        </p>
      )}
      <div className="run-row" data-tutorial="generation-actions">
        <button className="primary generate" onClick={() => void enqueue()} disabled={isEnqueueing}>
          {isEnqueueing ? "正在准备任务…" : activeJobId ? "继续加入队列" : mode === "outpaint" ? "加入扩图队列" : mode === "edit" ? "加入编辑队列" : references.length ? "加入参考图生成队列" : "加入生成队列"}
        </button>
        {activeJobId && <button className="secondary" onClick={() => void cancelActive()}>取消任务</button>}
        <span className="save-note">
          自动归档：{autoArchive ? "已开启" : "已关闭"}
        </span>
        <QuickModelSwitcher variant="dock" onOpenSettings={onOpenSettings} />
      </div>
      {progress && activeJobId && (
        <div className="progress">
          <div className="progress-track"><div style={{ width: String(progress.progress ?? 12) + "%" }} /></div>
          <span>{progress.status}{progress.message ? " · " + progress.message : ""}</span>
        </div>
      )}
    </section>
  );
}
