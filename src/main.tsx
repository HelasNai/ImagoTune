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

type Mode = "generate" | "edit" | "gallery" | "queue" | "settings";
type Output = {
  id: string;
  b64: string;
  createdAt: number;
  galleryId?: string;
  prompt: string;
  model: string;
  mode: "generate" | "edit";
  size: string;
  quality?: string;
  ratio?: string;
  resolution?: string;
  projectId: string;
  tags: string[];
  sourceId?: string;
  variationLabel?: string;
};
type SubmitOverride = {
  prompt?: string;
  mode?: "generate" | "edit";
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
    ? new File([blob], "pinaic-reference-board.jpg", { type: "image/jpeg" })
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
  const [exportOutput, setExportOutput] = useState<Output | null>(null);
  const [socialPreset, setSocialPreset] = useState("1080x1080");
  const [socialFill, setSocialFill] = useState<"light" | "blur">("light");
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.pinaic.com/v1");
  const [autoArchive, setAutoArchive] = useState(true);
  const [testMessage, setTestMessage] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [projectId, setProjectId] = useState("inbox");
  const [tagsText, setTagsText] = useState("");
  const [queueItems, setQueueItems] = useState<QueueJob[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [progress, setProgress] = useState<AppProgress | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [enhancing, setEnhancing] = useState(false);

  const presetSize = sizeMatrix[resolution][ratio];
  const customCheck = validateCanvasSize(customSize);
  const chosenSize = customSizeEnabled && customCheck.ok ? customCheck.size : presetSize;
  const [width, height] = chosenSize.split("x").map(Number);
  const heavyRequest = resolution === "4k" || n > 1 || width * height > 3_000_000;
  const maskChange = useCallback((file: File | null) => setPaintedMask(file), []);

  const refreshWorkspace = useCallback(async () => {
    const workspace = await window.pinaic.gallery.workspace();
    setProjects(workspace.projects || []);
    if (!workspace.projects.some((project) => project.id === projectId)) {
      setProjectId("inbox");
    }
  }, [projectId]);
  const refreshQueue = useCallback(async () => {
    const result = await window.pinaic.queue.list();
    setQueueItems(result.items || []);
  }, []);

  useEffect(() => {
    void window.pinaic.settings.get().then((value) => {
      setConfigured(value.configured);
      setBaseUrl(value.baseUrl);
      setAutoArchive(value.autoArchive);
    });
    void window.pinaic.templates.list().then((value) => setTemplates(value.items));
    void refreshWorkspace();
    void refreshQueue();
  }, [refreshQueue, refreshWorkspace]);

  useEffect(() => {
    const offProgress = window.pinaic.onProgress((value) => {
      if (value.requestId === requestId) setProgress(value);
    });
    const offQueue = window.pinaic.onQueueUpdate((value) => setQueueItems(value));
    const offResult = window.pinaic.onQueueResult((value) => {
      const result = value.result;
      const gallery = result.gallery || [];
      const input = value.job.input;
      const userPrompt = String(input.userPrompt || input.prompt || "");
      const items = (result.images || [])
        .filter((item) => item.b64_json)
        .map((item, index) => ({
          id: crypto.randomUUID(),
          b64: item.b64_json || "",
          createdAt: Date.now(),
          galleryId: gallery[index]?.id,
          prompt: userPrompt,
          model: String(input.model || "gpt-image-2"),
          mode: value.job.kind,
          size: String(input.size || chosenSize),
          quality: typeof input.quality === "string" ? input.quality : undefined,
          ratio: typeof input.ratio === "string" ? input.ratio : undefined,
          resolution: typeof input.resolution === "string" ? input.resolution : undefined,
          projectId: String(input.projectId || "inbox"),
          tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
          sourceId: typeof input.sourceId === "string" ? input.sourceId : undefined,
          variationLabel: typeof input.variationLabel === "string" ? input.variationLabel : undefined,
        }));
      if (value.job.id === activeJobId) {
        setOutputs(items);
        setActiveJobId("");
        setNotice(
          "生成完成，用时 " + ((result.elapsedMs || 0) / 1000).toFixed(1) +
          " 秒，已归档到本地图库",
        );
      } else {
        setNotice("队列任务已完成：" + String(items.length) + " 张图片");
      }
      void refreshWorkspace();
    });
    const offError = window.pinaic.onQueueError((job) => {
      if (job.id === activeJobId) {
        setActiveJobId("");
        setError(job.error || "任务失败");
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
    if (!item) return;
    setSelectedTemplate(id);
    setOriginalPrompt(prompt);
    setPrompt(item.prompt);
    if (item.ratio && ratioOptions.some((value) => value.value === item.ratio)) setRatio(item.ratio);
    if (item.resolution && sizeMatrix[item.resolution]) setResolution(item.resolution);
    if (item.quality) setQuality(item.quality);
    setMode("generate");
  };

  const saveTemplate = async () => {
    if (!prompt.trim()) {
      setError("请先输入提示词再保存模板");
      return;
    }
    const title = window.prompt("模板名称", "我的模板");
    if (!title?.trim()) return;
    const result = await window.pinaic.templates.save({
      title,
      category: "自定义",
      prompt,
      ratio,
      resolution,
      quality,
    });
    if (result.item) {
      setTemplates((current) => [...current.filter((item) => item.id !== result.item!.id), result.item!]);
      setSelectedTemplate(result.item.id);
      setNotice("模板已保存");
    }
  };

  const deleteTemplate = async () => {
    const item = templates.find((value) => value.id === selectedTemplate);
    if (!item || item.builtin || !window.confirm("删除模板“" + item.title + "”吗？")) return;
    await window.pinaic.templates.delete(item.id);
    setTemplates((current) => current.filter((value) => value.id !== item.id));
    setSelectedTemplate("");
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
    const result = await window.pinaic.prompt.enhance({
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
    setNotice("已通过 gpt-4o 增强提示词");
  };

  const enqueue = async (override: SubmitOverride = {}) => {
    const activeMode = override.mode || (mode === "edit" ? "edit" : "generate");
    const activePrompt = (override.prompt ?? prompt).trim();
    const activeResolution = override.resolution || resolution;
    const activeRatio = override.ratio || ratio;
    const activeSize = override.size || chosenSize;
    const activeQuality = override.quality || quality;
    const activeN = override.n ?? n;
    const activeProject = override.projectId || projectId;
    const activeTags = override.tags || parseTags(tagsText);
    const sourceImage = override.image === undefined ? image : override.image;
    const suppliedMask = override.mask === undefined ? (paintedMask || externalMask) : override.mask;

    if (!activePrompt) {
      setError("请先输入提示词");
      return;
    }
    if (!configured) {
      setError("请先到设置页保存 API 密钥");
      return;
    }
    if (customSizeEnabled && !customCheck.ok && !override.size) {
      setError(customCheck.message);
      return;
    }
    if (activeMode === "edit" && !sourceImage) {
      setError("图片编辑需要上传原图");
      return;
    }

    setError("");
    setNotice("");
    const id = crypto.randomUUID();
    setRequestId(id);
    setProgress({ requestId: id, status: "准备进入队列", progress: 2 });
    const ratioPrompt = "\n\n构图要求：严格使用 " + activeRatio + " 画面比例（" +
      activeSize + " 像素画布）进行原生构图；不要生成正方形或在生成后裁切；主体、文字和边缘内容必须完整适配画布。";
    const payload: Record<string, unknown> = {
      requestId: id,
      prompt: activePrompt + ratioPrompt,
      userPrompt: activePrompt,
      model: "gpt-image-2",
      size: activeSize,
      n: activeMode === "edit" ? 1 : activeN,
      quality: activeQuality,
      ratio: activeRatio,
      resolution: activeResolution,
      projectId: activeProject,
      title: activePrompt.slice(0, 48),
      tags: activeTags,
      sourceId: override.sourceId,
      variationLabel: override.variationLabel,
    };
    if (activeMode === "edit" && sourceImage) {
      const prepared = await prepareUpload(sourceImage);
      const referenceBoard = await createReferenceBoard(prepared, references);
      payload.image = await fileToPayload(referenceBoard);
      if (suppliedMask) {
        const maskFile = suppliedMask.type === "image/png"
          ? suppliedMask
          : await prepareUpload(suppliedMask);
        payload.mask = await fileToPayload(maskFile);
      }
    }
    const result = await window.pinaic.queue.enqueue({ kind: activeMode, payload });
    if (!result.ok || !result.job) {
      setError(result.error || "无法创建任务");
      return;
    }
    setActiveJobId(result.job.id);
    setNotice("任务已加入队列，将按顺序生成");
    await refreshQueue();
  };

  const cancelActive = async () => {
    if (!activeJobId) return;
    const result = await window.pinaic.queue.cancel(activeJobId);
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
    void enqueue({
      prompt: output.prompt,
      size: output.size,
      ratio: output.ratio,
      resolution: output.resolution,
      quality: output.quality,
      n: 1,
      projectId: output.projectId,
      tags: output.tags,
      sourceId: output.galleryId,
      mode: "generate",
    });
  };

  const continueEdit = (output: Output) => {
    setMode("edit");
    setPrompt(output.prompt);
    setImage(b64ToFile(output.b64, "pinaic-source.png"));
    if (output.ratio) setRatio(output.ratio);
    if (output.resolution) setResolution(output.resolution);
    if (output.quality) setQuality(output.quality);
    setProjectId(output.projectId || "inbox");
    setTagsText(output.tags.join("，"));
    setNotice("已带入图片和参数，可局部涂抹蒙版后继续编辑");
  };

  const createVariation = (
    source: Pick<Output, "prompt" | "projectId" | "tags" | "galleryId"> | GalleryItem,
    option: (typeof variationOptions)[number] = variationOptions[0],
  ) => {
    const sourceId = "id" in source ? source.id : source.galleryId;
    void enqueue({
      prompt: source.prompt + "\n\n" + option.suffix,
      mode: "generate",
      n: 1,
      projectId: source.projectId,
      tags: source.tags,
      sourceId,
      variationLabel: option.label,
    });
  };

  const saveOutput = async (output: Output) => {
    const result = await window.pinaic.saveImage({
      dataUrl: dataUrlFor(output),
      suggestedName: "pinaic-" + new Date(output.createdAt).toISOString().replace(/[:.]/g, "-") + ".png",
    });
    if (!result.canceled) setNotice("已保存：" + (result.path || ""));
  };

  const exportSocial = async () => {
    if (!exportOutput) return;
    try {
      const dataUrl = await exportSocialCanvas(exportOutput, socialPreset, socialFill);
      const result = await window.pinaic.saveImage({
        dataUrl,
        suggestedName: "pinaic-social-" + socialPreset + ".png",
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
    if (!apiKey.trim() && !configured) {
      setError("请输入 API 密钥");
      return;
    }
    await window.pinaic.settings.save({ apiKey, baseUrl, autoArchive });
    setConfigured(true);
    setApiKey("");
    setNotice("设置已保存，密钥不会显示在界面中");
  };

  const testSettings = async () => {
    setTestMessage("测试中…");
    const result = await window.pinaic.settings.test();
    setTestMessage(result.message);
  };

  const galleryOpen = (
    item: GalleryItem,
    b64: string,
    action: "preview" | "reuse" | "edit",
  ) => {
    const output: Output = {
      id: item.id,
      b64,
      createdAt: Date.parse(item.createdAt),
      galleryId: item.id,
      prompt: item.prompt,
      model: item.model,
      mode: item.mode,
      size: item.size,
      quality: item.quality,
      ratio: item.ratio,
      resolution: item.resolution,
      projectId: item.projectId,
      tags: item.tags,
      sourceId: item.sourceId,
      variationLabel: item.variationLabel,
    };
    if (action === "preview") {
      setPreview(output);
    } else if (action === "edit") {
      continueEdit(output);
    } else {
      setMode("generate");
      setPrompt(item.prompt);
      setProjectId(item.projectId);
      setTagsText(item.tags.join("，"));
      if (item.ratio) setRatio(item.ratio);
      if (item.resolution) setResolution(item.resolution);
      if (item.quality) setQuality(item.quality);
      setNotice("已复用历史参数，可修改提示词后生成");
    }
  };

  const composer = (
    <section className="card composer">
      <div className="mode-title">
        <div>
          <span className="eyebrow">{mode === "edit" ? "IMAGE EDIT" : "CREATE STUDIO"}</span>
          <h2>{mode === "edit" ? "编辑与局部重绘" : "描述你想要的画面"}</h2>
        </div>
        <span className="pill">{mode === "edit" ? "原图 + 蒙版 + 参考图" : "提示词 + 变体 + 队列"}</span>
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
            {templates.map((item) => <option key={item.id} value={item.id}>[{item.category}] {item.title}</option>)}
          </select>
        </label>
        <button className="secondary" onClick={() => void saveTemplate()}>保存为模板</button>
        {selectedTemplate && !templates.find((item) => item.id === selectedTemplate)?.builtin && (
          <button className="secondary" onClick={() => void deleteTemplate()}>删除模板</button>
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

      <div className="prompt-assistant">
        <strong>提示词助手</strong>
        <button onClick={() => optimizeLocal("refine")}>精炼主体</button>
        <button onClick={() => optimizeLocal("detail")}>强化细节</button>
        <button onClick={() => optimizeLocal("poster")}>海报化</button>
        <button onClick={() => optimizeLocal("social")}>社媒化</button>
        <button onClick={() => optimizeLocal("realistic")}>更写实</button>
        <button onClick={() => optimizeLocal("premium")}>更高级</button>
        <button className="assistant-ai" onClick={() => void enhanceOnline()} disabled={enhancing}>
          {enhancing ? "AI 增强中…" : "AI 增强 · gpt-4o"}
        </button>
        {originalPrompt && <button onClick={() => setPrompt(originalPrompt)}>恢复原提示词</button>}
      </div>

      {mode === "edit" && (
        <>
          <div className="upload-row">
            <label className="upload">
              {image ? "原图：" + image.name : "上传原图"}
              <input type="file" accept="image/*" onChange={(event) => setImage(event.target.files?.[0] || null)} />
            </label>
            <label className="upload ghost">
              {externalMask ? "外部蒙版：" + externalMask.name : "可选外部蒙版"}
              <input type="file" accept="image/*" onChange={(event) => setExternalMask(event.target.files?.[0] || null)} />
            </label>
            <label className="upload ghost">
              添加参考图（{references.length}/3）
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => setReferences(Array.from(event.target.files || []).slice(0, 3))}
              />
            </label>
          </div>
          {references.length > 0 && (
            <div className="reference-list">
              {references.map((file, index) => (
                <span key={file.name + String(index)}>
                  参考图 {index + 1}：{file.name}
                  <button onClick={() => setReferences((current) => current.filter((_, value) => value !== index))}>×</button>
                </span>
              ))}
            </div>
          )}
          <MaskPainter image={image} onMaskChange={maskChange} />
        </>
      )}

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
          <select value={ratio} onChange={(event) => setRatio(event.target.value)} disabled={customSizeEnabled}>
            {ratioOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>数量
          <select value={n} onChange={(event) => setN(Number(event.target.value))}>
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} 张</option>)}
          </select>
        </label>
      </div>

      <div className="custom-size">
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
      </div>
      <p className="size-hint">
        当前输出：{chosenSize} · {ratio} 比例 · {resolution.toUpperCase()} 清晰度 · 项目：
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
        <button className="primary generate" onClick={() => void enqueue()} disabled={Boolean(activeJobId)}>
          {activeJobId ? "队列生成中…" : mode === "edit" ? "加入编辑队列" : "加入生成队列"}
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
                <strong>{output.variationLabel || "新生成图片"}</strong>
                <small>{output.size} · {output.projectId}</small>
              </div>
              <div className="result-actions">
                <button onClick={() => void saveOutput(output)}>保存 PNG</button>
                <button onClick={() => void window.pinaic.clipboard.copyImage(output.b64).then(() => setNotice("图片已复制到剪贴板"))}>复制图片</button>
                <button onClick={() => void window.pinaic.clipboard.copyText(output.prompt).then(() => setNotice("提示词已复制"))}>复制提示词</button>
                <button onClick={() => void window.pinaic.clipboard.copyText(formatGenerationParameters(output)).then(() => setNotice("完整参数已复制"))}>复制参数</button>
                <button onClick={() => regenerate(output)}>再生成</button>
                <button onClick={() => continueEdit(output)}>继续编辑</button>
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
                <strong>{job.kind === "edit" ? "图片编辑" : "文生图"} · {job.status}</strong>
                <small>{new Date(job.createdAt).toLocaleString()} · 尝试 {job.attempts} 次</small>
                <p>{String(job.input.userPrompt || job.input.prompt || "")}</p>
                {job.error && <em>{job.error}</em>}
              </div>
              <div className="queue-actions">
                {["failed", "interrupted", "cancelled"].includes(job.status) && (
                  <button onClick={() => void window.pinaic.queue.retry(job.id)}>重试</button>
                )}
                {["queued", "running"].includes(job.status) && (
                  <button onClick={() => void window.pinaic.queue.cancel(job.id)}>取消</button>
                )}
                {job.status !== "running" && (
                  <button onClick={() => void window.pinaic.queue.remove(job.id)}>移除</button>
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
        API 密钥仅通过 Windows 凭据库保存；AI 提示词增强固定使用 gpt-4o，并且只在你点击“AI 增强”时调用。
      </p>
      <label>PinAI API 地址<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label>API 密钥
        <input
          type="password"
          placeholder={configured ? "已保存，输入新值可覆盖" : "粘贴你的 PinAI API 密钥"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <label className="archive-toggle">
        <input type="checkbox" checked={autoArchive} onChange={(event) => setAutoArchive(event.target.checked)} />
        自动归档生成图片到本地图库与收件箱
      </label>
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
          <span className="eyebrow">PINAI IMAGE STUDIO · V1.1</span>
          <img className="brand-title" src={imaginationTitle} alt="把想象变成图片" />
          <p>本地创作工作台 · 提示词助手 · 项目图库 · 局部重绘 · 批量交付</p>
        </div>
        <div className="header-stack">
          <div className="status"><i className={configured ? "ok" : "off"}></i>{configured ? "已配置" : "未配置密钥"}</div>
          <button className="queue-chip" onClick={() => setMode("queue")}>任务队列 <strong>{runningCount}</strong></button>
        </div>
      </header>
      <div className="layout">
        <aside>
          <button className={mode === "generate" ? "nav active" : "nav"} onClick={() => setMode("generate")}>✦ 创作生成</button>
          <button className={mode === "edit" ? "nav active" : "nav"} onClick={() => setMode("edit")}>◌ 图片编辑</button>
          <button className={mode === "gallery" ? "nav active" : "nav"} onClick={() => setMode("gallery")}>▧ 项目图库</button>
          <button className={mode === "queue" ? "nav active" : "nav"} onClick={() => setMode("queue")}>⇢ 任务队列</button>
          <button className={mode === "settings" ? "nav active" : "nav"} onClick={() => setMode("settings")}>⚙ 设置</button>
          <div className="aside-tip">
            <span>当前模型</span><strong>gpt-image-2</strong>
            <p>提示词增强：gpt-4o<br />图片、项目与队列均保存在本机。</p>
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
        <div className="lightbox" onClick={() => setPreview(null)}>
          <button className="lightbox-close" onClick={() => setPreview(null)} aria-label="关闭预览">×</button>
          <img src={dataUrlFor(preview)} onClick={(event) => event.stopPropagation()} alt="大图预览" />
          <span>点击空白处或右上角关闭</span>
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
