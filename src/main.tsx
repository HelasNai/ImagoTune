import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "./styles.css";
import { ComposerPanel } from "./components/ComposerPanel";
import { DialogProvider, useDialog } from "./components/Dialogs";
import { GalleryWorkspace } from "./components/GalleryWorkspace";
import { LocalAIAction, LocalAISource, LocalAIToolbox } from "./components/LocalAIToolbox";
import { initialTutorialView, TutorialExperience, TutorialView } from "./components/TutorialExperience";
import { NavIcon } from "./components/icons";
import { QueueChip } from "./components/QueueChip";
import { QueuePanel } from "./components/QueuePanel";
import { ResultPanel } from "./components/ResultPanel";
import { SidebarProjects } from "./components/SidebarProjects";
import { SettingsPanel } from "./components/SettingsPanel";
import { StudioProvider, type StudioNotify } from "./components/StudioContext";
import { Tooltip } from "./components/Tooltip";
import { ProgressProvider } from "./components/ProgressContext";
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
import { setLocale } from "./lib/i18n";
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

// v3.4：模块切换交叉过渡是否可用——决定 .page-transition 走 View Transitions 还是单向淡入兜底。
const supportsViewTransition = typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === "function";

function App() {
  const initialTutorial = useMemo(() => parseTutorialState(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)), []);
  const appRef = useRef<HTMLDivElement | null>(null);
  const [mode, setModeState] = useState<Mode>("generate");
  // v3.4 模块切换交叉过渡：模式切换统一经此包装走 View Transitions——旧页快照淡出 +
  // 新页快照淡入同时进行，消除 key={mode} 硬卸载造成的「旧页消失 → 新页从空白淡入」闪空。
  // 快照位于顶层 ::view-transition 伪元素、不改动文档内布局，故不违反 v1.5.2
  // 「.page-transition 禁用 transform」红线（fixed 底栏 .run-row / .settings-dock 不受影响）。
  // 保持 Dispatch 签名 → main.tsx 与 useComposer 的全部既有 setMode 调用点无需改动。
  const setMode = useCallback<React.Dispatch<React.SetStateAction<Mode>>>((next) => {
    const apply = () => setModeState((current) => (typeof next === "function" ? next(current) : next));
    const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
    if (typeof doc.startViewTransition !== "function") { apply(); return; }
    // 回调内必须同步完成 DOM 提交（flushSync），否则新状态快照会早于更新被截取。
    doc.startViewTransition(() => { flushSync(apply); });
  }, []);
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
  // 侧栏项目树用的全量图片快照（refreshWorkspace 填充；与 projects 同源同批更新）。
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
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
  // 跨页跳转意图（图片级 / 项目级，二选一）：由 openGalleryAt / openGalleryProject 写入，
  // GalleryWorkspace 定位（或目标失效）后经 onFocusConsumed 清空。
  const [galleryTarget, setGalleryTarget] = useState<{ imageId?: string; projectId?: string } | null>(null);

  const updateTutorialState = useCallback((next: TutorialState) => {
    setTutorialState(next);
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const tutorialNavigate = useCallback((nextMode: TutorialMode) => setMode(nextMode), []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const workspace = await callIpc(() => window.imageStudio.gallery.workspace(), { fallbackError: "本地图库读取失败" });
      setProjects(workspace.projects || []);
      setGalleryItems(workspace.items || []);
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
      // 持久化语言 → i18n 单例（幂等；覆盖首次到达与后续变化）。切换 UI 在 SettingsPanel。
      setLocale(value.locale);
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

  // 交给操作系统：默认关联程序打开 / 在文件资源管理器中定位（仅图库图片带 galleryId）。
  const openGalleryFile = (galleryId: string, mode: "open" | "reveal") => {
    void callIpc(
      () => window.imageStudio.gallery.openLocal(galleryId, mode),
      { fallbackError: mode === "reveal" ? "无法定位文件" : "无法打开文件", onError: (message) => notify(message, true) },
    ).catch(() => { /* callIpc 已上报 */ });
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

  /** 从任意页面跳转图库并定位到指定图片：先写入跳转意图，再切换模式（沿用 openLocalAI 的「写 payload 后 setMode」模式，setMode 不携带 payload）。 */
  function openGalleryAt(imageId: string) {
    setGalleryTarget({ imageId });
    setMode("gallery");
  }

  /** 项目级跳转：打开图库并筛选到指定项目（GalleryWorkspace 经 initialProjectId 选中项目后消费意图）。 */
  function openGalleryProject(projectId: string) {
    setGalleryTarget({ projectId });
    setMode("gallery");
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
            <QueueChip queueItems={queueItems} onOpen={() => setMode("queue")} />
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
            <button className={mode === "generate" ? "nav active" : "nav"} data-mode="generate" onClick={() => setMode("generate")}><NavIcon name="sparkles" />创作生成</button>
            <button className={mode === "edit" ? "nav active" : "nav"} data-mode="edit" onClick={() => setMode("edit")}><NavIcon name="pen-line" />图片编辑</button>
            <button className={mode === "outpaint" ? "nav active" : "nav"} data-mode="outpaint" onClick={() => setMode("outpaint")}><NavIcon name="expand" />智能扩图</button>
            <button className={mode === "gallery" ? "nav active" : "nav"} data-mode="gallery" onClick={() => setMode("gallery")}><NavIcon name="images" />项目图库</button>
            <button className={mode === "local-ai" ? "nav active" : "nav"} data-mode="local-ai" onClick={() => setMode("local-ai")}><NavIcon name="package" />本地工具箱</button>
            <button className={mode === "settings" ? "nav active" : "nav"} data-mode="settings" onClick={() => setMode("settings")}><NavIcon name="settings" />设置</button>
            {/* 项目树（v3.6 起头部含任务队列入口）：不渲染「全部图库」行；「查看全部」经 openGalleryProject 落到对应项目的图库视图。 */}
            <SidebarProjects
              projects={projects}
              items={galleryItems}
              onOpenProject={openGalleryProject}
              onOpenImage={openGalleryAt}
              onChanged={refreshWorkspace}
              onOpenQueue={() => setMode("queue")}
              queueActive={mode === "queue"}
              queueCount={runningCount}
            />
            <Tooltip content="新手教程">
              <button className="sidebar-help" aria-label="新手教程" onClick={() => setTutorialView("center")}>
                <NavIcon name="graduation-cap" size={18} />
              </button>
            </Tooltip>
          </aside>
          <main>
            <div className={supportsViewTransition ? "page-transition" : "page-transition page-fallback"} key={mode}>
            {mode === "settings" ? <SettingsPanel onSaveDirChanged={handleSaveDirChanged} onOpenTutorial={() => setTutorialView("center")} /> : mode === "gallery" ? (
              <GalleryWorkspace
                onOpen={galleryOpen}
                onVariation={(item) => createVariation(item)}
                onLocalAI={openGalleryLocalAI}
                onNotice={notify}
                focusImageId={galleryTarget?.imageId}
                initialProjectId={galleryTarget?.projectId}
                onFocusConsumed={() => setGalleryTarget(null)}
                onChanged={refreshWorkspace}
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
            ) : mode === "queue" ? <QueuePanel queueItems={queueItems} onRefresh={refreshQueue} onOpenGalleryAt={openGalleryAt} /> : <><ComposerPanel mode={mode} projects={projects} activeJobId={studioComposer.activeJobId} isEnqueueing={studioComposer.isEnqueueing} progress={studioComposer.progress} composerState={studioComposer.state} composerActions={studioComposer.actions} onOpenSettings={() => setMode("settings")} /><ResultPanel outputs={outputs} onRegenerate={regenerate} onContinueEdit={continueEdit} onStartOutpaint={startOutpaint} onOpenLocalAI={openLocalAI} onCreateVariation={createVariation} onOpenPreview={setPreview} /></>}
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
            <Tooltip content="点击空白处或右上角关闭">
              <button className="lightbox-close" onClick={() => { setPreviewContextMenu(null); setPreview(null); }} aria-label="关闭预览"><NavIcon name="x" size={20} /></button>
            </Tooltip>
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
                {(() => {
                  const galleryId = preview.galleryId;
                  if (!galleryId) return null;
                  return (
                    <>
                      <button onClick={() => { openGalleryFile(galleryId, "open"); setPreviewContextMenu(null); }}>用系统应用打开</button>
                      <button onClick={() => { openGalleryFile(galleryId, "reveal"); setPreviewContextMenu(null); }}>在文件夹中显示</button>
                    </>
                  );
                })()}
                <button onClick={() => openLocalAI(preview, "upscale")}>高清放大</button>
                <button onClick={() => openLocalAI(preview, "remove-background")}>智能抠图</button>
                <button onClick={() => openLocalAI(preview, "face-restore")}>人脸优化 Beta</button>
                <button onClick={() => openLocalAI(preview, "pipeline")}>本地组合处理</button>
              </div>
            )}
            <span>右键点击图片可复制</span>
          </div>
        )}
      </div>
    </StudioProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><DialogProvider><ProgressProvider><App /></ProgressProvider></DialogProvider></React.StrictMode>,
);
