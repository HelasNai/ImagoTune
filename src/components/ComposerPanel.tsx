import React from "react";
import { MaskPainter } from "./MaskPainter";
import { NavIcon } from "./icons";
import { ImageDropInput } from "./ImageDropInput";
import { qualities } from "./useComposer";
import type { ComposerActions, ComposerState } from "./useComposer";
import { outpaintQuickRatios, ratioOptions, resolutionOptions } from "../lib/creative";
import { compositeFileKey } from "../lib/format";
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
    <div><strong>参考图 {index + 1}</strong><span title={file.name}>{file.name}</span></div>
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
}: {
  mode: Mode;
  projects: GalleryProject[];
  activeJobId: string;
  isEnqueueing: boolean;
  progress: AppProgress | null;
  composerState: ComposerState;
  composerActions: ComposerActions;
}) {
  const { projectId, setProjectId, tagsText, setTagsText, chatModel, autoArchive, notify } = useStudio();
  const copyText = useCopyText(notify);
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

  return (
    <section className="card composer" data-tutorial="creation-form">
      <div className="mode-title">
        <div>
          <span className="eyebrow">{mode === "outpaint" ? "SMART OUTPAINT" : mode === "edit" ? "IMAGE EDIT" : "CREATE STUDIO"}</span>
          <h2>{mode === "outpaint" ? "智能扩展画面" : mode === "edit" ? "编辑与局部重绘" : "描述你想要的画面"}</h2>
        </div>
        <span className="pill">{mode === "outpaint" ? "透明画布 + 自动蒙版" : mode === "edit" ? "原图 + 蒙版 + 参考图" : "提示词 + 参考图 + 队列"}</span>
      </div>

      <div className="project-strip">
        <label>归属项目
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>标签
          <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="例如：海报，蓝粉，产品" />
        </label>
        <span>默认归档到收件箱，可随时批量移动。</span>
      </div>

      <div className="prompt-tools">
        <label>提示词模板
          <select value={selectedTemplate} onChange={(event) => applyTemplate(event.target.value)}>
            <option value="">选择模板…</option>
            {templates.filter((item) => item.kind === "positive").map((item) => <option key={item.id} value={item.id}>[{item.category}] {item.title}</option>)}
          </select>
        </label>
        <button className="secondary" onClick={() => void saveTemplate("positive")}>保存为模板</button>
        {selectedTemplate && !templates.find((item) => item.id === selectedTemplate)?.builtin && (
          <>
            <button className="secondary" onClick={() => void saveTemplate("positive", true)}>更新模板</button>
            <button className="secondary" onClick={() => void deleteTemplate("positive")}>删除模板</button>
          </>
        )}
      </div>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={mode === "edit"
          ? "例如：保持主体不变，把背景改成未来城市夜景"
          : "例如：一张科技感产品海报，蓝白配色，干净高级"}
        rows={5}
      />

      <section className="negative-prompt">
        <div className="negative-head">
          <div><strong>负面提示词</strong><small>独立保存；提交时转换为“必须避免”的自然语言约束。</small></div>
          <div className="negative-template-actions">
            <select value={selectedNegativeTemplate} onChange={(event) => applyNegativeTemplate(event.target.value)}>
              <option value="">选择负面词模板…</option>
              {templates.filter((item) => item.kind === "negative").map((item) => <option key={item.id} value={item.id}>[{item.category}] {item.title}</option>)}
            </select>
            <button onClick={() => void saveTemplate("negative")}>保存</button>
            {selectedNegativeTemplate && !templates.find((item) => item.id === selectedNegativeTemplate)?.builtin && <button onClick={() => void saveTemplate("negative", true)}>更新</button>}
            {selectedNegativeTemplate && !templates.find((item) => item.id === selectedNegativeTemplate)?.builtin && <button onClick={() => void deleteTemplate("negative")}>删除</button>}
          </div>
        </div>
        <textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} rows={3} placeholder="例如：水印、乱码文字、重复元素、肢体畸形、塑料质感" />
      </section>

      <div className="prompt-assistant">
        <strong>提示词助手</strong>
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

      <details className="reverse-prompt">
        <summary>图反推提示词 · {chatModel}</summary>
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
          <div className="upload-row">
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
          {mode === "edit" && <MaskPainter image={image} onMaskChange={maskChange} />}
        </>
      )}

      {(mode === "generate" || mode === "edit") && <section className="reference-panel" data-tutorial="reference-images">
        <div className="reference-head">
          <div>
            <strong>参考图片 <span>{references.length}/3</span></strong>
            <small>{mode === "generate" ? "可参考构图、风格、配色或主体特征生成新画面" : "与原图合成参考画板，帮助模型理解风格和元素"}</small>
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
        <p>{mode === "generate"
          ? "添加参考图后会自动使用兼容图片编辑接口，一次生成 1 张；不添加时仍使用普通文生图接口。"
          : "局部蒙版与多参考图不能同时提交；需要局部修改时请先移除参考图。"}</p>
      </section>}

      {mode === "outpaint" && <section className="outpaint-panel">
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

      <div className="performance-presets">
        <span>生成速度</span>
        <button type="button" onClick={() => quickPreset("fast")}>快速预览</button>
        <button type="button" onClick={() => quickPreset("stable")}>稳定创作</button>
        <button type="button" onClick={() => quickPreset("detail")}>最终高清</button>
      </div>

      <div className="controls">
        <label>细节质量
          <select value={quality} onChange={(event) => setQuality(event.target.value)}>
            {qualities.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>清晰度
          <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
            {resolutionOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>画面比例
          <select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={customSizeEnabled || mode === "outpaint"}>
            {ratioOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>数量
          <select value={references.length && mode === "generate" ? 1 : n} onChange={(event) => setN(Number(event.target.value))} disabled={mode !== "generate" || references.length > 0}>
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} 张</option>)}
          </select>
        </label>
      </div>

      {mode !== "outpaint" && <div className="custom-size">
        <label className="check">
          <input type="checkbox" checked={customSizeEnabled} onChange={(event) => setCustomSizeEnabled(event.target.checked)} />
          自定义安全尺寸
        </label>
        {customSizeEnabled && (
          <>
            <input value={customSize} onChange={(event) => setCustomSize(event.target.value)} placeholder="例如 1536x1024" />
            <small className={customCheck.ok ? "valid" : "invalid"}>{customCheck.message}</small>
          </>
        )}
      </div>}
      <p className="size-hint">
        当前输出：{displaySize} · {mode === "outpaint" ? outpaintPreset || "扩展画布" : ratio + " 比例"} · {resolution.toUpperCase()} 清晰度 · 项目：
        {projects.find((project) => project.id === projectId)?.name || "收件箱"}
      </p>
      {heavyRequest ? (
        <p className="performance-warning">
          当前组合需要更长等待时间，也更容易遇到接口限制。建议先用 1K、自动细节、1 张确定构图。
        </p>
      ) : (
        <p className="performance-note">
          推荐配置：1K、自动细节、1 张，通常响应更快、失败率更低。
        </p>
      )}
      <div className="run-row" data-tutorial="generation-actions">
        <button className="primary generate" onClick={() => void enqueue()} disabled={isEnqueueing}>
          {isEnqueueing ? "正在准备任务…" : activeJobId ? "继续加入队列" : mode === "outpaint" ? "加入扩图队列" : mode === "edit" ? "加入编辑队列" : references.length ? "加入参考图生成队列" : "加入生成队列"}
        </button>
        {activeJobId && <button className="secondary" onClick={() => void cancelActive()}>取消任务</button>}
        <span className="save-note">
          自动归档：{autoArchive ? "已开启" : "已关闭"} · 队列按顺序执行
        </span>
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
