import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRecipe } from "../lib/creative";
import { INBOX_PROJECT_ID } from "../lib/constants";
import { formatBytes, formatDurationSeconds } from "../lib/format";
import { t, tCode } from "../lib/i18n";
import { validateUpscaleOutput } from "../lib/local-ai";
import { b64FromDataUrl, b64ToDataUrl, fileToDataUrl } from "../lib/media";
import { mapLocalAIProgress } from "../lib/progress";
import { useDialog } from "./Dialogs";
import { callIpc } from "./ipc";
import { ProgressBar } from "./ProgressBar";
import { useCopyImage } from "./useCopy";
import { useSaveImage } from "./useSaveImage";
import { ImageDropInput } from "./ImageDropInput";
import { Tooltip, InfoHint } from "./Tooltip";
import { NavIcon } from "./icons";
import type { StudioNotify } from "./StudioContext";

export type LocalAISource = {
  dataUrl: string;
  title: string;
  recipe: ImageRecipeV1;
  sourceId?: string;
};
export type LocalAIAction = "upscale" | "remove-background" | "face-restore" | "pipeline";

// 背景预览可选值（顺序 = 按钮渲染顺序）；label 经 t() 在渲染期求值。
const BACKGROUND_VALUES = ["checker", "white", "gray", "custom"] as const;

type WorkerResult = {
  type: "result";
  id: string;
  width: number;
  height: number;
  data: ArrayBuffer;
  steps: Array<{ tool: LocalAITool; modelId: string; device: "webgpu" | "wasm"; elapsedMs: number; parameters: Record<string, string | number | boolean> }>;
  elapsedMs: number;
};
type WorkerProgress = { type: "progress"; id: string; phase: string; progress?: number; message: string; device?: "webgpu" | "wasm"; stageIndex?: number; totalStages?: number; stageLabel?: string };
type WorkerError = { type: "error"; id: string; cancelled?: boolean; error: string };

// 模型条目 = 状态 + 最近一次下载进度事件携带的 message/code/params（T26：进度码经 tCode 本地化）。
type LocalAIModelEntry = LocalAIModelStatus & {
  message?: string;
  code?: LocalAIModelProgressCode;
  params?: Record<string, string | number>;
};

// 动作标签 getter：每次访问经 t() 运行时求值（语言切换后随重渲染更新，禁止模块加载期冻结）。
const actionLabels: Record<LocalAIAction, string> = {
  get upscale() { return t("高清放大"); },
  get "remove-background"() { return t("智能抠图"); },
  get "face-restore"() { return t("人脸优化 Beta"); },
  get pipeline() { return t("本地组合处理"); },
};

// 动作引导 getter：同上，消费点（actionGuides[action].title 等）零改动即逐次求值。
const actionGuides: Record<LocalAIAction, { title: string; summary: string; output: string; badge: string }> = {
  upscale: {
    get title() { return t("高清放大"); },
    get summary() { return t("补足纹理与边缘细节，适合放大生成图、插画和产品图。"); },
    get output() { return t("输出 2× 或 4× PNG，透明区域保持不变"); },
    get badge() { return t("正式功能"); },
  },
  "remove-background": {
    get title() { return t("智能抠图"); },
    get summary() { return t("识别主体并移除背景，适合人物、商品和视觉素材。"); },
    get output() { return t("输出透明 PNG，可预览边缘与不同底色"); },
    get badge() { return t("正式功能"); },
  },
  "face-restore": {
    get title() { return t("人脸优化"); },
    get summary() { return t("检测并修复模糊或轻微畸变的人脸，原脸按强度混合以降低身份漂移。"); },
    get output() { return t("最多处理 10 张人脸，侧脸和遮挡可能无法识别"); },
    get badge() { return "Beta"; },
  },
  pipeline: {
    get title() { return t("一键优化"); },
    get summary() { return t("依次执行人脸优化、2× 高清放大和智能抠图。"); },
    get output() { return t("只归档最终成品，任一步失败都不会覆盖原图"); },
    get badge() { return t("组合流程"); },
  },
};

function dataUrlToPixels(dataUrl: string) {
  return new Promise<{ width: number; height: number; data: ArrayBuffer }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { reject(new Error(t("无法读取图片像素"))); return; }
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ width: canvas.width, height: canvas.height, data: imageData.data.buffer });
    };
    image.onerror = () => reject(new Error(t("无法打开待处理图片")));
    image.src = dataUrl;
  });
}

function pixelsToDataUrl(width: number, height: number, buffer: ArrayBuffer) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("无法创建结果画布"));
  context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

function recipeForImportedSource(width: number, height: number): ImageRecipeV1 {
  return createRecipe({
    prompt: "本地导入图片",
    model: "local-import",
    size: `${width}x${height}`,
    mode: "edit",
    tags: ["本地导入"],
  });
}

export function LocalAIToolbox({
  source,
  initialAction,
  projectId,
  onSourceChange,
  onArchived,
  onNotice,
}: {
  source: LocalAISource | null;
  initialAction: LocalAIAction;
  projectId?: string;
  onSourceChange: (source: LocalAISource | null) => void;
  onArchived: (input: { b64: string; recipe: ImageRecipeV1; galleryId?: string }) => void;
  onNotice: StudioNotify;
}) {
  const [action, setAction] = useState<LocalAIAction>(initialAction);
  const [models, setModels] = useState<LocalAIModelEntry[]>([]);
  const [capabilities, setCapabilities] = useState<LocalAICapabilities | null>(null);
  const [scale, setScale] = useState<2 | 4>(2);
  const [feather, setFeather] = useState(2);
  const [edgeRefine, setEdgeRefine] = useState(true);
  const [strength, setStrength] = useState(70);
  const [allFaces, setAllFaces] = useState(false);
  const [background, setBackground] = useState<"checker" | "white" | "gray" | "custom">("checker");
  const [backgroundColor, setBackgroundColor] = useState("#dbe7f2");
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState("");
  const [progress, setProgress] = useState<{ value: number | undefined; message: string; device: string; stageIndex: number; totalStages: number }>({ value: 0, message: t("等待开始"), device: "", stageIndex: 0, totalStages: 1 });
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [result, setResult] = useState<{ dataUrl: string; width: number; height: number; recipe: ImageRecipeV1 } | null>(null);
  const [compare, setCompare] = useState(50);
  const [zoom, setZoom] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const taskIdRef = useRef("");
  const { requestConfirm } = useDialog();
  const copyImage = useCopyImage(onNotice);
  const saveImage = useSaveImage(onNotice);

  const refreshModels = useCallback(async () => {
    const response = await callIpc(() => window.imageStudio.localAI.models(), { fallbackError: t("无法读取本地模型状态"), onError: (message) => onNotice(message, true) });
    setModels(response.items || []);
  }, []);

  useEffect(() => {
    setAction(initialAction);
  }, [initialAction, source]);

  useEffect(() => {
    void refreshModels();
    void callIpc(() => window.imageStudio.localAI.capabilities(), { fallbackError: t("无法读取本地 AI 能力"), onError: (message) => onNotice(message, true) }).then(setCapabilities).catch(() => { /* callIpc 已上报 */ });
    // 事件订阅白名单：直连。
    const unsubscribe = window.imageStudio.onLocalAIModelProgress((value) => {
      setModels((current) => current.some((item) => item.id === value.id)
        ? current.map((item) => item.id === value.id ? value : item)
        : [...current, value]);
    });
    return unsubscribe;
  }, [refreshModels]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const requiredModels = useMemo<LocalAIModelId[]>(() => {
    if (action === "upscale") return [scale === 2 ? "realesrgan-x2" : "realesrgan-x4"];
    if (action === "remove-background") return ["isnet-general"];
    if (action === "face-restore") return ["yunet", "gfpgan-v1.4"];
    return ["yunet", "gfpgan-v1.4", "realesrgan-x2", "isnet-general"];
  }, [action, scale]);

  const importFile = async (file: File) => {
    if (!file.type.startsWith("image/")) { onNotice(t("请选择 PNG、JPEG 或 WebP 图片"), true); return; }
    const dataUrl = await fileToDataUrl(file);
    const decoded = await dataUrlToPixels(dataUrl);
    onSourceChange({ dataUrl, title: file.name.replace(/\.[^.]+$/, "") || t("本地图片|源"), recipe: { ...recipeForImportedSource(decoded.width, decoded.height), projectId: projectId || INBOX_PROJECT_ID } });
    setResult(null);
  };

  const pasteImage = async () => {
    const response = await callIpc(() => window.imageStudio.clipboard.readImage(), { fallbackError: t("剪贴板中没有图片"), onError: (message) => onNotice(message, true) });
    if (!response.b64) return;
    const dataUrl = b64ToDataUrl(response.b64);
    const decoded = await dataUrlToPixels(dataUrl);
    onSourceChange({ dataUrl, title: t("剪贴板图片|源"), recipe: { ...recipeForImportedSource(decoded.width, decoded.height), projectId: projectId || INBOX_PROJECT_ID } });
    setResult(null);
  };

  const ensureModels = async () => {
    for (const id of requiredModels) {
      const status = models.find((item) => item.id === id);
      if (status?.installed) continue;
      setDownloadBusy(id);
      onNotice(t("首次使用需要下载 {name}，完成后可离线使用", { name: status?.name || id }));
      await callIpc(() => window.imageStudio.localAI.downloadModel(id), { fallbackError: t("{id} 下载失败", { id }) });
      await refreshModels();
    }
    setDownloadBusy("");
  };

  const run = async () => {
    if (!source || busy) return;
    setBusy(true); setResult(null); setRunStartedAt(Date.now()); setProgress({ value: 1, message: t("正在检查本地模型"), device: "", stageIndex: 0, totalStages: 1 });
    try {
      const sourcePixels = await dataUrlToPixels(source.dataUrl);
      if (action === "upscale") {
        const check = validateUpscaleOutput(sourcePixels.width, sourcePixels.height, scale);
        if (!check.ok) throw new Error(check.error);
      }
      await ensureModels();
      const urls: Partial<Record<LocalAIModelId, string>> = {};
      for (const id of requiredModels) {
        const response = await callIpc(() => window.imageStudio.localAI.modelUrl(id), { fallbackError: t("{id} 未安装", { id }) });
        if (!response.url) throw new Error(t("{id} 未安装", { id }));
        urls[id] = response.url;
      }
      const taskId = crypto.randomUUID(); taskIdRef.current = taskId;
      const worker = new Worker(new URL("../workers/local-ai.worker.ts", import.meta.url), { type: "module" });
      workerRef.current?.terminate(); workerRef.current = worker;
      worker.onmessage = async (event: MessageEvent<WorkerProgress | WorkerResult | WorkerError>) => {
        const value = event.data;
        if (value.id !== taskId) return;
        if (value.type === "progress") {
          setProgress({ value: value.progress, message: value.message, device: value.device || "", stageIndex: value.stageIndex ?? 0, totalStages: value.totalStages ?? 1 });
          return;
        }
        if (value.type === "error") {
          setBusy(false); setDownloadBusy("");
          onNotice(value.cancelled ? t("本地处理已取消，原图未改变") : value.error, !value.cancelled);
          worker.terminate(); return;
        }
        const dataUrl = pixelsToDataUrl(value.width, value.height, value.data);
        const modelVersions = new Map(models.map((item) => [item.id, item.version]));
        const postProcessing: PostProcessingStep[] = value.steps.map((step) => ({
          ...step,
          modelVersion: modelVersions.get(step.modelId as LocalAIModelId) || "unknown",
          createdAt: new Date().toISOString(),
        }));
        const recipe: ImageRecipeV1 = {
          ...source.recipe,
          size: `${value.width}x${value.height}`,
          sourceId: source.sourceId || source.recipe.sourceId,
          variationLabel: actionLabels[action],
          createdAt: new Date().toISOString(),
          postProcessing: [...(source.recipe.postProcessing || []), ...postProcessing],
        };
        const archive = await callIpc(() => window.imageStudio.localAI.archiveResult({ dataUrl, title: `${source.title} - ${actionLabels[action]}`, recipe }), { fallbackError: t("未知错误"), onError: (message) => onNotice(t("处理完成，但归档失败：{message}", { message }), true) });
        setResult({ dataUrl, width: value.width, height: value.height, recipe });
        setBusy(false); setProgress({ value: 100, message: t("处理完成，用时 {elapsed}", { elapsed: formatDurationSeconds(value.elapsedMs) }), device: value.steps.at(-1)?.device || "", stageIndex: 0, totalStages: 1 });
        onArchived({ b64: b64FromDataUrl(dataUrl), recipe, galleryId: archive.item?.id });
        if (archive.ok) onNotice(t("本地处理完成，成品已作为新图片归档"), false);
        worker.terminate();
      };
      worker.onerror = (event) => { setBusy(false); onNotice(event.message || t("本地推理 Worker 异常"), true); worker.terminate(); };
      const workerType = action === "remove-background" ? "removeBackground" : action === "face-restore" ? "restoreFace" : action;
      worker.postMessage({ id: taskId, type: workerType, source: sourcePixels, modelUrls: urls, scale, feather, edgeRefine, strength: strength / 100, allFaces }, [sourcePixels.data]);
    } catch (error) {
      setBusy(false); setDownloadBusy(""); onNotice((error as Error).message || t("本地处理失败"), true);
    }
  };

  const cancel = () => {
    if (!workerRef.current || !taskIdRef.current) return;
    workerRef.current.postMessage({ id: taskIdRef.current, type: "cancel" });
  };

  // 统一进度条数据：把「下载模型」与「推理进度」合并到同一条时间线，
  // 避免准备阶段进度条长时间卡在 1%。真实百分比不可知时缺省 progress（渲染层显示不确定态）。
  const downloading = busy && downloadBusy ? models.find((item) => item.id === downloadBusy) : undefined;
  // 下载/校验进度文案：有 code 时经 tCode 本地化（en 查 localai.* 词典、zh 用 manager 中文 message 回退），
  // 无 code（尚未收到首个进度事件）回退按模型名的中文/英文模板。
  const downloadMessage = downloading
    ? downloading.code
      ? tCode("localai", downloading.code, downloading.params, downloading.message || t("正在下载 {name}", { name: downloading.name }))
      : t("正在下载 {name}", { name: downloading.name })
    : "";
  const liveProgress: TaskProgressEvent | null = downloading
    ? { id: "local-ai", scope: "local-ai", message: downloadMessage, progress: downloading.progress, state: "running" }
    : busy
      ? {
          id: "local-ai",
          scope: "local-ai",
          message: progress.message,
          progress: progress.value === undefined ? undefined : mapLocalAIProgress(progress.value, progress.stageIndex, progress.totalStages),
          stageIndex: progress.stageIndex,
          totalStages: progress.totalStages,
          startedAt: runStartedAt || undefined,
          detail: progress.device || undefined,
          state: "running",
        }
      : progress.value !== undefined && progress.value >= 100
        ? { id: "local-ai", scope: "local-ai", message: progress.message, progress: 100, state: "done" }
        : null;

  const pauseDownload = async (id: LocalAIModelId) => {
    await callIpc(() => window.imageStudio.localAI.pauseDownload(id), { fallbackError: t("暂停下载失败"), onError: (message) => onNotice(message, true) });
  };

  const downloadModel = async (id: LocalAIModelId) => {
    await callIpc(() => window.imageStudio.localAI.downloadModel(id), { fallbackError: t("下载失败|模型"), onError: (message) => onNotice(message, true) });
    await refreshModels();
  };

  const deleteModel = async (id: LocalAIModelId) => {
    if (!(await requestConfirm({ title: t("删除本地模型"), message: t("删除后再次使用该功能需要重新下载模型，确定继续吗？"), confirmLabel: t("删除|模型"), danger: true }))) return;
    await callIpc(() => window.imageStudio.localAI.deleteModel(id), { fallbackError: t("模型删除失败"), onError: (message) => onNotice(message, true) });
    await refreshModels();
  };

  const chooseModelDir = async () => {
    const response = await callIpc(() => window.imageStudio.localAI.chooseModelDir(), { fallbackError: t("无法更换模型位置"), onError: (message) => onNotice(message, true) });
    if (!response.ok) return;
    if (response.canceled) return;
    setCapabilities((current) => current && response.modelsDir ? { ...current, modelsDir: response.modelsDir } : current);
    if (response.items) setModels(response.items);
    onNotice(t("模型保存位置已更换；已有模型和未完成下载已复制到新目录"));
  };

  const resetModelDir = async () => {
    const response = await callIpc(() => window.imageStudio.localAI.resetModelDir(), { fallbackError: t("无法恢复默认模型位置"), onError: (message) => onNotice(message, true) });
    if (!response.ok) return;
    setCapabilities((current) => current && response.modelsDir ? { ...current, modelsDir: response.modelsDir } : current);
    if (response.items) setModels(response.items);
    onNotice(t("已恢复系统默认模型位置"));
  };

  const openModelDir = async () => {
    await callIpc(() => window.imageStudio.localAI.openModelDir(), { fallbackError: t("无法打开模型目录"), onError: (message) => onNotice(message, true) });
  };

  const saveResult = async () => {
    if (!result) return;
    await saveImage({
      dataUrl: result.dataUrl,
      suggestedName: `${source?.title || t("本地处理结果")}-${actionLabels[action]}.png`,
      recipe: result.recipe,
    }, { onSaved: (path) => onNotice(t("PNG 已保存：{path}", { path: path || t("已完成|保存") })) });
  };

  const copyResult = async () => {
    if (!result) return;
    await copyImage(b64FromDataUrl(result.dataUrl), t("处理结果已复制到剪贴板"), t("复制图片失败|剪贴板"));
  };

  const previewStyle = background === "white" ? { background: "#fff" } : background === "gray" ? { background: "#d8dde6" } : background === "custom" ? { background: backgroundColor } : undefined;
  const webgpuAvailable = Boolean(capabilities?.webgpu && "gpu" in navigator);
  const backgroundLabels: Record<(typeof BACKGROUND_VALUES)[number], string> = { checker: t("棋盘格|背景"), white: t("白色|背景"), gray: t("浅灰|背景"), custom: t("自定义|背景") };

  return <section className="local-ai-workbench" data-tutorial="local-ai-toolbox">
    <div className="local-ai-heading">
      <div><span className="eyebrow">LOCAL AI TOOLBOX</span><h2>{t("本地 AI 后期工具箱")}</h2><p>{t("图片只在本机处理（可离线运行），不读取 API 密钥，也不会上传到任何服务。")}</p></div>
      <span className={webgpuAvailable ? "device-chip webgpu" : "device-chip"}>{webgpuAvailable ? t("WebGPU 优先") : "WASM / CPU"}</span>
    </div>

    <div className="local-ai-guide" aria-label={t("本地工具箱能力说明")}>
      {(Object.keys(actionGuides) as LocalAIAction[]).map((value) => {
        const guide = actionGuides[value];
        return <Tooltip key={value} content={guide.output}>
          <button className={action === value ? "active" : ""} onClick={() => setAction(value)}>
            <span>{guide.badge}</span>
            <strong>{guide.title}</strong>
            <p>{guide.summary}</p>
          </button>
        </Tooltip>;
      })}
    </div>

    <div className="local-ai-grid">
      <section className="local-ai-source card">
        <div className="section-head"><div><span className="eyebrow">SOURCE</span><h3>{t("待处理图片")}</h3></div>{source && <button className="secondary" onClick={() => { onSourceChange(null); setResult(null); }}>{t("清除")}</button>}</div>
        <ImageDropInput accept="image/png,image/jpeg,image/webp" onFiles={(files) => void importFile(files[0])}>
          {({ open, dropProps }) => <>
            {source ? <div className="local-source-preview"><img src={source.dataUrl} alt={source.title} /><strong>{source.title}</strong><small>{t("{size} · 原图始终保留", { size: source.recipe.size })}</small></div> : <button className="local-drop-zone" onClick={open} {...dropProps}><strong>{t("导入一张图片")}</strong><span>{t("点击选择、拖放或从剪贴板粘贴")}</span></button>}
            <div className="local-source-actions"><button onClick={open}>{t("导入文件")}</button><button onClick={() => void pasteImage()}>{t("粘贴图片")}</button></div>
          </>}
        </ImageDropInput>

        <div className="tool-segments" role="tablist">
          {(Object.keys(actionLabels) as LocalAIAction[]).map((value) => <button key={value} className={action === value ? "active" : ""} onClick={() => setAction(value)}>{actionLabels[value]}</button>)}
        </div>
        <div className="active-tool-guide">
          <strong>{t("{tool}适合什么？", { tool: actionGuides[action].title })}</strong>
          <span>{actionGuides[action].summary}</span>
          <small>{actionGuides[action].output}</small>
        </div>

        {action === "upscale" && <Tooltip content={t("自动分块并保留透明通道；输出最长边不超过 8192 px。")}><div className="local-options"><label>{t("放大倍率")}<select value={scale} onChange={(event) => setScale(Number(event.target.value) as 2 | 4)}><option value={2}>{t("2× 原生模型")}</option><option value={4}>{t("4× 原生模型")}</option></select></label></div></Tooltip>}
        {action === "remove-background" && <div className="local-options"><label className="range-label">{t("边缘羽化")} <strong>{feather}px</strong><input type="range" min="0" max="8" value={feather} onChange={(event) => setFeather(Number(event.target.value))} /></label><label className="check"><input type="checkbox" checked={edgeRefine} onChange={(event) => setEdgeRefine(event.target.checked)} />{t("轻度边缘优化")}</label></div>}
        {(action === "face-restore" || action === "pipeline") && <Tooltip content={t("Beta：侧脸、遮挡和过小人脸可能无法处理；默认混合原脸以降低身份漂移。")}><div className="local-options"><label className="range-label">{t("修复强度")} <strong>{strength}%</strong><input type="range" min="10" max="100" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /></label><label className="check"><input type="checkbox" checked={allFaces} onChange={(event) => setAllFaces(event.target.checked)} />{t("处理全部人脸（最多 10 张）")}</label></div></Tooltip>}

        <div className="local-run-row"><Tooltip content={t("处理顺序：人脸优化 → 2× 超分 → 智能抠图。任一步失败即停止，不保存中间结果。")}><button className="primary" disabled={!source || busy} onClick={() => void run()}>{busy ? t("正在本地处理…") : actionLabels[action]}</button></Tooltip>{busy && <button className="secondary" onClick={cancel}>{t("取消")}</button>}</div>
        {busy && progress.totalStages > 1 ? (
          <div className="stage-indicator">
            {[t("人脸优化"), t("高清放大"), t("智能抠图")].map((label, index) => (
              <span key={label} className={index < progress.stageIndex ? "done" : index === progress.stageIndex ? "active" : ""}>{label}</span>
            ))}
          </div>
        ) : null}
        {liveProgress ? <ProgressBar event={liveProgress} /> : null}
      </section>

      <section className="local-ai-result card">
        <div className="section-head"><div><span className="eyebrow">COMPARE</span><h3>{t("原图 / 处理图")}</h3></div>{result && <button className="secondary" onClick={() => setZoom((value) => !value)}>{zoom ? t("适应窗口") : t("100% 细节")}</button>}</div>
        {source && result ? <div className="local-compare-scroll">
          <div
            className={`local-compare ${zoom ? "zoom" : ""}`}
            style={{ ...previewStyle, ...(zoom ? { width: result.width, height: result.height } : {}) }}
          >
            <img src={source.dataUrl} alt={t("原图|对比")} />
            <img className="compare-after" style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }} src={result.dataUrl} alt={t("处理图|对比")} />
            <i style={{ left: `${compare}%` }} /><input aria-label={t("对比位置")} type="range" min="0" max="100" value={compare} onChange={(event) => setCompare(Number(event.target.value))} />
          </div>
        </div> : <div className="local-result-empty"><span><NavIcon name="image" size={40} /></span><strong>{t("处理结果会显示在这里")}</strong><p>{t("完成后自动生成新的图库记录，绝不覆盖原图。")}</p></div>}
        {result && <><div className="result-dimensions"><strong>{result.width} × {result.height}</strong><span>{result.recipe.postProcessing?.at(-1)?.device.toUpperCase()}</span></div><div className="local-result-actions"><button className="primary" onClick={() => void saveResult()}>{t("保存 PNG")}</button><button className="secondary" onClick={() => void copyResult()}>{t("复制图片")}</button></div>{action === "remove-background" || action === "pipeline" ? <div className="background-controls"><span>{t("背景预览")}</span>{BACKGROUND_VALUES.map((value) => <button className={background === value ? "active" : ""} key={value} onClick={() => setBackground(value)}>{backgroundLabels[value]}</button>)}{background === "custom" && <input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} />}</div> : null}</>}
      </section>
    </div>

    <section className="model-manager card">
      <div className="section-head"><div><span className="eyebrow">MODEL MANAGER</span><h3>{t("本地模型管理")}<InfoHint content={t("模型目录与软件安装位置、图库位置相互独立。更换目录时会复制已安装模型和未完成下载；原目录会保留。")} /></h3><small>{capabilities?.modelsDir}</small></div><div className="model-directory-actions"><button className="secondary" onClick={() => void chooseModelDir()}>{t("更换位置|模型")}</button><button className="secondary" onClick={() => void openModelDir()}>{t("打开目录|模型")}</button><button className="secondary" onClick={() => void resetModelDir()}>{t("恢复默认")}</button><button className="secondary" onClick={() => void refreshModels()}>{t("刷新状态|模型")}</button></div></div>
      <div className="model-list">{models.map((model) => <article key={model.id}><div><strong>{model.name}{model.beta ? " · Beta" : ""}</strong><span>{model.version} · {formatBytes(model.size)} · {model.license}</span><a href={model.sourceUrl} target="_blank" rel="noreferrer">{t("来源与许可证")}</a></div><div className="model-state"><span>{model.installed ? t("已安装|模型") : model.state === "partial" ? t("已下载 {n}%", { n: model.progress }) : model.state === "downloading" ? t("下载中 {n}%", { n: model.progress }) : model.state === "verifying" ? t("校验中|模型") : t("未安装|模型")}</span>{model.state === "downloading" ? <button onClick={() => void pauseDownload(model.id)}>{t("暂停|模型")}</button> : !model.installed ? <button disabled={Boolean(downloadBusy)} onClick={() => void downloadModel(model.id)}>{model.state === "partial" ? t("继续|模型") : t("下载|模型")}</button> : <button onClick={() => void deleteModel(model.id)}>{t("删除|模型")}</button>}</div></article>)}</div>
    </section>
  </section>;
}
