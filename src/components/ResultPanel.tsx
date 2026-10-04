import React, { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { LocalAIAction } from "./LocalAIToolbox";
import { NavIcon } from "./icons";
import { useStudio } from "./StudioContext";
import { useCopyImage, useCopyText } from "./useCopy";
import { useEscapeKey } from "./useKeyboard";
import { useSaveImage } from "./useSaveImage";
import { b64ToFile, dataUrlFor, drawContain, readImage } from "./media-utils";
import { formatGenerationParameters, variationOptions } from "../lib/creative";
import { localAIArchiveLabel } from "../lib/local-ai";
import { modeLabel, parsePixelSize } from "../lib/format";
import { t } from "../lib/i18n";
import type { Output } from "./types";

// label 用 getter：每次读取时经 t() 求值（语言切换后重渲染即更新），零调用点改动。
const socialPresets = [
  { value: "1080x1080", get label() { return t("1:1 方图"); } },
  { value: "1080x1350", get label() { return t("4:5 竖图"); } },
  { value: "1920x1080", get label() { return t("16:9 横图"); } },
  { value: "1080x1920", get label() { return t("9:16 竖图"); } },
];

async function exportSocialCanvas(output: Output, preset: string, fill: "light" | "blur") {
  const parsed = parsePixelSize(preset);
  if (!parsed) throw new Error(t("导出尺寸无效"));
  const { width, height } = parsed;
  const image = await readImage(b64ToFile(output.b64, "export.png"));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("无法创建导出画布"));
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
  const { setError, setNotice, notify } = useStudio();
  const copyText = useCopyText(notify);
  const copyImage = useCopyImage(notify);
  const saveImage = useSaveImage(notify);
  const [exportOutput, setExportOutput] = useState<Output | null>(null);
  const [socialPreset, setSocialPreset] = useState("1080x1080");
  const [socialFill, setSocialFill] = useState<"light" | "blur">("light");
  // 导出弹层经 portal 挂到 .app：与重构前 DOM 位置一致（弹层原为 .app 直接子级，z-index:50 在根级叠加上下文覆盖 header z-index:40）。
  // 直接作为 .page-transition 后代时，其 opacity 动画（fill:both）会创建 stacking context，将弹层 z-index 局部化 → header 反盖弹层顶部条带。
  const portalTarget = document.querySelector(".app") ?? document.body;

  const saveOutput = async (output: Output) => {
    await saveImage({
      dataUrl: dataUrlFor(output),
      suggestedName: "image-studio-" + new Date(output.createdAt).toISOString().replace(/[:.]/g, "-") + ".png",
      recipe: output.recipe,
    }, { onSaved: (path) => setNotice(t("已保存：{path}", { path })) });
  };

  const exportSocial = async () => {
    if (!exportOutput) return;
    try {
      const dataUrl = await exportSocialCanvas(exportOutput, socialPreset, socialFill);
      const saved = await saveImage({
        dataUrl,
        suggestedName: "image-studio-social-" + socialPreset + ".png",
        recipe: { ...exportOutput.recipe, size: socialPreset },
      }, {
        fallbackError: t("导出失败|结果"),
        onSaved: (path) => setNotice(t("社交平台成品已保存：{path}", { path })),
      });
      if (saved) setExportOutput(null);
    } catch (cause) {
      setError((cause as Error).message || t("导出失败|结果"));
    }
  };

  useEscapeKey(useCallback(() => setExportOutput(null), []), Boolean(exportOutput));

  const panelSection = (
    <section className="card results">
      <div className="section-head">
        <div><span className="eyebrow">RESULTS</span><h2>{t("生成结果|结果")}</h2></div>
        {outputs.length > 0 && <span className="muted">{t("{n} 张图片 · 点击查看大图", { n: outputs.length })}</span>}
      </div>
      {outputs.length === 0 ? (
        <div className="empty">
          <span><NavIcon name="sparkles" size={40} /></span>
          <p>{t("生成后的图片会显示在这里")}</p>
          <small>{t("队列、项目、变体与交付工具会保留你的创作过程。")}</small>
        </div>
      ) : (
        <div className="gallery">
          {outputs.map((output) => (
            <article key={output.id}>
              <img className="result-image" onClick={() => onOpenPreview(output)} src={dataUrlFor(output)} alt={t("生成结果|结果")} />
              <div className="result-caption">
                <strong>{localAIArchiveLabel(output.recipe.variationLabel) || output.recipe.variationLabel || modeLabel(output.recipe, { fallback: t("新生成图片|结果") })}</strong>
                <small>{output.recipe.size} · {output.recipe.projectId}{output.recipe.seed ? " · Seed " + output.recipe.seed : ""}</small>
              </div>
              {output.recipe.seed && <button className="seed-chip" onClick={() => void copyText(output.recipe.seed!, t("Seed 已复制"))}>{t("Seed：{seed} · 点击复制", { seed: output.recipe.seed })}</button>}
              <div className="result-actions">
                <button onClick={() => void saveOutput(output)}>{t("保存 PNG|结果")}</button>
                <button onClick={() => void copyImage(output.b64, t("图片已复制到剪贴板"))}>{t("复制图片")}</button>
                <button onClick={() => void copyText(output.recipe.prompt, t("提示词已复制|结果"))}>{t("复制提示词|结果")}</button>
                <button onClick={() => void copyText(formatGenerationParameters(output.recipe), t("完整参数已复制|结果"))}>{t("复制参数|结果")}</button>
                <button onClick={() => onRegenerate(output)}>{t("再生成|结果")}</button>
                <button onClick={() => onContinueEdit(output)}>{t("继续编辑|结果")}</button>
                <button onClick={() => onStartOutpaint(output)}>{t("智能扩图")}</button>
                <button onClick={() => setExportOutput(output)}>{t("社媒导出|结果")}</button>
                <button onClick={() => onOpenLocalAI(output, "upscale")}>{t("高清放大")}</button>
                <button onClick={() => onOpenLocalAI(output, "remove-background")}>{t("智能抠图")}</button>
                <button onClick={() => onOpenLocalAI(output, "face-restore")}>{t("人脸优化|结果")}</button>
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
            <h2>{t("社交平台画布适配")}</h2>
            <img src={dataUrlFor(exportOutput)} alt={t("待导出图片")} />
            <label>{t("目标尺寸|结果")}
              <select value={socialPreset} onChange={(event) => setSocialPreset(event.target.value)}>
                {socialPresets.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.value}</option>)}
              </select>
            </label>
            <label>{t("背景填充|结果")}
              <select value={socialFill} onChange={(event) => setSocialFill(event.target.value as "light" | "blur")}>
                <option value="light">{t("浅色留白")}</option>
                <option value="blur">{t("模糊延展")}</option>
              </select>
            </label>
            <button className="primary" onClick={() => void exportSocial()}>{t("导出 PNG|结果")}</button>
          </section>
        </div>,
        portalTarget,
      )}
    </>
  );
}
