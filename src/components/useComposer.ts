import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  applyLocalPromptAction,
  createRecipe,
  parseTags,
  PromptAction,
  ratioOptions,
  resolutionOptions,
  sizeMatrix,
  validateCanvasSize,
} from "../lib/creative";
import {
  createOutpaintFiles,
  OutpaintMargins,
  outpaintFromPercent,
  outpaintToSize,
  targetSizeForRatio,
} from "../lib/outpaint";
import type { ConfirmDialogOptions, TextDialogOptions } from "./Dialogs";
import { callIpc } from "./ipc";
import { b64ToFile, canvasToBlob, drawContain, fileToDataUrl, readImage } from "../lib/media";
import { compositeFileKey, formatTags, uniqueBy } from "../lib/format";
import type { Mode, Output } from "./types";

export const qualities = [
  { value: "auto", label: "自动" },
  { value: "low", label: "快速草图" },
  { value: "medium", label: "标准" },
  { value: "high", label: "最高细节" },
];

export type SubmitOverride = {
  prompt?: string;
  negativePrompt?: string;
  mode?: RecipeMode;
  size?: string;
  quality?: string;
  ratio?: string;
  resolution?: string;
  n?: number;
  image?: File | null;
  mask?: File | null;
  projectId?: string;
  tags?: string[];
  sourceId?: string;
  variationLabel?: string;
};

async function fileToPayload(file: File): Promise<{ name: string; type: string; data: number[] }> {
  const buffer = await file.arrayBuffer();
  return { name: file.name, type: file.type, data: Array.from(new Uint8Array(buffer)) };
}

async function prepareUpload(file: File) {
  const image = await readImage(file);
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
  if (longEdge <= 2048 && file.size <= 5 * 1024 * 1024) return file;
  const scale = Math.min(1, 2048 / longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(16, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(16, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, type, type === "image/jpeg" ? 0.9 : undefined);
  const extension = type === "image/png" ? ".png" : ".jpg";
  return blob
    ? new File([blob], file.name.replace(/\.[^.]+$/, extension), { type })
    : file;
}

async function resizeMaskToMatch(mask: File, target: File) {
  const [maskImage, targetImage] = await Promise.all([readImage(mask), readImage(target)]);
  if (maskImage.naturalWidth === targetImage.naturalWidth && maskImage.naturalHeight === targetImage.naturalHeight) return mask;
  const canvas = document.createElement("canvas");
  canvas.width = targetImage.naturalWidth;
  canvas.height = targetImage.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法调整蒙版尺寸");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  if (!blob) throw new Error("无法导出匹配尺寸的蒙版");
  return new File([blob], "image-studio-matched-mask.png", { type: "image/png" });
}

async function prepareVisionUpload(file: File) {
  const image = await readImage(file);
  const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(16, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(16, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return file;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let transparent = false;
  if (file.type === "image/png") {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) { transparent = true; break; }
    }
  }
  const type = transparent ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, type, type === "image/jpeg" ? 0.88 : undefined);
  return blob ? new File([blob], transparent ? "reverse-source.png" : "reverse-source.jpg", { type }) : file;
}

async function createReferenceBoard(main: File, references: File[], kind: "edit" | "generate" = "edit") {
  if (!references.length) return main;
  const images = await Promise.all([main, ...references.slice(0, 3)].map((file) => readImage(file)));
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 2048;
  const context = canvas.getContext("2d");
  if (!context) return main;
  context.fillStyle = "#f5f7ff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = column * 1024;
    const y = row * 1024;
    context.fillStyle = index === 0 ? "#e5f6ff" : "#fff0f6";
    context.fillRect(x + 12, y + 12, 1000, 1000);
    drawContain(context, image, x + 36, y + 80, 952, 896);
    context.fillStyle = "#1b2d4a";
    context.font = "bold 34px sans-serif";
    const caption = kind === "generate"
      ? "参考图 " + String(index + 1) + "：借鉴风格 / 元素"
      : index === 0
        ? "主图：保持主体"
        : "参考图 " + String(index) + "：借鉴风格 / 元素";
    context.fillText(caption, x + 42, y + 55);
  });
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  return blob
    ? new File([blob], "image-studio-reference-board.jpg", { type: "image/jpeg" })
    : main;
}

// 创作域状态与命令的单一实例：仅在 App 层调用一次（ComposerPanel 不得再次调用，避免双份状态）。
// App 提供：刷新队列、模式路由、Studio 上下文（error/notice/project/tags/model）读写；队列订阅（useEffect G）留在 App。
export function useComposer({
  refreshQueue,
  mode,
  setMode,
  setError,
  setNotice,
  setErrorInfo,
  setProjectId,
  setTagsText,
  projectId,
  tagsText,
  imageModel,
  chatModel,
  configured,
  requestText,
  requestConfirm,
}: {
  refreshQueue: () => Promise<void>;
  mode: Mode;
  setMode: Dispatch<SetStateAction<Mode>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setErrorInfo: Dispatch<SetStateAction<GenerationErrorInfo | null>>;
  setProjectId: Dispatch<SetStateAction<string>>;
  setTagsText: Dispatch<SetStateAction<string>>;
  projectId: string;
  tagsText: string;
  imageModel: string;
  chatModel: string;
  configured: boolean;
  requestText: (options: TextDialogOptions) => Promise<string | null>;
  requestConfirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [quality, setQuality] = useState("auto");
  const [resolution, setResolution] = useState("1k");
  const [ratio, setRatio] = useState("1:1");
  const [n, setN] = useState(1);
  const [customSizeEnabled, setCustomSizeEnabled] = useState(false);
  const [customSize, setCustomSize] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [externalMask, setExternalMask] = useState<File | null>(null);
  const [paintedMask, setPaintedMask] = useState<File | null>(null);
  const [references, setReferences] = useState<File[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedNegativeTemplate, setSelectedNegativeTemplate] = useState("");
  const [reverseImage, setReverseImage] = useState<File | null>(null);
  const [reverseResult, setReverseResult] = useState<{ zh: string; en: string } | null>(null);
  const [reversing, setReversing] = useState(false);
  const [outpaintStrategy, setOutpaintStrategy] = useState<"percent" | "target">("percent");
  const [outpaintMargins, setOutpaintMargins] = useState<OutpaintMargins>({ top: 25, right: 25, bottom: 25, left: 25 });
  const [outpaintTargetSize, setOutpaintTargetSize] = useState("");
  const [outpaintPreset, setOutpaintPreset] = useState("");
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number } | null>(null);
  const [activeJobId, setActiveJobId] = useState("");
  const [isEnqueueing, setIsEnqueueing] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [progress, setProgress] = useState<AppProgress | null>(null);
  const [enhancing, setEnhancing] = useState(false);

  const presetSize = sizeMatrix[resolution][ratio];
  const customCheck = validateCanvasSize(customSize);
  const chosenSize = customSizeEnabled && customCheck.ok ? customCheck.size : presetSize;
  const maskChange = useCallback((file: File | null) => setPaintedMask(file), []);
  const outpaintCheck = sourceDimensions
    ? outpaintStrategy === "percent"
      ? outpaintFromPercent(sourceDimensions.width, sourceDimensions.height, outpaintMargins)
      : outpaintToSize(sourceDimensions.width, sourceDimensions.height, outpaintTargetSize)
    : null;
  const displaySize = mode === "outpaint" && outpaintCheck?.ok ? outpaintCheck.layout.targetSize : chosenSize;
  const [displayWidth, displayHeight] = displaySize.split("x").map(Number);
  const heavyRequest = resolution === "4k" || n > 1 || displayWidth * displayHeight > 3_000_000;

  useEffect(() => {
    if (mode !== "outpaint" || !image) { setSourceDimensions(null); return; }
    let active = true;
    void readImage(image).then((value) => {
      if (active) setSourceDimensions({ width: value.naturalWidth, height: value.naturalHeight });
    }).catch(() => { if (active) setSourceDimensions(null); });
    return () => { active = false; };
  }, [image, mode]);

  // 原实现中 templates.list 位于 App bootstrap effect（依赖 refreshWorkspace ← projectId 变化）；
  // 迁移后用 [projectId] 复刻同一重取时机，保证行为不变（模板仍随项目切换重取）。
  useEffect(() => {
    void callIpc(() => window.imageStudio.templates.list(), { fallbackError: "无法读取提示词模板", onError: setError }).then((value) => setTemplates(value.items)).catch(() => { /* callIpc 已上报 */ });
  }, [projectId]);

  const applyTemplate = (id: string) => {
    const item = templates.find((value) => value.id === id);
    if (!item || item.kind !== "positive") return;
    setSelectedTemplate(id);
    setOriginalPrompt(prompt);
    setPrompt(item.prompt);
    if (item.ratio && ratioOptions.some((value) => value.value === item.ratio)) setRatio(item.ratio);
    if (item.resolution && sizeMatrix[item.resolution]) setResolution(item.resolution);
    if (item.quality) setQuality(item.quality);
    setMode("generate");
  };

  const applyNegativeTemplate = (id: string) => {
    const item = templates.find((value) => value.id === id);
    if (!item || item.kind !== "negative") return;
    setSelectedNegativeTemplate(id);
    setNegativePrompt(item.prompt);
  };

  const saveTemplate = async (kind: "positive" | "negative", update = false) => {
    const value = kind === "negative" ? negativePrompt : prompt;
    const selectedId = kind === "negative" ? selectedNegativeTemplate : selectedTemplate;
    const selected = templates.find((item) => item.id === selectedId && item.kind === kind);
    if (!value.trim()) {
      setError(kind === "negative" ? "请先输入负面提示词" : "请先输入提示词再保存模板");
      return;
    }
    if (update && (!selected || selected.builtin)) return;
    const title = update ? selected!.title : await requestText({ title: "保存提示词模板", defaultValue: kind === "negative" ? "我的负面词" : "我的模板", confirmLabel: "保存" });
    if (!title?.trim()) return;
    const result = await callIpc(() => window.imageStudio.templates.save({
      id: update ? selected!.id : undefined,
      title,
      category: "自定义",
      prompt: value,
      kind,
      ratio: kind === "positive" ? ratio : undefined,
      resolution: kind === "positive" ? resolution : undefined,
      quality: kind === "positive" ? quality : undefined,
    }), { fallbackError: "模板保存失败", onError: setError });
    if (result.item) {
      setTemplates((current) => [...current.filter((item) => item.id !== result.item!.id), result.item!]);
      if (kind === "negative") setSelectedNegativeTemplate(result.item.id);
      else setSelectedTemplate(result.item.id);
      setNotice(update ? "模板已更新" : "模板已保存");
    }
  };

  const deleteTemplate = async (kind: "positive" | "negative") => {
    const selectedId = kind === "negative" ? selectedNegativeTemplate : selectedTemplate;
    const item = templates.find((value) => value.id === selectedId && value.kind === kind);
    if (!item || item.builtin || !(await requestConfirm({ title: "删除模板", message: "删除模板“" + item.title + "”吗？", confirmLabel: "删除", danger: true }))) return;
    const result = await callIpc(() => window.imageStudio.templates.delete(item.id), { fallbackError: "模板删除失败", onError: setError });
    if (!result.ok) return;
    setTemplates((current) => current.filter((value) => value.id !== item.id));
    if (kind === "negative") setSelectedNegativeTemplate("");
    else setSelectedTemplate("");
  };

  const optimizeLocal = (action: PromptAction) => {
    if (!prompt.trim()) {
      setError("请先输入提示词");
      return;
    }
    setOriginalPrompt(prompt);
    setPrompt(applyLocalPromptAction(prompt, action));
    setNotice("已应用本地提示词优化，不会产生额外 API 调用");
  };

  const enhanceOnline = async () => {
    if (!prompt.trim()) {
      setError("请先输入提示词");
      return;
    }
    setEnhancing(true);
    setError("");
    const result = await callIpc(() => window.imageStudio.prompt.enhance({
      prompt,
      mode: mode === "edit" ? "edit" : "generate",
    }), { fallbackError: "AI 增强失败，原提示词未改变", onError: setError });
    setEnhancing(false);
    if (!result.ok || !result.prompt) return;
    setOriginalPrompt(prompt);
    setPrompt(result.prompt);
    setNotice("已通过 " + chatModel + " 增强提示词");
  };

  const reversePrompt = async () => {
    if (!reverseImage) { setError("请先选择需要反推的图片"); return; }
    if (!configured) { setError("请先到设置页保存 API 密钥"); return; }
    setReversing(true);
    setError("");
    setErrorInfo(null);
    try {
      const prepared = await prepareVisionUpload(reverseImage);
      const result = await callIpc(async () => window.imageStudio.prompt.reverse({ image: await fileToPayload(prepared) }), { fallbackError: "图反推失败，原提示词未改变" });
      if (!result.ok) return;
      setReverseResult({ zh: result.zh || "", en: result.en || "" });
      setNotice("已生成中英文反推提示词，原提示词尚未改变");
    } catch (cause) {
      setError((cause as Error).message || "图反推失败，原提示词未改变");
    } finally { setReversing(false); }
  };

  const applyReversePrompt = (value: string, action: "replace" | "append") => {
    if (!value.trim()) return;
    setOriginalPrompt(prompt);
    setPrompt(action === "append" && prompt.trim() ? prompt.trim() + "\n\n" + value.trim() : value.trim());
    setNotice(action === "append" ? "反推提示词已追加" : "反推提示词已替换当前内容");
  };

  const addReferenceFiles = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      setError("请选择有效的图片文件");
      return;
    }
    const combined = uniqueBy([...references, ...images], compositeFileKey);
    setReferences(combined.slice(0, 3));
    setError("");
    setNotice(combined.length > 3 ? "最多使用 3 张参考图，超出的图片未导入" : `已添加 ${Math.min(combined.length, 3)} 张参考图`);
  };

  const pasteReferenceImage = async () => {
    const result = await callIpc(() => window.imageStudio.clipboard.readImage(), { fallbackError: "剪贴板中没有可用图片", onError: setError });
    if (!result.ok || !result.b64) return;
    addReferenceFiles([b64ToFile(result.b64, `clipboard-reference-${Date.now()}.png`)]);
  };

  const copyReferenceImage = async (file: File) => {
    try {
      const result = await window.imageStudio.clipboard.copyImage(await fileToDataUrl(file));
      if (!result.ok) throw new Error(result.error || "复制失败");
      setNotice("参考图已复制到剪贴板");
    } catch (cause) {
      setError((cause as Error).message || "无法复制参考图");
    }
  };

  const chooseOutpaintPreset = (preset: string) => {
    if (!sourceDimensions) { setError("请先上传扩图原图"); return; }
    const size = targetSizeForRatio(sourceDimensions.width, sourceDimensions.height, preset);
    setOutpaintStrategy("target");
    setOutpaintPreset(preset);
    setOutpaintTargetSize(size);
  };

  const enqueue = async (override: SubmitOverride = {}) => {
    if (isEnqueueing) return;
    const activeMode = override.mode || (mode === "outpaint" ? "outpaint" : mode === "edit" ? "edit" : "generate");
    const activePrompt = (override.prompt ?? prompt).trim();
    const activeNegativePrompt = (override.negativePrompt ?? negativePrompt).trim();
    const activeResolution = override.resolution || resolution;
    const activeRatio = override.ratio || ratio;
    const activeSize = override.size || chosenSize;
    const activeQuality = override.quality || quality;
    const activeN = override.n ?? n;
    const activeProject = override.projectId || projectId;
    const activeTags = override.tags || parseTags(tagsText);
    if (!imageModel.trim()) {
      setError("请先在设置中填写图片模型名称");
      return;
    }
    const sourceImage = override.image === undefined ? image : override.image;
    let suppliedMask = override.mask === undefined ? (paintedMask || externalMask) : override.mask;
    const referenceGeneration = activeMode === "generate" && references.length > 0;
    if (referenceGeneration) suppliedMask = null;

    if (!activePrompt) {
      setError("请先输入提示词");
      return;
    }
    if (!configured) {
      setError("请先到设置页保存 API 密钥");
      return;
    }
    if (activeMode !== "outpaint" && customSizeEnabled && !customCheck.ok && !override.size) {
      setError(customCheck.message);
      return;
    }
    if (activeMode !== "generate" && !sourceImage) {
      setError(activeMode === "outpaint" ? "智能扩图需要上传原图" : "图片编辑需要上传原图");
      return;
    }
    if (activeMode === "outpaint" && (!outpaintCheck || !outpaintCheck.ok)) {
      setError(outpaintCheck?.error || "请设置有效的扩图范围");
      return;
    }
    if (activeMode === "edit" && references.length && suppliedMask) {
      setError("局部蒙版暂不能与多参考图同时提交。请移除参考图或清空蒙版后再加入队列，避免接口因尺寸不一致而失败。");
      return;
    }

    setError("");
    setErrorInfo(null);
    setNotice("");
    setIsEnqueueing(true);
    try {
    const id = crypto.randomUUID();
    setRequestId(id);
    setProgress({ requestId: id, status: "准备进入队列", progress: 2 });
    let finalSize = activeSize;
    let finalRatio = activeRatio;
    let preparedImage: File | null = null;
    let outpaintRecipe: OutpaintRecipe | undefined;
    try {
      if (referenceGeneration) {
        const preparedReferences = await Promise.all(references.map((file) => prepareUpload(file)));
        preparedImage = await createReferenceBoard(preparedReferences[0], preparedReferences.slice(1), "generate");
      }
      if (activeMode === "edit" && sourceImage) {
        const prepared = await prepareUpload(sourceImage);
        preparedImage = await createReferenceBoard(prepared, references);
        if (suppliedMask && !references.length) suppliedMask = await resizeMaskToMatch(suppliedMask, preparedImage);
      }
      if (activeMode === "outpaint" && sourceImage) {
        const prepared = await prepareUpload(sourceImage);
        const source = await readImage(prepared);
        const layoutResult = outpaintStrategy === "percent"
          ? outpaintFromPercent(source.naturalWidth, source.naturalHeight, outpaintMargins)
          : outpaintToSize(source.naturalWidth, source.naturalHeight, outpaintTargetSize);
        if (!layoutResult.ok) { setError(layoutResult.error); return; }
        const validation = await callIpc(() => window.imageStudio.outpaint.prepare({ sourceWidth: source.naturalWidth, sourceHeight: source.naturalHeight, targetSize: layoutResult.layout.targetSize }), { fallbackError: "扩图尺寸无效" });
        if (!validation.ok) return;
        const files = await createOutpaintFiles(prepared, layoutResult.layout);
        preparedImage = files.image;
        suppliedMask = files.mask;
        finalSize = layoutResult.layout.targetSize;
        finalRatio = outpaintPreset || activeRatio;
        outpaintRecipe = {
          sourceSize: `${source.naturalWidth}x${source.naturalHeight}`,
          targetSize: finalSize,
          top: layoutResult.layout.top,
          right: layoutResult.layout.right,
          bottom: layoutResult.layout.bottom,
          left: layoutResult.layout.left,
          preset: outpaintPreset || undefined,
        };
      }
    } catch (cause) {
      setError((cause as Error).message || "图片预处理失败");
      return;
    }
    const recipe = createRecipe({
      prompt: activePrompt,
      negativePrompt: activeNegativePrompt,
      model: imageModel.trim(),
      size: finalSize,
      n: activeMode === "generate" && !referenceGeneration ? activeN : 1,
      quality: activeQuality,
      ratio: finalRatio,
      resolution: activeResolution,
      mode: activeMode,
      projectId: activeProject,
      tags: activeTags,
      sourceId: override.sourceId,
      variationLabel: override.variationLabel,
      referenceCount: activeMode === "outpaint" ? undefined : references.length || undefined,
      outpaint: outpaintRecipe,
    });
    const payload: Record<string, unknown> = {
      requestId: id,
      recipe,
      title: activePrompt.slice(0, 48),
    };
    if ((activeMode !== "generate" || referenceGeneration) && preparedImage) {
      payload.image = await fileToPayload(preparedImage);
      if (suppliedMask) {
        const maskFile = suppliedMask.type === "image/png"
          ? suppliedMask
          : await prepareUpload(suppliedMask);
        payload.mask = await fileToPayload(maskFile);
      }
    }
    const result = await callIpc(() => window.imageStudio.queue.enqueue({ kind: activeMode === "generate" && !referenceGeneration ? "generate" : "edit", payload }), { fallbackError: "无法创建任务", onError: setError });
    if (!result.ok || !result.job) return;
    setActiveJobId(result.job.id);
    setNotice("任务已加入队列，将按顺序生成");
    await refreshQueue();
    } finally {
      setIsEnqueueing(false);
    }
  };

  const cancelActive = async () => {
    if (!activeJobId) return;
    const result = await callIpc(() => window.imageStudio.queue.cancel(activeJobId), { fallbackError: "取消失败", onError: setError });
    if (result.ok) setNotice("已取消当前任务");
  };

  const quickPreset = (value: "fast" | "stable" | "detail") => {
    if (value === "fast") {
      setResolution("1k");
      setQuality("auto");
      setN(1);
      setNotice("快速预览：1K、自动细节、1 张");
    } else if (value === "stable") {
      setResolution("2k");
      setQuality("auto");
      setN(1);
      setNotice("稳定创作：2K、自动细节、1 张");
    } else {
      setResolution("4k");
      setQuality("auto");
      setN(1);
      setNotice("最终高清：4K、自动细节、1 张");
    }
  };

  // 供 App 的 continueEdit / startOutpaint 使用：逐字承载原两函数的 composer 状态写入逻辑。
  const loadRecipe = (output: Output, kind: "edit" | "outpaint") => {
    const recipe = output.recipe;
    if (kind === "edit") {
      setMode("edit");
      setPrompt(recipe.prompt);
      setNegativePrompt(recipe.negativePrompt);
      setImage(b64ToFile(output.b64, "image-studio-source.png"));
      if (recipe.ratio) setRatio(recipe.ratio);
      if (recipe.resolution) setResolution(recipe.resolution);
      if (recipe.quality) setQuality(recipe.quality);
      setProjectId(recipe.projectId || "inbox");
      setTagsText(formatTags(recipe.tags));
      setNotice("已带入图片和参数，可局部涂抹蒙版后继续编辑");
    } else {
      setMode("outpaint");
      setPrompt(recipe.prompt);
      setNegativePrompt(recipe.negativePrompt);
      setImage(b64ToFile(output.b64, "image-studio-outpaint-source.png"));
      setProjectId(recipe.projectId || "inbox");
      setTagsText(formatTags(recipe.tags));
      setOutpaintStrategy("percent");
      setOutpaintMargins({ top: 25, right: 25, bottom: 25, left: 25 });
      setOutpaintPreset("");
      setNotice("已进入智能扩图，可选择快捷比例或分别设置四向扩展量");
    }
  };

  return {
    activeJobId,
    setActiveJobId,
    isEnqueueing,
    progress,
    setProgress,
    requestId,
    chosenSize,
    enqueue,
    loadRecipe,
    state: {
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
    },
    actions: {
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
    },
  };
}

export type ComposerState = ReturnType<typeof useComposer>["state"];
export type ComposerActions = ReturnType<typeof useComposer>["actions"];
