import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import imaginationTitle from "./assets/imagination-title-cropped.png";
import { GalleryWorkspace } from "./components/GalleryWorkspace";
import { MaskPainter } from "./components/MaskPainter";
import {
  applyLocalPromptAction,
  formatGenerationParameters,
  parseTags,
  PromptAction,
  validateCanvasSize,
  variationOptions,
} from "./lib/creative";
import {
  createOutpaintFiles,
  OutpaintMargins,
  outpaintFromPercent,
  outpaintToSize,
  targetSizeForRatio,
} from "./lib/outpaint";

type Mode = "generate" | "edit" | "outpaint" | "gallery" | "queue" | "settings";
type Output = {
  id: string;
  b64: string;
  createdAt: number;
  galleryId?: string;
  recipe: ImageRecipeV1;
};
type SubmitOverride = {
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

const resolutionOptions = [
  { value: "1k", label: "1K（标准）" },
  { value: "2k", label: "2K（高清）" },
  { value: "4k", label: "4K（超清）" },
];
const ratioOptions = [
  { value: "1:1", label: "1:1 正方形" },
  { value: "4:3", label: "4:3 横向" },
  { value: "3:4", label: "3:4 竖向" },
  { value: "3:2", label: "3:2 横向" },
  { value: "2:3", label: "2:3 竖向" },
  { value: "16:9", label: "16:9 宽屏" },
  { value: "9:16", label: "9:16 手机" },
  { value: "4:5", label: "4:5 人像" },
  { value: "5:4", label: "5:4 横幅" },
  { value: "21:9", label: "21:9 超宽" },
];
const sizeMatrix: Record<string, Record<string, string>> = {
  "1k": {
    "1:1": "1024x1024", "4:3": "1024x768", "3:4": "768x1024",
    "3:2": "1536x1024", "2:3": "1024x1536", "16:9": "1536x864",
    "9:16": "864x1536", "4:5": "1024x1280", "5:4": "1280x1024",
    "21:9": "1536x656",
  },
  "2k": {
    "1:1": "2048x2048", "4:3": "2048x1536", "3:4": "1536x2048",
    "3:2": "2048x1360", "2:3": "1360x2048", "16:9": "2048x1152",
    "9:16": "1152x2048", "4:5": "1632x2048", "5:4": "2048x1632",
    "21:9": "2048x880",
  },
  "4k": {
    "1:1": "2880x2880", "4:3": "3328x2480", "3:4": "2480x3328",
    "3:2": "3520x2352", "2:3": "2352x3520", "16:9": "3840x2160",
    "9:16": "2160x3840", "4:5": "2560x3200", "5:4": "3200x2560",
    "21:9": "3840x1648",
  },
};
const qualities = [
  { value: "auto", label: "自动" },
  { value: "low", label: "快速草图" },
  { value: "medium", label: "标准" },
  { value: "high", label: "最高细节" },
];
const socialPresets = [
  { value: "1080x1080", label: "1:1 方图" },
  { value: "1080x1350", label: "4:5 竖图" },
  { value: "1920x1080", label: "16:9 横图" },
  { value: "1080x1920", label: "9:16 竖图" },
];

function dataUrlFor(output: Output) {
  return "data:image/png;base64," + output.b64;
}

function recipeFromQueueInput(input: Record<string, unknown>, kind: "generate" | "edit", fallbackSize: string): ImageRecipeV1 {
  if (input.recipe && typeof input.recipe === "object") return input.recipe as ImageRecipeV1;
  return {
    version: 1,
    prompt: String(input.userPrompt || input.prompt || ""),
    negativePrompt: String(input.negativePrompt || ""),
    model: String(input.model || "gpt-image-2"),
    size: String(input.size || fallbackSize),
    ratio: typeof input.ratio === "string" ? input.ratio : undefined,
    resolution: typeof input.resolution === "string" ? input.resolution : undefined,
    quality: typeof input.quality === "string" ? input.quality : undefined,
    n: Number(input.n) || 1,
    mode: kind,
    projectId: String(input.projectId || "inbox"),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    createdAt: new Date().toISOString(),
    sourceId: typeof input.sourceId === "string" ? input.sourceId : undefined,
    variationLabel: typeof input.variationLabel === "string" ? input.variationLabel : undefined,
  };
}

function recipeModeLabel(recipe: ImageRecipeV1) {
  return recipe.mode === "outpaint" ? "智能扩图" : recipe.mode === "edit" ? "图片编辑" : "文生图";
}

function b64ToFile(b64: string, name: string) {
  const bytes = Uint8Array.from(atob(b64), (value) => value.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
}

function fileToPayload(file: File) {
  return new Promise<{ name: string; type: string; data: number[] }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      data: Array.from(new Uint8Array(reader.result as ArrayBuffer)),
    });
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function readImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    image.src = url;
  });
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
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.9 : undefined),
  );
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.88 : undefined));
  return blob ? new File([blob], transparent ? "reverse-source.png" : "reverse-source.jpg", { type }) : file;
}

function drawContain(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

async function createReferenceBoard(main: File, references: File[]) {
  if (!references.length) return main;
  const images = await Promise.all([main, ...references.slice(0, 3)].map(readImage));
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
    const caption = index === 0
      ? "主图：保持主体"
      : "参考图 " + String(index) + "：借鉴风格 / 元素";
    context.fillText(caption, x + 42, y + 55);
  });
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  return blob
    ? new File([blob], "image-studio-reference-board.jpg", { type: "image/jpeg" })
    : main;
}

async function exportSocialCanvas(output: Output, preset: string, fill: "light" | "blur") {
  const match = /^(\d+)x(\d+)$/.exec(preset);
  if (!match) throw new Error("导出尺寸无效");
  const width = Number(match[1]);
  const height = Number(match[2]);
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

function App() {
  const [mode, setMode] = useState<Mode>("generate");
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
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [preview, setPreview] = useState<Output | null>(null);
  const [previewContextMenu, setPreviewContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [exportOutput, setExportOutput] = useState<Output | null>(null);
  const [socialPreset, setSocialPreset] = useState("1080x1080");
  const [socialFill, setSocialFill] = useState<"light" | "blur">("light");
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [imageModel, setImageModel] = useState("gpt-image-2");
  const [chatModel, setChatModel] = useState("gpt-4o");
  const [autoArchive, setAutoArchive] = useState(true);
  const [saveDir, setSaveDir] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [checkUpdatesAtStartup, setCheckUpdatesAtStartup] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ phase: "idle", message: "尚未检查更新" });
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
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [projectId, setProjectId] = useState("inbox");
  const [tagsText, setTagsText] = useState("");
  const [queueItems, setQueueItems] = useState<QueueJob[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [isEnqueueing, setIsEnqueueing] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [progress, setProgress] = useState<AppProgress | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [errorInfo, setErrorInfo] = useState<GenerationErrorInfo | null>(null);
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

  const refreshWorkspace = useCallback(async () => {
    try {
      const workspace = await window.imageStudio.gallery.workspace();
      setProjects(workspace.projects || []);
      if (!workspace.projects.some((project) => project.id === projectId)) {
        setProjectId("inbox");
      }
    } catch (cause) {
      setError("本地图库读取失败：" + ((cause as Error).message || "请检查保存目录"));
    }
  }, [projectId]);
  const refreshQueue = useCallback(async () => {
    const result = await window.imageStudio.queue.list();
    setQueueItems(result.items || []);
  }, []);

  useEffect(() => {
    void window.imageStudio.settings.get().then((value) => {
      setConfigured(value.configured);
      setBaseUrl(value.baseUrl);
      setImageModel(value.imageModel);
      setChatModel(value.chatModel);
      setAutoArchive(value.autoArchive);
      setSaveDir(value.saveDir || "");
    });
    void window.imageStudio.templates.list().then((value) => setTemplates(value.items));
    void window.imageStudio.updates.get().then((value) => {
      setCheckUpdatesAtStartup(value.checkAtStartup);
      setAppVersion(value.appVersion);
      setUpdateStatus(value.status);
    });
    void refreshWorkspace();
    void refreshQueue();
  }, [refreshQueue, refreshWorkspace]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setPreviewContextMenu(null);
    setError("");
    setNotice("");
    setErrorInfo(null);
  }, [mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPreviewContextMenu(null);
      if (preview) setPreview(null);
      else if (exportOutput) setExportOutput(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportOutput, preview]);

  useEffect(() => window.imageStudio.onUpdateStatus((value) => setUpdateStatus(value)), []);

  useEffect(() => {
    const offProgress = window.imageStudio.onProgress((value) => {
      if (value.requestId === requestId) setProgress(value);
    });
    const offQueue = window.imageStudio.onQueueUpdate((value) => setQueueItems(value));
    const offResult = window.imageStudio.onQueueResult((value) => {
      const result = value.result;
      const gallery = result.gallery || [];
      const input = value.job.input;
      const baseRecipe = result.recipe || recipeFromQueueInput(input, value.job.kind, chosenSize);
      const items = (result.images || [])
        .filter((item) => item.b64_json)
        .map((item, index) => ({
          id: crypto.randomUUID(),
          b64: item.b64_json || "",
          createdAt: Date.now(),
          galleryId: gallery[index]?.id,
          recipe: gallery[index]?.recipe || {
            ...baseRecipe,
            seed: item.seed === undefined ? baseRecipe.seed : String(item.seed),
          },
        }));
      if (value.job.id === activeJobId) {
        setOutputs(items);
        setActiveJobId("");
        const elapsed = "生成完成，用时 " + ((result.elapsedMs || 0) / 1000).toFixed(1) + " 秒。";
        setNotice(result.archiveWarning
          ? elapsed + result.archiveWarning
          : gallery.length
            ? elapsed + "已归档到本地图库。"
            : elapsed + "自动归档已关闭，请按需手动保存 PNG。");
      } else {
        setNotice("队列任务已完成：" + String(items.length) + " 张图片");
      }
      void refreshWorkspace();
    });
    const offError = window.imageStudio.onQueueError((job) => {
      if (job.id === activeJobId) {
        setActiveJobId("");
        setErrorInfo(job.errorInfo || null);
        setError(job.errorInfo ? "" : job.error || "任务失败");
      } else {
        setNotice("队列任务失败：" + (job.error || "未知错误"));
      }
    });
    return () => {
      offProgress();
      offQueue();
      offResult();
      offError();
    };
  }, [activeJobId, chosenSize, refreshWorkspace, requestId]);

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
    const title = update ? selected!.title : window.prompt("模板名称", kind === "negative" ? "我的负面词" : "我的模板");
    if (!title?.trim()) return;
    const result = await window.imageStudio.templates.save({
      id: update ? selected!.id : undefined,
      title,
      category: "自定义",
      prompt: value,
      kind,
      ratio: kind === "positive" ? ratio : undefined,
      resolution: kind === "positive" ? resolution : undefined,
      quality: kind === "positive" ? quality : undefined,
    });
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
    if (!item || item.builtin || !window.confirm("删除模板“" + item.title + "”吗？")) return;
    await window.imageStudio.templates.delete(item.id);
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
    const result = await window.imageStudio.prompt.enhance({
      prompt,
      mode: mode === "edit" ? "edit" : "generate",
    });
    setEnhancing(false);
    if (!result.ok || !result.prompt) {
      setError(result.error || "AI 增强失败，原提示词未改变");
      return;
    }
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
      const result = await window.imageStudio.prompt.reverse({ image: await fileToPayload(prepared) });
      if (!result.ok) { setError(result.error || "图反推失败，原提示词未改变"); return; }
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
        const validation = await window.imageStudio.outpaint.prepare({ sourceWidth: source.naturalWidth, sourceHeight: source.naturalHeight, targetSize: layoutResult.layout.targetSize });
        if (!validation.ok) { setError(validation.error || "扩图尺寸无效"); return; }
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
    const recipe: ImageRecipeV1 = {
      version: 1,
      prompt: activePrompt,
      negativePrompt: activeNegativePrompt,
      model: imageModel.trim(),
      size: finalSize,
      n: activeMode === "generate" ? activeN : 1,
      quality: activeQuality,
      ratio: finalRatio,
      resolution: activeResolution,
      mode: activeMode,
      projectId: activeProject,
      tags: activeTags,
      createdAt: new Date().toISOString(),
      sourceId: override.sourceId,
      variationLabel: override.variationLabel,
      outpaint: outpaintRecipe,
    };
    const payload: Record<string, unknown> = {
      requestId: id,
      recipe,
      title: activePrompt.slice(0, 48),
    };
    if (activeMode !== "generate" && preparedImage) {
      payload.image = await fileToPayload(preparedImage);
      if (suppliedMask) {
        const maskFile = suppliedMask.type === "image/png"
          ? suppliedMask
          : await prepareUpload(suppliedMask);
        payload.mask = await fileToPayload(maskFile);
      }
    }
    const result = await window.imageStudio.queue.enqueue({ kind: activeMode === "generate" ? "generate" : "edit", payload });
    if (!result.ok || !result.job) {
      setError(result.error || "无法创建任务");
      return;
    }
    setActiveJobId(result.job.id);
    setNotice("任务已加入队列，将按顺序生成");
    await refreshQueue();
    } finally {
      setIsEnqueueing(false);
    }
  };

  const cancelActive = async () => {
    if (!activeJobId) return;
    const result = await window.imageStudio.queue.cancel(activeJobId);
    if (!result.ok) setError(result.error || "取消失败");
    else setNotice("已取消当前任务");
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

  const regenerate = (output: Output) => {
    const recipe = output.recipe;
    void enqueue({
      prompt: recipe.prompt,
      negativePrompt: recipe.negativePrompt,
      size: recipe.size,
      ratio: recipe.ratio,
      resolution: recipe.resolution,
      quality: recipe.quality,
      n: 1,
      projectId: recipe.projectId,
      tags: recipe.tags,
      sourceId: output.galleryId,
      mode: "generate",
    });
  };

  const continueEdit = (output: Output) => {
    const recipe = output.recipe;
    setMode("edit");
    setPrompt(recipe.prompt);
    setNegativePrompt(recipe.negativePrompt);
    setImage(b64ToFile(output.b64, "image-studio-source.png"));
    if (recipe.ratio) setRatio(recipe.ratio);
    if (recipe.resolution) setResolution(recipe.resolution);
    if (recipe.quality) setQuality(recipe.quality);
    setProjectId(recipe.projectId || "inbox");
    setTagsText(recipe.tags.join("，"));
    setNotice("已带入图片和参数，可局部涂抹蒙版后继续编辑");
  };

  const startOutpaint = (output: Output) => {
    const recipe = output.recipe;
    setMode("outpaint");
    setPrompt(recipe.prompt);
    setNegativePrompt(recipe.negativePrompt);
    setImage(b64ToFile(output.b64, "image-studio-outpaint-source.png"));
    setProjectId(recipe.projectId || "inbox");
    setTagsText(recipe.tags.join("，"));
    setOutpaintStrategy("percent");
    setOutpaintMargins({ top: 25, right: 25, bottom: 25, left: 25 });
    setOutpaintPreset("");
    setNotice("已进入智能扩图，可选择快捷比例或分别设置四向扩展量");
  };

  const createVariation = (
    source: Output | GalleryItem,
    option: (typeof variationOptions)[number] = variationOptions[0],
  ) => {
    const sourceId = "fileName" in source ? source.id : source.galleryId;
    const recipe = source.recipe;
    void enqueue({
      prompt: recipe.prompt + "\n\n" + option.suffix,
      negativePrompt: recipe.negativePrompt,
      mode: "generate",
      n: 1,
      projectId: recipe.projectId,
      tags: recipe.tags,
      sourceId,
      variationLabel: option.label,
    });
  };

  const saveOutput = async (output: Output) => {
    const result = await window.imageStudio.saveImage({
      dataUrl: dataUrlFor(output),
      suggestedName: "image-studio-" + new Date(output.createdAt).toISOString().replace(/[:.]/g, "-") + ".png",
      recipe: output.recipe,
    });
    if (!result.canceled) setNotice("已保存：" + (result.path || ""));
  };

  const exportSocial = async () => {
    if (!exportOutput) return;
    try {
      const dataUrl = await exportSocialCanvas(exportOutput, socialPreset, socialFill);
      const result = await window.imageStudio.saveImage({
        dataUrl,
        suggestedName: "image-studio-social-" + socialPreset + ".png",
        recipe: { ...exportOutput.recipe, size: socialPreset },
      });
      if (!result.canceled) {
        setNotice("社交平台成品已保存：" + (result.path || ""));
        setExportOutput(null);
      }
    } catch (cause) {
      setError((cause as Error).message || "导出失败");
    }
  };

  const saveSettings = async () => {
    if (!baseUrl.trim()) {
      setError("请输入 API Base URL");
      return;
    }
    try { new URL(baseUrl.trim()); } catch { setError("API Base URL 格式无效"); return; }
    if (!apiKey.trim() && !configured) {
      setError("请输入 API 密钥");
      return;
    }
    if (!imageModel.trim()) {
      setError("请输入图片模型名称");
      return;
    }
    if (!chatModel.trim()) {
      setError("请输入聊天模型名称");
      return;
    }
    await window.imageStudio.settings.save({ apiKey, baseUrl, imageModel, chatModel, autoArchive });
    setConfigured(true);
    setApiKey("");
    setNotice("设置已保存，密钥不会显示在界面中");
  };

  const testSettings = async () => {
    setTestMessage("测试中…");
    const result = await window.imageStudio.settings.test();
    setTestMessage(result.message);
  };

  const setUpdateStartupPreference = async (enabled: boolean) => {
    setCheckUpdatesAtStartup(enabled);
    const result = await window.imageStudio.updates.setStartup(enabled);
    if (!result.ok) {
      setCheckUpdatesAtStartup(!enabled);
      setError("无法保存更新检查设置");
    }
  };

  const checkUpdates = async () => {
    setUpdateStatus((current) => ({ ...current, phase: "checking", message: "正在检查更新…" }));
    const result = await window.imageStudio.updates.check();
    if (!result.ok) setUpdateStatus((current) => ({ ...current, phase: "error", message: result.message }));
  };

  const downloadUpdate = async () => {
    const result = await window.imageStudio.updates.download();
    if (!result.ok) setError(result.message);
  };

  const installUpdate = async () => {
    const result = await window.imageStudio.updates.install();
    if (!result.ok) setError(result.message);
  };

  const galleryOpen = (
    item: GalleryItem,
    b64: string,
    action: "preview" | "reuse" | "edit" | "outpaint",
  ) => {
    const output: Output = {
      id: item.id,
      b64,
      createdAt: Date.parse(item.createdAt),
      galleryId: item.id,
      recipe: item.recipe,
    };
    if (action === "preview") {
      setPreview(output);
    } else if (action === "edit") {
      continueEdit(output);
    } else if (action === "outpaint") {
      startOutpaint(output);
    } else {
      setMode("generate");
      setPrompt(item.recipe.prompt);
      setNegativePrompt(item.recipe.negativePrompt);
      setProjectId(item.recipe.projectId);
      setTagsText(item.recipe.tags.join("，"));
      if (item.recipe.ratio) setRatio(item.recipe.ratio);
      if (item.recipe.resolution) setResolution(item.recipe.resolution);
      if (item.recipe.quality) setQuality(item.recipe.quality);
      setNotice("已复用历史参数，可修改提示词后生成");
    }
  };

  const composer = (
    <section className="card composer">
      <div className="mode-title">
        <div>
          <span className="eyebrow">{mode === "outpaint" ? "SMART OUTPAINT" : mode === "edit" ? "IMAGE EDIT" : "CREATE STUDIO"}</span>
          <h2>{mode === "outpaint" ? "智能扩展画面" : mode === "edit" ? "编辑与局部重绘" : "描述你想要的画面"}</h2>
        </div>
        <span className="pill">{mode === "outpaint" ? "透明画布 + 自动蒙版" : mode === "edit" ? "原图 + 蒙版 + 参考图" : "提示词 + 变体 + 队列"}</span>
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
          <label className="upload ghost">
            {reverseImage ? "待分析：" + reverseImage.name : "选择需要反推的图片"}
            <input type="file" accept="image/*" onChange={(event) => { setReverseImage(event.target.files?.[0] || null); setReverseResult(null); }} />
          </label>
          <button className="assistant-ai" onClick={() => void reversePrompt()} disabled={reversing}>{reversing ? "分析中…" : "生成中英文提示词"}</button>
        </div>
        {reverseResult && <div className="reverse-results">
          {[{ key: "zh", label: "中文提示词", value: reverseResult.zh }, { key: "en", label: "English Prompt", value: reverseResult.en }].map((item) => item.value && (
            <article key={item.key}>
              <strong>{item.label}</strong><p>{item.value}</p>
              <div><button onClick={() => applyReversePrompt(item.value, "replace")}>替换当前</button><button onClick={() => applyReversePrompt(item.value, "append")}>追加</button><button onClick={() => void window.imageStudio.clipboard.copyText(item.value).then(() => setNotice("反推提示词已复制"))}>复制</button></div>
            </article>
          ))}
        </div>}
      </details>

      {(mode === "edit" || mode === "outpaint") && (
        <>
          <div className="upload-row">
            <label className="upload">
              {image ? "原图：" + image.name : mode === "outpaint" ? "上传扩图原图" : "上传原图"}
              <input type="file" accept="image/*" onChange={(event) => setImage(event.target.files?.[0] || null)} />
            </label>
            {mode === "edit" && <label className="upload ghost">
              {externalMask ? "外部蒙版：" + externalMask.name : "可选外部蒙版"}
              <input type="file" accept="image/*" onChange={(event) => setExternalMask(event.target.files?.[0] || null)} />
            </label>}
            {mode === "edit" && <label className="upload ghost">
              添加参考图（{references.length}/3）
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => setReferences(Array.from(event.target.files || []).slice(0, 3))}
              />
            </label>}
          </div>
          {mode === "edit" && references.length > 0 && (
            <div className="reference-list">
              {references.map((file, index) => (
                <span key={file.name + String(index)}>
                  参考图 {index + 1}：{file.name}
                  <button onClick={() => setReferences((current) => current.filter((_, value) => value !== index))}>×</button>
                </span>
              ))}
            </div>
          )}
          {mode === "edit" && <MaskPainter image={image} onMaskChange={maskChange} />}
        </>
      )}

      {mode === "outpaint" && <section className="outpaint-panel">
        <div className="outpaint-head"><div><strong>扩图画布</strong><small>{sourceDimensions ? `原图 ${sourceDimensions.width}x${sourceDimensions.height}` : "上传原图后可设置目标画布"}</small></div><span>仅扩展，不裁剪</span></div>
        <div className="outpaint-presets">
          <span>快捷转换</span>
          {["1:1", "4:5", "16:9", "9:16"].map((value) => <button className={outpaintPreset === value ? "active" : ""} key={value} onClick={() => chooseOutpaintPreset(value)}>{value}</button>)}
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
          <select value={n} onChange={(event) => setN(Number(event.target.value))} disabled={mode !== "generate"}>
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
      <div className="run-row">
        <button className="primary generate" onClick={() => void enqueue()} disabled={isEnqueueing}>
          {isEnqueueing ? "正在准备任务…" : activeJobId ? "继续加入队列" : mode === "outpaint" ? "加入扩图队列" : mode === "edit" ? "加入编辑队列" : "加入生成队列"}
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

  const resultPanel = (
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
          <span>✦</span>
          <p>生成后的图片会显示在这里</p>
          <small>队列、项目、变体与交付工具会保留你的创作过程。</small>
        </div>
      ) : (
        <div className="gallery">
          {outputs.map((output) => (
            <article key={output.id}>
              <img className="result-image" onClick={() => setPreview(output)} src={dataUrlFor(output)} alt="生成结果" />
              <div className="result-caption">
                <strong>{output.recipe.variationLabel || (output.recipe.mode === "outpaint" ? "智能扩图" : "新生成图片")}</strong>
                <small>{output.recipe.size} · {output.recipe.projectId}{output.recipe.seed ? " · Seed " + output.recipe.seed : ""}</small>
              </div>
              {output.recipe.seed && <button className="seed-chip" onClick={() => void window.imageStudio.clipboard.copyText(output.recipe.seed!).then(() => setNotice("Seed 已复制"))}>Seed：{output.recipe.seed} · 点击复制</button>}
              <div className="result-actions">
                <button onClick={() => void saveOutput(output)}>保存 PNG</button>
                <button onClick={() => void window.imageStudio.clipboard.copyImage(output.b64).then(() => setNotice("图片已复制到剪贴板"))}>复制图片</button>
                <button onClick={() => void window.imageStudio.clipboard.copyText(output.recipe.prompt).then(() => setNotice("提示词已复制"))}>复制提示词</button>
                <button onClick={() => void window.imageStudio.clipboard.copyText(formatGenerationParameters(output.recipe)).then(() => setNotice("完整参数已复制"))}>复制参数</button>
                <button onClick={() => regenerate(output)}>再生成</button>
                <button onClick={() => continueEdit(output)}>继续编辑</button>
                <button onClick={() => startOutpaint(output)}>智能扩图</button>
                <button onClick={() => setExportOutput(output)}>社媒导出</button>
              </div>
              <div className="variation-row">
                {variationOptions.map((option) => (
                  <button key={option.id} onClick={() => createVariation(output, option)}>{option.label}</button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  const queuePanel = (
    <section className="card queue-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">TASK QUEUE</span>
          <h2>生成任务队列</h2>
          <small>所有任务按顺序提交，避免并发限流和意外重复计费。</small>
        </div>
        <button className="secondary" onClick={() => void refreshQueue()}>刷新</button>
      </div>
      {queueItems.length === 0 ? (
        <div className="empty"><span>◌</span><p>队列为空</p><small>提交生成或变体后，任务会显示在这里。</small></div>
      ) : (
        <div className="queue-list">
          {queueItems.map((job) => (
            <article key={job.id}>
              <div>
                <strong>{recipeModeLabel(recipeFromQueueInput(job.input, job.kind, "1024x1024"))} · {job.status}</strong>
                <small>{new Date(job.createdAt).toLocaleString()} · 尝试 {job.attempts} 次</small>
                <p>{recipeFromQueueInput(job.input, job.kind, "1024x1024").prompt}</p>
                {job.errorInfo ? <div className="queue-error"><em>{job.errorInfo.title}：{job.errorInfo.message}</em><small>{job.errorInfo.suggestion}</small></div> : job.error && <em>{job.error}</em>}
              </div>
              <div className="queue-actions">
                {["failed", "interrupted", "cancelled"].includes(job.status) && (
                  <button onClick={() => void window.imageStudio.queue.retry(job.id)}>重试</button>
                )}
                {["queued", "running"].includes(job.status) && (
                  <button onClick={() => void window.imageStudio.queue.cancel(job.id)}>取消</button>
                )}
                {job.status !== "running" && (
                  <button onClick={() => void window.imageStudio.queue.remove(job.id)}>移除</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  const settingsPanel = (
    <section className="card settings">
      <span className="eyebrow">CONNECTION & STORAGE</span>
      <h2>连接设置</h2>
      <p className="muted">
        支持符合当前请求格式的 OpenAI 兼容接口。API 密钥仅保存到 Windows 凭据库，不会显示原文或写入项目文件。
      </p>
      <label>API Base URL<input placeholder="例如：https://api.example.com/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label>API 密钥
        <input
          type="password"
          placeholder={configured ? "已保存，输入新值可覆盖" : "粘贴当前平台提供的 API 密钥"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <div className="settings-models">
        <label>图片模型<input placeholder="平台提供的图片模型名称" value={imageModel} onChange={(event) => setImageModel(event.target.value)} /></label>
        <label>聊天模型<input placeholder="用于提示词增强和图反推" value={chatModel} onChange={(event) => setChatModel(event.target.value)} /></label>
      </div>
      <label className="archive-toggle">
        <input type="checkbox" checked={autoArchive} onChange={(event) => setAutoArchive(event.target.checked)} />
        自动归档生成图片到本地图库与收件箱
      </label>
      {saveDir && <div className="storage-path"><strong>本地保存位置</strong><code>{saveDir}</code><small>旧版图库存在时会继续沿用；新安装设备默认使用系统“图片”文件夹。</small></div>}
      <section className="update-settings">
        <div>
          <span className="eyebrow">APPLICATION UPDATE</span>
          <h3>软件更新</h3>
          <p>当前版本：v{appVersion || "—"}。发现新版本时会先询问你是否下载，不会强制更新。</p>
        </div>
        <label className="archive-toggle">
          <input type="checkbox" checked={checkUpdatesAtStartup} onChange={(event) => void setUpdateStartupPreference(event.target.checked)} />
          启动时检查 GitHub 更新
        </label>
        <div className="update-actions">
          <button className="secondary" onClick={() => void checkUpdates()} disabled={updateStatus.phase === "checking"}>
            {updateStatus.phase === "checking" ? "检查中…" : "检查更新"}
          </button>
          {updateStatus.phase === "available" && <button className="primary" onClick={() => void downloadUpdate()}>下载 v{updateStatus.version}</button>}
          {updateStatus.phase === "downloading" && <span className="update-progress">下载中 {updateStatus.progress || 0}%</span>}
          {updateStatus.phase === "downloaded" && <button className="primary" onClick={() => void installUpdate()}>重启并安装 v{updateStatus.version}</button>}
        </div>
        <p className={updateStatus.phase === "error" ? "update-status error-text" : "update-status"}>{updateStatus.message}</p>
      </section>
      <div className="actions">
        <button className="primary" onClick={() => void saveSettings()}>保存设置</button>
        <button className="secondary" onClick={() => void testSettings()}>测试连接</button>
      </div>
      {testMessage && <p className="hint">{testMessage}</p>}
    </section>
  );

  const runningCount = useMemo(
    () => queueItems.filter((item) => ["queued", "running"].includes(item.status)).length,
    [queueItems],
  );

  return (
    <div className="app">
      <header>
        <div>
          <span className="eyebrow">AI IMAGE STUDIO · V1.3.0</span>
          <img className="brand-title" src={imaginationTitle} alt="把想象变成图片" />
          <p>本地创作工作台 · 提示词助手 · 项目图库 · 局部重绘 · 批量交付</p>
        </div>
        <div className="header-stack">
          <div className="status"><i className={configured ? "ok" : "off"}></i>{configured ? "已配置" : "未配置密钥"}</div>
          <button className="queue-chip" onClick={() => setMode("queue")}>任务队列 <strong>{runningCount}</strong></button>
        </div>
      </header>
      {(error || notice || errorInfo) && (
        <div className={error || errorInfo ? "feedback-toast feedback-error" : "feedback-toast feedback-success"} role={error || errorInfo ? "alert" : "status"}>
          <div>
            <strong>{errorInfo?.title || (error ? "需要处理" : "操作成功")}</strong>
            <span>{error || errorInfo?.message || notice}</span>
            {errorInfo?.suggestion && <small>{errorInfo.suggestion}</small>}
          </div>
          <button aria-label="关闭提示" onClick={() => { setError(""); setNotice(""); setErrorInfo(null); }}>×</button>
        </div>
      )}
      <div className="layout">
        <aside>
          <button className={mode === "generate" ? "nav active" : "nav"} onClick={() => setMode("generate")}>✦ 创作生成</button>
          <button className={mode === "edit" ? "nav active" : "nav"} onClick={() => setMode("edit")}>◌ 图片编辑</button>
          <button className={mode === "outpaint" ? "nav active" : "nav"} onClick={() => setMode("outpaint")}>↗ 智能扩图</button>
          <button className={mode === "gallery" ? "nav active" : "nav"} onClick={() => setMode("gallery")}>▧ 项目图库</button>
          <button className={mode === "queue" ? "nav active" : "nav"} onClick={() => setMode("queue")}>⇢ 任务队列</button>
          <button className={mode === "settings" ? "nav active" : "nav"} onClick={() => setMode("settings")}>⚙ 设置</button>
          <div className="aside-tip">
            <span>当前模型</span><strong>{imageModel}</strong>
            <p>提示词增强：{chatModel}<br />图片、项目与队列均保存在本机。</p>
          </div>
        </aside>
        <main>
          {mode === "settings" ? settingsPanel : mode === "gallery" ? (
            <GalleryWorkspace
              onOpen={galleryOpen}
              onVariation={(item) => createVariation(item)}
              onNotice={setNotice}
            />
          ) : mode === "queue" ? queuePanel : <>{composer}{resultPanel}</>}
        </main>
      </div>

      {preview && (
        <div className="lightbox" onClick={() => { setPreviewContextMenu(null); setPreview(null); }}>
          <button className="lightbox-close" onClick={() => { setPreviewContextMenu(null); setPreview(null); }} aria-label="关闭预览">×</button>
          <img
            src={dataUrlFor(preview)}
            onClick={(event) => { event.stopPropagation(); setPreviewContextMenu(null); }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPreviewContextMenu({
                x: Math.max(8, Math.min(event.clientX, window.innerWidth - 152)),
                y: Math.max(8, Math.min(event.clientY, window.innerHeight - 72)),
              });
            }}
            alt="大图预览"
          />
          {previewContextMenu && (
            <div
              className="preview-context-menu"
              style={{ left: previewContextMenu.x, top: previewContextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                onClick={() => {
                  void window.imageStudio.clipboard.copyImage(preview.b64).then(() => setNotice("图片已复制到剪贴板"));
                  setPreviewContextMenu(null);
                }}
              >
                复制图片
              </button>
            </div>
          )}
          <span>右键点击图片可复制；点击空白处或右上角关闭</span>
        </div>
      )}
      {exportOutput && (
        <div className="export-modal" onClick={() => setExportOutput(null)}>
          <section onClick={(event) => event.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setExportOutput(null)}>×</button>
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
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
