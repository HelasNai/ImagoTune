import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { ComposerPanel } from "./components/ComposerPanel";
import { DialogProvider, useDialog } from "./components/Dialogs";
import { GalleryWorkspace } from "./components/GalleryWorkspace";
import { LocalAIAction, LocalAISource, LocalAIToolbox } from "./components/LocalAIToolbox";
import { initialTutorialView, TutorialExperience, TutorialView } from "./components/TutorialExperience";
import { NavIcon } from "./components/icons";
import { QueuePanel } from "./components/QueuePanel";
import { ResultPanel } from "./components/ResultPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { StudioProvider, type StudioNotify } from "./components/StudioContext";
import { useComposer } from "./components/useComposer";
import { recipeFromQueueInput } from "./components/queue-utils";
import { dataUrlFor } from "./components/media-utils";
import { callIpc } from "./components/ipc";
import { useCopyImage } from "./components/useCopy";
import { useEscapeKey } from "./components/useKeyboard";
import type { Mode, Output } from "./components/types";
import { createRecipe, variationOptions } from "./lib/creative";
import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, INBOX_PROJECT_ID } from "./lib/constants";
import { formatDateTime, formatDurationSeconds, formatTags } from "./lib/format";
import { b64ToDataUrl } from "./lib/media";
import {
  parseTutorialState,
  shouldInitializeAsExistingUser,
  TUTORIAL_STORAGE_KEY,
  TutorialMode,
  TutorialState,
} from "./lib/tutorial";

// 通知自动关闭时长（v2.7）：成功/信息 5s；错误/需处理 12s（留足阅读「建议」的时间）。
const NOTICE_TOAST_MS = 5000;
const ERROR_TOAST_MS = 12000;

function App() {
  const initialTutorial = useMemo(() => parseTutorialState(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)), []);
  const appRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("generate");
  const [tutorialState, setTutorialState] = useState<TutorialState>(initialTutorial);
  const [tutorialView, setTutorialView] = useState<TutorialView>(() => initialTutorialView(initialTutorial));
  const [tutorialReturnMode, setTutorialReturnMode] = useState<Mode>("generate");
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [preview, setPreview] = useState<Output | null>(null);
  const [previewContextMenu, setPreviewContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [configured, setConfigured] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [roles, setRoles] = useState<Record<ModelRole, RoleBinding | null>>({ image: null, reverse: null, enhance: null });
  const [autoArchive, setAutoArchive] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [projectId, setProjectId] = useState(INBOX_PROJECT_ID);
  const [tagsText, setTagsText] = useState("");
  const [queueItems, setQueueItems] = useState<QueueJob[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [errorInfo, setErrorInfo] = useState<GenerationErrorInfo | null>(null);
  // 派生：侧栏/配方显示的当前模型名（未绑定时回退默认）。
  const imageModel = roles.image?.model ?? DEFAULT_IMAGE_MODEL;
  const chatModel = roles.enhance?.model ?? DEFAULT_CHAT_MODEL;
  const notify = useCallback<StudioNotify>((message, isError = false) => {
    if (!message) return;
    // 成功/失败互斥：同一时刻只保留一种状态，避免旧错误遮挡新的成功提示。
    if (isError) {
      setNotice("");
      setError(message);
    } else {
      setError("");
      setErrorInfo(null);
      setNotice(message);
    }
  }, []);
  const copyImage = useCopyImage(notify);
  const [localAISource, setLocalAISource] = useState<LocalAISource | null>(null);
  const [localAIAction, setLocalAIAction] = useState<LocalAIAction>("upscale");

  const updateTutorialState = useCallback((next: TutorialState) => {
    setTutorialState(next);
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const tutorialNavigate = useCallback((nextMode: TutorialMode) => setMode(nextMode), []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const workspace = await callIpc(() => window.imageStudio.gallery.workspace(), { fallbackError: "本地图库读取失败" });
      setProjects(workspace.projects || []);
      if (!workspace.projects.some((project) => project.id === projectId)) {
        setProjectId(INBOX_PROJECT_ID);
      }
    } catch (cause) {
      setError("本地图库读取失败：" + ((cause as Error).message || "请检查保存目录"));
    }
  }, [projectId]);
  const refreshQueue = useCallback(async () => {
    try {
      const result = await callIpc(() => window.imageStudio.queue.list(), { fallbackError: "队列读取失败", onError: setError });
      setQueueItems(result.items || []);
    } catch { /* callIpc 已上报 */ }
  }, []);

  const refreshSettings = useCallback(async (): Promise<SettingsSnapshot | null> => {
    try {
      const value = await callIpc(() => window.imageStudio.settings.get(), { fallbackError: "无法读取设置", onError: setError });
      if (!value || !Array.isArray(value.providers)) return null;
      setProviders(value.providers);
      setRoles(value.roles);
      setConfigured(value.configured);
      setAutoArchive(value.autoArchive);
      if (value.warning) notify(value.warning, true);
      return value;
    } catch { /* callIpc 已上报 */ return null; }
  }, [notify]);

  const { requestText, requestConfirm } = useDialog();

  const studioComposer = useComposer({
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
    imageBinding: roles.image,
    configured,
    requestText,
    requestConfirm,
  });

  const handleSaveDirChanged = useCallback(async () => {
    setProjectId(INBOX_PROJECT_ID);
    await refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    const bootstrap = async () => {
      const [settingsValue, workspaceValue, queueValue] = await Promise.all([
        refreshSettings(),
        callIpc(() => window.imageStudio.gallery.workspace(), { fallbackError: "本地图库读取失败", onError: setError }),
        callIpc(() => window.imageStudio.queue.list(), { fallbackError: "队列读取失败", onError: setError }),
      ]);
      const hasTutorialState = window.localStorage.getItem(TUTORIAL_STORAGE_KEY) !== null;
      if (!hasTutorialState && shouldInitializeAsExistingUser({
        configured: settingsValue?.hasSavedApiKey ?? false,
        galleryCount: workspaceValue.items?.length || 0,
        queueCount: queueValue.items?.length || 0,
        localDataSince: performance.timeOrigin,
      })) {
        const existingState: TutorialState = { ...initialTutorial, status: "dismissed", updatedAt: new Date().toISOString() };
        updateTutorialState(existingState);
        setTutorialView("none");
      }
      setQueueItems(queueValue.items || []);
    };
    void bootstrap().catch(() => { /* Individual panels show their own recoverable errors. */ });
    void callIpc(() => window.imageStudio.updates.get(), { fallbackError: "无法读取版本信息", onError: setError }).then((value) => {
      setAppVersion(value.appVersion);
    }).catch(() => { /* callIpc 已上报 */ });
    void refreshWorkspace();
  }, [initialTutorial, refreshSettings, refreshWorkspace, updateTutorialState]);

  // v2.7：通知不再随模式切换清空——toast 有自己的生命周期（见下方自动关闭计时），
  // 切换侧栏仅重置滚动位置与右键菜单。
  useEffect(() => {
    appRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setPreviewContextMenu(null);
  }, [mode]);

  // v2.7 通知自动关闭：成功/信息 5s、错误/需处理 12s；新通知出现会重置计时。
  // notice 出现时顺带清掉旧错误——否则新的成功提示会被更高优先级的旧错误遮挡。
  useEffect(() => {
    if (!notice) return;
    setError("");
    setErrorInfo(null);
    const timer = window.setTimeout(() => setNotice(""), NOTICE_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error && !errorInfo) return;
    const timer = window.setTimeout(() => {
      setError("");
      setErrorInfo(null);
    }, ERROR_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [error, errorInfo]);

  useEscapeKey(useCallback(() => {
    setPreviewContextMenu(null);
    if (preview) setPreview(null);
  }, [preview]));

  useEffect(() => window.imageStudio.onTutorialOpen(() => setTutorialView("center")), []);

  useEffect(() => {
    const offProgress = window.imageStudio.onProgress((value) => {
      if (value.requestId === studioComposer.requestId) studioComposer.setProgress(value);
    });
    const offQueue = window.imageStudio.onQueueUpdate((value) => setQueueItems(value));
    const offResult = window.imageStudio.onQueueResult((value) => {
      const result = value.result;
      const gallery = result.gallery || [];
      const input = value.job.input;
      const baseRecipe = result.recipe || recipeFromQueueInput(input, value.job.kind, studioComposer.chosenSize);
      const items = (result.images || [])
        .filter((item) => item.b64_json)
        .map((item, index) => ({
          id: crypto.randomUUID(),
          b64: item.b64_json || "",
          createdAt: Date.now(),
          galleryId: gallery[index]?.id,
          recipe: gallery[index]?.recipe || createRecipe({
            ...baseRecipe,
            seed: item.seed === undefined ? baseRecipe.seed : String(item.seed),
          }),
        }));
      if (value.job.id === studioComposer.activeJobId) {
        setOutputs(items);
        studioComposer.setActiveJobId("");
        const elapsed = "生成完成，用时 " + formatDurationSeconds(result.elapsedMs || 0) + "。";
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
      if (job.id === studioComposer.activeJobId) {
        studioComposer.setActiveJobId("");
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
  }, [studioComposer.activeJobId, studioComposer.chosenSize, refreshWorkspace, studioComposer.requestId]);

  const regenerate = (output: Output) => {
    const recipe = output.recipe;
    void studioComposer.enqueue({
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
    studioComposer.loadRecipe(output, "edit");
  };

  const startOutpaint = (output: Output) => {
    studioComposer.loadRecipe(output, "outpaint");
  };

  const createVariation = (
    source: Output | GalleryItem,
    option: (typeof variationOptions)[number] = variationOptions[0],
  ) => {
    const sourceId = "fileName" in source ? source.id : source.galleryId;
    const recipe = source.recipe;
    void studioComposer.enqueue({
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
      studioComposer.actions.setPrompt(item.recipe.prompt);
      studioComposer.actions.setNegativePrompt(item.recipe.negativePrompt);
      setProjectId(item.recipe.projectId);
      setTagsText(formatTags(item.recipe.tags));
      if (item.recipe.ratio) studioComposer.actions.setRatio(item.recipe.ratio);
      if (item.recipe.resolution) studioComposer.actions.setResolution(item.recipe.resolution);
      if (item.recipe.quality) studioComposer.actions.setQuality(item.recipe.quality);
      setNotice("已复用历史参数，可修改提示词后生成");
    }
  };

  const runningCount = useMemo(
    () => queueItems.filter((item) => ["queued", "running"].includes(item.status)).length,
    [queueItems],
  );

  function openLocalAI(output: Output, action: LocalAIAction) {
    setLocalAISource({
      title: `生成结果-${formatDateTime(output.createdAt)}`,
      dataUrl: dataUrlFor(output),
      recipe: output.recipe,
      sourceId: output.galleryId,
    });
    setLocalAIAction(action);
    setMode("local-ai");
    setPreviewContextMenu(null);
    setPreview(null);
  }

  function openGalleryLocalAI(item: GalleryItem, b64: string, action: LocalAIAction) {
    setLocalAISource({ title: item.title || item.id, dataUrl: b64ToDataUrl(b64), recipe: item.recipe, sourceId: item.id });
    setLocalAIAction(action);
    setMode("local-ai");
  }

  return (
    <StudioProvider
      value={{
        error, setError,
        notice, setNotice,
        errorInfo, setErrorInfo,
        notify,
        projectId, setProjectId,
        tagsText, setTagsText,
        providers, roles, refreshSettings,
        imageModel, chatModel,
        configured, setConfigured,
        autoArchive, setAutoArchive,
      }}
    >
      <div className="app" ref={appRef}>
        <header>
          <div className="header-brand">
            <div className="header-title-row">
              <span className="eyebrow">IMAGOTUNE · V{appVersion || "2.0.0"}</span>
            </div>
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
              {errorInfo?.category && <span>{errorInfo.category.replace("_", " ")}</span>}
              <span>{error || errorInfo?.message || notice}</span>
              {errorInfo?.suggestion && <small>{errorInfo.suggestion}</small>}
              {errorInfo?.details && (
                <details>
                  <summary>查看接口详情</summary>
                  <pre style={{ margin: 0, maxHeight: 150, overflow: "auto", whiteSpace: "pre-wrap", font: "11px/1.5 monospace" }}>{errorInfo.details}</pre>
                </details>
              )}
            </div>
            <button aria-label="关闭提示" onClick={() => { setError(""); setNotice(""); setErrorInfo(null); }}><NavIcon name="x" size={16} /></button>
          </div>
        )}
        <div className="layout">
          <aside>
            <button className={mode === "generate" ? "nav active" : "nav"} onClick={() => setMode("generate")}><NavIcon name="sparkles" />创作生成</button>
            <button className={mode === "edit" ? "nav active" : "nav"} onClick={() => setMode("edit")}><NavIcon name="pen-line" />图片编辑</button>
            <button className={mode === "outpaint" ? "nav active" : "nav"} onClick={() => setMode("outpaint")}><NavIcon name="expand" />智能扩图</button>
            <button className={mode === "gallery" ? "nav active" : "nav"} onClick={() => setMode("gallery")}><NavIcon name="images" />项目图库</button>
            <button className={mode === "local-ai" ? "nav active" : "nav"} onClick={() => setMode("local-ai")}><NavIcon name="package" />本地工具箱</button>
            <button className={mode === "queue" ? "nav active" : "nav"} onClick={() => setMode("queue")}><NavIcon name="list-todo" />任务队列</button>
            <button className={mode === "settings" ? "nav active" : "nav"} onClick={() => setMode("settings")}><NavIcon name="settings" />设置</button>
            <button className="nav tutorial-nav" onClick={() => setTutorialView("center")}><NavIcon name="graduation-cap" />新手教程</button>
            <div className="aside-tip">
              <span>当前模型</span><strong>{imageModel}</strong>
              <p>提示词增强：{chatModel}<br />图片、项目与队列均保存在本机。</p>
            </div>
          </aside>
          <main>
            <div className="page-transition" key={mode}>
            {mode === "settings" ? <SettingsPanel onSaveDirChanged={handleSaveDirChanged} onOpenTutorial={() => setTutorialView("center")} /> : mode === "gallery" ? (
              <GalleryWorkspace
                onOpen={galleryOpen}
                onVariation={(item) => createVariation(item)}
                onLocalAI={openGalleryLocalAI}
                onNotice={notify}
              />
            ) : mode === "local-ai" ? (
              <LocalAIToolbox
                source={localAISource}
                initialAction={localAIAction}
                projectId={projectId}
                onSourceChange={setLocalAISource}
                onArchived={({ b64, recipe, galleryId }) => setOutputs((current) => [{
                  id: crypto.randomUUID(),
                  b64,
                  createdAt: Date.now(),
                  galleryId,
                  recipe,
                }, ...current])}
                onNotice={notify}
              />
            ) : mode === "queue" ? <QueuePanel queueItems={queueItems} onRefresh={refreshQueue} /> : <><ComposerPanel mode={mode} projects={projects} activeJobId={studioComposer.activeJobId} isEnqueueing={studioComposer.isEnqueueing} progress={studioComposer.progress} composerState={studioComposer.state} composerActions={studioComposer.actions} /><ResultPanel outputs={outputs} onRegenerate={regenerate} onContinueEdit={continueEdit} onStartOutpaint={startOutpaint} onOpenLocalAI={openLocalAI} onCreateVariation={createVariation} onOpenPreview={setPreview} /></>}
            </div>
          </main>
        </div>

        <TutorialExperience
          view={tutorialView}
          state={tutorialState}
          currentMode={mode}
          onViewChange={setTutorialView}
          onStateChange={updateTutorialState}
          onNavigate={tutorialNavigate}
          onTourStart={() => setTutorialReturnMode(mode)}
          onTourExit={(destination) => { if (destination === "generate") setMode("generate"); else if (destination === "restore") setMode(tutorialReturnMode); }}
        />

        {preview && (
          <div className="lightbox" onClick={() => { setPreviewContextMenu(null); setPreview(null); }}>
            <button className="lightbox-close" onClick={() => { setPreviewContextMenu(null); setPreview(null); }} aria-label="关闭预览"><NavIcon name="x" size={20} /></button>
            <img
              src={dataUrlFor(preview)}
              onClick={(event) => { event.stopPropagation(); setPreviewContextMenu(null); }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPreviewContextMenu({
                  x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
                  y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)),
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
                    void copyImage(preview.b64, "图片已复制到剪贴板");
                    setPreviewContextMenu(null);
                  }}
                >
                  复制图片
                </button>
                <button onClick={() => openLocalAI(preview, "upscale")}>高清放大</button>
                <button onClick={() => openLocalAI(preview, "remove-background")}>智能抠图</button>
                <button onClick={() => openLocalAI(preview, "face-restore")}>人脸优化 Beta</button>
                <button onClick={() => openLocalAI(preview, "pipeline")}>本地组合处理</button>
              </div>
            )}
            <span>右键点击图片可复制；点击空白处或右上角关闭</span>
          </div>
        )}
      </div>
    </StudioProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><DialogProvider><App /></DialogProvider></React.StrictMode>,
);
