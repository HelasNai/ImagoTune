import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateUpscaleOutput } from "../lib/local-ai";

export type LocalAISource = {
  dataUrl: string;
  title: string;
  recipe: ImageRecipeV1;
  sourceId?: string;
};
export type LocalAIAction = "upscale" | "remove-background" | "face-restore" | "pipeline";

type WorkerResult = {
  type: "result";
  id: string;
  width: number;
  height: number;
  data: ArrayBuffer;
  steps: Array<{ tool: LocalAITool; modelId: string; device: "webgpu" | "wasm"; elapsedMs: number; parameters: Record<string, string | number | boolean> }>;
  elapsedMs: number;
};
type WorkerProgress = { type: "progress"; id: string; phase: string; progress: number; message: string; device?: "webgpu" | "wasm" };
type WorkerError = { type: "error"; id: string; cancelled?: boolean; error: string };

const actionLabels: Record<LocalAIAction, string> = {
  upscale: "高清放大",
  "remove-background": "智能抠图",
  "face-restore": "人脸优化 Beta",
  pipeline: "本地组合处理",
};

const actionGuides: Record<LocalAIAction, { title: string; summary: string; output: string; badge: string }> = {
  upscale: {
    title: "高清放大",
    summary: "补足纹理与边缘细节，适合放大生成图、插画和产品图。",
    output: "输出 2× 或 4× PNG，透明区域保持不变",
    badge: "正式功能",
  },
  "remove-background": {
    title: "智能抠图",
    summary: "识别主体并移除背景，适合人物、商品和视觉素材。",
    output: "输出透明 PNG，可预览边缘与不同底色",
    badge: "正式功能",
  },
  "face-restore": {
    title: "人脸优化",
    summary: "检测并修复模糊或轻微畸变的人脸，原脸按强度混合以降低身份漂移。",
    output: "最多处理 10 张人脸，侧脸和遮挡可能无法识别",
    badge: "Beta",
  },
  pipeline: {
    title: "一键优化",
    summary: "依次执行人脸优化、2× 高清放大和智能抠图。",
    output: "只归档最终成品，任一步失败都不会覆盖原图",
    badge: "组合流程",
  },
};

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function dataUrlToPixels(dataUrl: string) {
  return new Promise<{ width: number; height: number; data: ArrayBuffer }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { reject(new Error("无法读取图片像素")); return; }
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ width: canvas.width, height: canvas.height, data: imageData.data.buffer });
    };
    image.onerror = () => reject(new Error("无法打开待处理图片"));
    image.src = dataUrl;
  });
}

function pixelsToDataUrl(width: number, height: number, buffer: ArrayBuffer) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建结果画布");
  context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

function recipeForImportedSource(width: number, height: number): ImageRecipeV1 {
  return {
    version: 1,
    prompt: "本地导入图片",
    negativePrompt: "",
    model: "local-import",
    size: `${width}x${height}`,
    n: 1,
    mode: "edit",
    projectId: "inbox",
    tags: ["本地导入"],
    createdAt: new Date().toISOString(),
  };
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
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [action, setAction] = useState<LocalAIAction>(initialAction);
  const [models, setModels] = useState<LocalAIModelStatus[]>([]);
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
  const [progress, setProgress] = useState({ value: 0, message: "等待开始", device: "" });
  const [result, setResult] = useState<{ dataUrl: string; width: number; height: number; recipe: ImageRecipeV1 } | null>(null);
  const [compare, setCompare] = useState(50);
  const [zoom, setZoom] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const taskIdRef = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshModels = useCallback(async () => {
    const response = await window.imageStudio.localAI.models();
    setModels(response.items || []);
  }, []);

  useEffect(() => {
    setAction(initialAction);
  }, [initialAction, source]);

  useEffect(() => {
    void refreshModels();
    void window.imageStudio.localAI.capabilities().then(setCapabilities);
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
    if (!file.type.startsWith("image/")) { onNotice("请选择 PNG、JPEG 或 WebP 图片", true); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
    });
    const decoded = await dataUrlToPixels(dataUrl);
    onSourceChange({ dataUrl, title: file.name.replace(/\.[^.]+$/, "") || "本地图片", recipe: { ...recipeForImportedSource(decoded.width, decoded.height), projectId: projectId || "inbox" } });
    setResult(null);
  };

  const pasteImage = async () => {
    const response = await window.imageStudio.clipboard.readImage();
    if (!response.b64) { onNotice(response.error || "剪贴板中没有图片", true); return; }
    const dataUrl = "data:image/png;base64," + response.b64;
    const decoded = await dataUrlToPixels(dataUrl);
    onSourceChange({ dataUrl, title: "剪贴板图片", recipe: { ...recipeForImportedSource(decoded.width, decoded.height), projectId: projectId || "inbox" } });
    setResult(null);
  };

  const ensureModels = async () => {
    for (const id of requiredModels) {
      const status = models.find((item) => item.id === id);
      if (status?.installed) continue;
      setDownloadBusy(id);
      onNotice(`首次使用需要下载 ${status?.name || id}，完成后可离线使用`);
      const response = await window.imageStudio.localAI.downloadModel(id);
      if (!response.ok) throw new Error(response.error || `${id} 下载失败`);
      await refreshModels();
    }
    setDownloadBusy("");
  };

  const run = async () => {
    if (!source || busy) return;
    setBusy(true); setResult(null); setProgress({ value: 1, message: "正在检查本地模型", device: "" });
    try {
      const sourcePixels = await dataUrlToPixels(source.dataUrl);
      if (action === "upscale") {
        const check = validateUpscaleOutput(sourcePixels.width, sourcePixels.height, scale);
        if (!check.ok) throw new Error(check.error);
      }
      await ensureModels();
      const urls: Partial<Record<LocalAIModelId, string>> = {};
      for (const id of requiredModels) {
        const response = await window.imageStudio.localAI.modelUrl(id);
        if (!response.url) throw new Error(response.error || `${id} 未安装`);
        urls[id] = response.url;
      }
      const taskId = crypto.randomUUID(); taskIdRef.current = taskId;
      const worker = new Worker(new URL("../workers/local-ai.worker.ts", import.meta.url), { type: "module" });
      workerRef.current?.terminate(); workerRef.current = worker;
      worker.onmessage = async (event: MessageEvent<WorkerProgress | WorkerResult | WorkerError>) => {
        const value = event.data;
        if (value.id !== taskId) return;
        if (value.type === "progress") {
          setProgress({ value: value.progress, message: value.message, device: value.device || "" });
          return;
        }
        if (value.type === "error") {
          setBusy(false); setDownloadBusy("");
          onNotice(value.cancelled ? "本地处理已取消，原图未改变" : value.error, !value.cancelled);
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
        const archive = await window.imageStudio.localAI.archiveResult({ dataUrl, title: `${source.title} - ${actionLabels[action]}`, recipe });
        setResult({ dataUrl, width: value.width, height: value.height, recipe });
        setBusy(false); setProgress({ value: 100, message: `处理完成，用时 ${(value.elapsedMs / 1000).toFixed(1)} 秒`, device: value.steps.at(-1)?.device || "" });
        onArchived({ b64: dataUrl.replace(/^data:image\/png;base64,/, ""), recipe, galleryId: archive.item?.id });
        onNotice(archive.ok ? "本地处理完成，成品已作为新图片归档" : `处理完成，但归档失败：${archive.error || "未知错误"}`, !archive.ok);
        worker.terminate();
      };
      worker.onerror = (event) => { setBusy(false); onNotice(event.message || "本地推理 Worker 异常", true); worker.terminate(); };
      const workerType = action === "remove-background" ? "removeBackground" : action === "face-restore" ? "restoreFace" : action;
      worker.postMessage({ id: taskId, type: workerType, source: sourcePixels, modelUrls: urls, scale, feather, edgeRefine, strength: strength / 100, allFaces }, [sourcePixels.data]);
    } catch (error) {
      setBusy(false); setDownloadBusy(""); onNotice((error as Error).message || "本地处理失败", true);
    }
  };

  const cancel = () => {
    if (!workerRef.current || !taskIdRef.current) return;
    workerRef.current.postMessage({ id: taskIdRef.current, type: "cancel" });
  };

  const deleteModel = async (id: LocalAIModelId) => {
    if (!window.confirm("删除后再次使用该功能需要重新下载模型，确定继续吗？")) return;
    const response = await window.imageStudio.localAI.deleteModel(id);
    if (!response.ok) onNotice(response.error || "模型删除失败", true);
    await refreshModels();
  };

  const chooseModelDir = async () => {
    const response = await window.imageStudio.localAI.chooseModelDir();
    if (!response.ok) { onNotice(response.error || "无法更换模型位置", true); return; }
    if (response.canceled) return;
    setCapabilities((current) => current && response.modelsDir ? { ...current, modelsDir: response.modelsDir } : current);
    if (response.items) setModels(response.items);
    onNotice("模型保存位置已更换；已有模型和未完成下载已复制到新目录");
  };

  const resetModelDir = async () => {
    const response = await window.imageStudio.localAI.resetModelDir();
    if (!response.ok) { onNotice(response.error || "无法恢复默认模型位置", true); return; }
    setCapabilities((current) => current && response.modelsDir ? { ...current, modelsDir: response.modelsDir } : current);
    if (response.items) setModels(response.items);
    onNotice("已恢复系统默认模型位置");
  };

  const openModelDir = async () => {
    const response = await window.imageStudio.localAI.openModelDir();
    if (!response.ok) onNotice(response.error || "无法打开模型目录", true);
  };

  const saveResult = async () => {
    if (!result) return;
    const response = await window.imageStudio.saveImage({
      dataUrl: result.dataUrl,
      suggestedName: `${source?.title || "本地处理结果"}-${actionLabels[action]}.png`,
      recipe: result.recipe,
    });
    if (!response.canceled) onNotice(`PNG 已保存：${response.path || "已完成"}`);
  };

  const copyResult = async () => {
    if (!result) return;
    const response = await window.imageStudio.clipboard.copyImage(result.dataUrl.replace(/^data:image\/png;base64,/, ""));
    onNotice(response.ok ? "处理结果已复制到剪贴板" : response.error || "复制图片失败", !response.ok);
  };

  const previewStyle = background === "white" ? { background: "#fff" } : background === "gray" ? { background: "#d8dde6" } : background === "custom" ? { background: backgroundColor } : undefined;
  const webgpuAvailable = Boolean(capabilities?.webgpu && "gpu" in navigator);

  return <section className="local-ai-workbench" data-tutorial="local-ai-toolbox">
    <div className="local-ai-heading">
      <div><span className="eyebrow">LOCAL AI TOOLBOX</span><h2>本地 AI 后期工具箱</h2><p>图片只在本机处理，不读取 API 密钥，也不会上传到任何服务。</p></div>
      <span className={webgpuAvailable ? "device-chip webgpu" : "device-chip"}>{webgpuAvailable ? "WebGPU 优先" : "WASM / CPU"}</span>
    </div>

    <div className="local-ai-guide" aria-label="本地工具箱能力说明">
      {(Object.keys(actionGuides) as LocalAIAction[]).map((value) => {
        const guide = actionGuides[value];
        return <button key={value} className={action === value ? "active" : ""} onClick={() => setAction(value)}>
          <span>{guide.badge}</span>
          <strong>{guide.title}</strong>
          <p>{guide.summary}</p>
          <small>{guide.output}</small>
        </button>;
      })}
    </div>
    <p className="local-privacy-note"><strong>完全本地：</strong>模型安装完成后可离线运行；处理图片不读取 API 密钥，也不会上传到图片服务。</p>

    <div className="local-ai-grid">
      <section className="local-ai-source card">
        <div className="section-head"><div><span className="eyebrow">SOURCE</span><h3>待处理图片</h3></div>{source && <button className="secondary" onClick={() => { onSourceChange(null); setResult(null); }}>清除</button>}</div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} />
        {source ? <div className="local-source-preview"><img src={source.dataUrl} alt={source.title} /><strong>{source.title}</strong><small>{source.recipe.size} · 原图始终保留</small></div> : <button className="local-drop-zone" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void importFile(file); }}><strong>导入一张图片</strong><span>点击选择、拖放或从剪贴板粘贴</span></button>}
        <div className="local-source-actions"><button onClick={() => fileRef.current?.click()}>导入文件</button><button onClick={() => void pasteImage()}>粘贴图片</button></div>

        <div className="tool-segments" role="tablist">
          {(Object.keys(actionLabels) as LocalAIAction[]).map((value) => <button key={value} className={action === value ? "active" : ""} onClick={() => setAction(value)}>{actionLabels[value]}</button>)}
        </div>
        <div className="active-tool-guide">
          <strong>{actionGuides[action].title}适合什么？</strong>
          <span>{actionGuides[action].summary}</span>
          <small>{actionGuides[action].output}</small>
        </div>

        {action === "upscale" && <div className="local-options"><label>放大倍率<select value={scale} onChange={(event) => setScale(Number(event.target.value) as 2 | 4)}><option value={2}>2× 原生模型</option><option value={4}>4× 原生模型</option></select></label><p>自动分块并保留透明通道；输出最长边不超过 8192 px。</p></div>}
        {action === "remove-background" && <div className="local-options"><label className="range-label">边缘羽化 <strong>{feather}px</strong><input type="range" min="0" max="8" value={feather} onChange={(event) => setFeather(Number(event.target.value))} /></label><label className="check"><input type="checkbox" checked={edgeRefine} onChange={(event) => setEdgeRefine(event.target.checked)} />轻度边缘优化</label></div>}
        {(action === "face-restore" || action === "pipeline") && <div className="local-options"><label className="range-label">修复强度 <strong>{strength}%</strong><input type="range" min="10" max="100" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /></label><label className="check"><input type="checkbox" checked={allFaces} onChange={(event) => setAllFaces(event.target.checked)} />处理全部人脸（最多 10 张）</label><p>Beta：侧脸、遮挡和过小人脸可能无法处理；默认混合原脸以降低身份漂移。</p></div>}
        {action === "pipeline" && <p className="pipeline-order">处理顺序：人脸优化 → 2× 超分 → 智能抠图。任一步失败即停止，不保存中间结果。</p>}

        <div className="local-run-row"><button className="primary" disabled={!source || busy} onClick={() => void run()}>{busy ? "正在本地处理…" : actionLabels[action]}</button>{busy && <button className="secondary" onClick={cancel}>取消</button>}</div>
        {(busy || progress.value > 0) && <div className="progress"><div className="progress-track"><div style={{ width: `${progress.value}%` }} /></div><span>{progress.message}{progress.device ? ` · ${progress.device.toUpperCase()}` : ""}</span></div>}
      </section>

      <section className="local-ai-result card">
        <div className="section-head"><div><span className="eyebrow">COMPARE</span><h3>原图 / 处理图</h3></div>{result && <button className="secondary" onClick={() => setZoom((value) => !value)}>{zoom ? "适应窗口" : "100% 细节"}</button>}</div>
        {source && result ? <div className="local-compare-scroll">
          <div
            className={`local-compare ${zoom ? "zoom" : ""}`}
            style={{ ...previewStyle, ...(zoom ? { width: result.width, height: result.height } : {}) }}
          >
            <img src={source.dataUrl} alt="原图" />
            <img className="compare-after" style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }} src={result.dataUrl} alt="处理图" />
            <i style={{ left: `${compare}%` }} /><input aria-label="对比位置" type="range" min="0" max="100" value={compare} onChange={(event) => setCompare(Number(event.target.value))} />
          </div>
        </div> : <div className="local-result-empty"><span>◇</span><strong>处理结果会显示在这里</strong><p>完成后自动生成新的图库记录，绝不覆盖原图。</p></div>}
        {result && <><div className="result-dimensions"><strong>{result.width} × {result.height}</strong><span>{result.recipe.postProcessing?.at(-1)?.device.toUpperCase()}</span></div><div className="local-result-actions"><button className="primary" onClick={() => void saveResult()}>保存 PNG</button><button className="secondary" onClick={() => void copyResult()}>复制图片</button></div>{action === "remove-background" || action === "pipeline" ? <div className="background-controls"><span>背景预览</span>{(["checker", "white", "gray", "custom"] as const).map((value) => <button className={background === value ? "active" : ""} key={value} onClick={() => setBackground(value)}>{({ checker: "棋盘格", white: "白色", gray: "浅灰", custom: "自定义" })[value]}</button>)}{background === "custom" && <input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} />}</div> : null}</>}
      </section>
    </div>

    <section className="model-manager card">
      <div className="section-head"><div><span className="eyebrow">MODEL MANAGER</span><h3>本地模型管理</h3><small>{capabilities?.modelsDir}</small></div><div className="model-directory-actions"><button className="secondary" onClick={() => void chooseModelDir()}>更换位置</button><button className="secondary" onClick={() => void openModelDir()}>打开目录</button><button className="secondary" onClick={() => void resetModelDir()}>恢复默认</button><button className="secondary" onClick={() => void refreshModels()}>刷新状态</button></div></div>
      <p className="model-directory-note">模型目录与软件安装位置、图库位置相互独立。更换目录时会复制已安装模型和未完成下载；原目录会保留，确认新目录可用后可自行清理。</p>
      <div className="model-list">{models.map((model) => <article key={model.id}><div><strong>{model.name}{model.beta ? " · Beta" : ""}</strong><span>{model.version} · {formatBytes(model.size)} · {model.license}</span><a href={model.sourceUrl} target="_blank" rel="noreferrer">来源与许可证</a></div><div className="model-state"><span>{model.installed ? "已安装" : model.state === "partial" ? `已下载 ${model.progress}%` : model.state === "downloading" ? `下载中 ${model.progress}%` : model.state === "verifying" ? "校验中" : "未安装"}</span>{model.state === "downloading" ? <button onClick={() => void window.imageStudio.localAI.pauseDownload(model.id)}>暂停</button> : !model.installed ? <button disabled={Boolean(downloadBusy)} onClick={() => void window.imageStudio.localAI.downloadModel(model.id).then(refreshModels)}>{model.state === "partial" ? "继续" : "下载"}</button> : <button onClick={() => void deleteModel(model.id)}>删除</button>}</div></article>)}</div>
    </section>
  </section>;
}
