import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { LocalAIAction } from "./LocalAIToolbox";
import { NavIcon } from "./icons";
import { callIpc } from "./ipc";
import { useStudio } from "./StudioContext";
import { b64ToFile, dataUrlFor, drawContain, readImage } from "./media-utils";
import { formatGenerationParameters, variationOptions } from "../lib/creative";
import { modeLabel, parsePixelSize } from "../lib/format";
import type { Output } from "./types";

const socialPresets = [
  { value: "1080x1080", label: "1:1 方图" },
  { value: "1080x1350", label: "4:5 竖图" },
  { value: "1920x1080", label: "16:9 横图" },
  { value: "1080x1920", label: "9:16 竖图" },
];

async function exportSocialCanvas(output: Output, preset: string, fill: "light" | "blur") {
  const parsed = parsePixelSize(preset);
  if (!parsed) throw new Error("导出尺寸无效");
  const { width, height } = parsed;
  const image = await readImage(b64ToFile(output.b64, "export.png"));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建导出画布");
  if (fill === "blur") {
    const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    context.filter = "blur(28px)";
    context.globalAlpha = 0.72;
    context.drawImage(
      image,
      (width - image.naturalWidth * cover) / 2,
      (height - image.naturalHeight * cover) / 2,
      image.naturalWidth * cover,
      image.naturalHeight * cover,
    );
    context.filter = "none";
    context.globalAlpha = 1;
  } else {
    context.fillStyle = "#f6fbff";
    context.fillRect(0, 0, width, height);
  }
  drawContain(context, image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

export function ResultPanel({
  outputs,
  onRegenerate,
  onContinueEdit,
  onStartOutpaint,
  onOpenLocalAI,
  onCreateVariation,
  onOpenPreview,
}: {
  outputs: Output[];
  onRegenerate: (output: Output) => void;
  onContinueEdit: (output: Output) => void;
  onStartOutpaint: (output: Output) => void;
  onOpenLocalAI: (output: Output, action: LocalAIAction) => void;
  onCreateVariation: (source: Output, option: (typeof variationOptions)[number]) => void;
  onOpenPreview: (output: Output) => void;
}) {
  const { error, notice, errorInfo, setError, setNotice } = useStudio();
  const [exportOutput, setExportOutput] = useState<Output | null>(null);
  const [socialPreset, setSocialPreset] = useState("1080x1080");
  const [socialFill, setSocialFill] = useState<"light" | "blur">("light");
  // 导出弹层经 portal 挂到 .app：与重构前 DOM 位置一致（弹层原为 .app 直接子级，z-index:50 在根级叠加上下文覆盖 header z-index:40）。
  // 直接作为 .page-transition 后代时，其 opacity 动画（fill:both）会创建 stacking context，将弹层 z-index 局部化 → header 反盖弹层顶部条带。
  const portalTarget = document.querySelector(".app") ?? document.body;

  const saveOutput = async (output: Output) => {
    const result = await callIpc(() => window.imageStudio.saveImage({
      dataUrl: dataUrlFor(output),
      suggestedName: "image-studio-" + new Date(output.createdAt).toISOString().replace(/[:.]/g, "-") + ".png",
      recipe: output.recipe,
    }), { fallbackError: "保存失败", onError: setError });
    if (!result.canceled) setNotice("已保存：" + (result.path || ""));
  };

  const exportSocial = async () => {
    if (!exportOutput) return;
    try {
      const dataUrl = await exportSocialCanvas(exportOutput, socialPreset, socialFill);
      const result = await callIpc(() => window.imageStudio.saveImage({
        dataUrl,
        suggestedName: "image-studio-social-" + socialPreset + ".png",
        recipe: { ...exportOutput.recipe, size: socialPreset },
      }), { fallbackError: "导出失败" });
      if (!result.canceled) {
        setNotice("社交平台成品已保存：" + (result.path || ""));
        setExportOutput(null);
      }
    } catch (cause) {
      setError((cause as Error).message || "导出失败");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (exportOutput) setExportOutput(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportOutput]);

  const panelSection = (
    <section className="card results">
      <div className="section-head">
        <div><span className="eyebrow">RESULTS</span><h2>生成结果</h2></div>
        {outputs.length > 0 && <span className="muted">{outputs.length} 张图片 · 点击查看大图</span>}
      </div>
      {errorInfo && <div className="generation-error">
        <div><span>{errorInfo.category.replace("_", " ")}</span><strong>{errorInfo.title}</strong></div>
        <p>{errorInfo.message}</p><small>{errorInfo.suggestion}</small>
        {errorInfo.details && <details><summary>查看接口详情</summary><pre>{errorInfo.details}</pre></details>}
      </div>}
      {error && <div className="error"><span>{error}</span></div>}
      {notice && <div className="notice">{notice}</div>}
      {outputs.length === 0 ? (
        <div className="empty">
          <span><NavIcon name="sparkles" size={40} /></span>
          <p>生成后的图片会显示在这里</p>
          <small>队列、项目、变体与交付工具会保留你的创作过程。</small>
        </div>
      ) : (
        <div className="gallery">
          {outputs.map((output) => (
            <article key={output.id}>
              <img className="result-image" onClick={() => onOpenPreview(output)} src={dataUrlFor(output)} alt="生成结果" />
              <div className="result-caption">
                <strong>{output.recipe.variationLabel || modeLabel(output.recipe, { fallback: "新生成图片" })}</strong>
                <small>{output.recipe.size} · {output.recipe.projectId}{output.recipe.seed ? " · Seed " + output.recipe.seed : ""}</small>
              </div>
              {output.recipe.seed && <button className="seed-chip" onClick={() => void window.imageStudio.clipboard.copyText(output.recipe.seed!).then(() => setNotice("Seed 已复制"))}>Seed：{output.recipe.seed} · 点击复制</button>}
              <div className="result-actions">
                <button onClick={() => void saveOutput(output)}>保存 PNG</button>
                <button onClick={() => void window.imageStudio.clipboard.copyImage(output.b64).then(() => setNotice("图片已复制到剪贴板"))}>复制图片</button>
                <button onClick={() => void window.imageStudio.clipboard.copyText(output.recipe.prompt).then(() => setNotice("提示词已复制"))}>复制提示词</button>
                <button onClick={() => void window.imageStudio.clipboard.copyText(formatGenerationParameters(output.recipe)).then(() => setNotice("完整参数已复制"))}>复制参数</button>
                <button onClick={() => onRegenerate(output)}>再生成</button>
                <button onClick={() => onContinueEdit(output)}>继续编辑</button>
                <button onClick={() => onStartOutpaint(output)}>智能扩图</button>
                <button onClick={() => setExportOutput(output)}>社媒导出</button>
                <button onClick={() => onOpenLocalAI(output, "upscale")}>高清放大</button>
                <button onClick={() => onOpenLocalAI(output, "remove-background")}>智能抠图</button>
                <button onClick={() => onOpenLocalAI(output, "face-restore")}>人脸优化</button>
              </div>
              <div className="variation-row">
                {variationOptions.map((option) => (
                  <button key={option.id} onClick={() => onCreateVariation(output, option)}>{option.label}</button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      {panelSection}
      {exportOutput && createPortal(
        <div className="export-modal" onClick={() => setExportOutput(null)}>
          <section onClick={(event) => event.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setExportOutput(null)}><NavIcon name="x" size={20} /></button>
            <span className="eyebrow">SOCIAL EXPORT</span>
            <h2>社交平台画布适配</h2>
            <img src={dataUrlFor(exportOutput)} alt="待导出图片" />
            <label>目标尺寸
              <select value={socialPreset} onChange={(event) => setSocialPreset(event.target.value)}>
                {socialPresets.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.value}</option>)}
              </select>
            </label>
            <label>背景填充
              <select value={socialFill} onChange={(event) => setSocialFill(event.target.value as "light" | "blur")}>
                <option value="light">浅色留白</option>
                <option value="blur">模糊延展</option>
              </select>
            </label>
            <button className="primary" onClick={() => void exportSocial()}>导出 PNG</button>
          </section>
        </div>,
        portalTarget,
      )}
    </>
  );
}
