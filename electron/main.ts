import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import keytar from "keytar";
import archiver from "archiver";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { createGalleryStore, GalleryProject, GallerySearch, GalleryStore } from "./gallery-store";
import { createQueueStore, QueueJob, QueueStore } from "./queue-store";
import { composeImagePrompt, ImageRecipeV1, normalizeRecipe, stringValue, tagsValue } from "./image-recipe";
import { classifyHttpError, classifyRuntimeError, cancelledErrorInfo, errorInfoMessage, GenerationError, GenerationErrorInfo } from "./generation-error";
import { embedRecipeInPng, readRecipeFromPng } from "./png-metadata";
import { isVisionInputUnsupported, parseReversePrompt } from "./reverse-prompt";
import { normalizeImageBase64, prioritizeImageResponses, type ImageResponse } from "./image-response";
import { LocalAIModelManager } from "./local-ai-model-manager";
import { LocalAIModelId, localAIModelById } from "./local-ai-models";
import { createDirectoryManager } from "./directory-manager";
import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, INBOX_PROJECT_ID } from "./constants";
import { errorMessage, joinBase, withTimeout } from "./net-utils";
import { nowISO } from "./fs-utils";
import { CANVAS_MAX_EDGE, CANVAS_MAX_PIXELS, CANVAS_MULTIPLE } from "./outpaint-limits";
import type { ApiImage, BinaryPayload, PromptTemplate, UpdateChannel, UpdatePhase, UpdateStatus } from "../shared/types";
import {
  CLIPBOARD_COPY_IMAGE, CLIPBOARD_COPY_TEXT, CLIPBOARD_READ_IMAGE,
  GALLERY_BULK, GALLERY_DELETE, GALLERY_EXPORT_ZIP, GALLERY_LIST, GALLERY_LOAD_IMAGE,
  GALLERY_SEARCH, GALLERY_THUMBNAIL, GALLERY_TOGGLE_FAVORITE, GALLERY_UPDATE, GALLERY_WORKSPACE,
  IMAGE_CANCEL, IMAGE_EDIT, IMAGE_GENERATE, IMAGE_PROGRESS, IMAGE_SAVE,
  LOCAL_AI_ARCHIVE_RESULT, LOCAL_AI_CAPABILITIES, LOCAL_AI_CHOOSE_MODEL_DIR, LOCAL_AI_DELETE_MODEL,
  LOCAL_AI_DOWNLOAD_MODEL, LOCAL_AI_MODEL_PROGRESS, LOCAL_AI_MODELS, LOCAL_AI_MODEL_URL,
  LOCAL_AI_OPEN_MODEL_DIR, LOCAL_AI_PAUSE_DOWNLOAD, LOCAL_AI_RESET_MODEL_DIR,
  OUTPAINT_PREPARE, PNG_READ_RECIPE,
  PROJECTS_CREATE, PROJECTS_DELETE, PROJECTS_RENAME, PROJECTS_SET_COVER,
  PROMPT_ENHANCE, PROMPT_REVERSE,
  QUEUE_CANCEL, QUEUE_ENQUEUE, QUEUE_ERROR, QUEUE_LIST, QUEUE_REMOVE, QUEUE_RESULT, QUEUE_RETRY, QUEUE_UPDATE,
  SETTINGS_CHOOSE_SAVE_DIR, SETTINGS_CLEAR, SETTINGS_GET, SETTINGS_OPEN_SAVE_DIR, SETTINGS_RESET_SAVE_DIR,
  SETTINGS_SAVE, SETTINGS_TEST,
  TEMPLATES_DELETE, TEMPLATES_LIST, TEMPLATES_SAVE,
  UPDATES_CHECK, UPDATES_DOWNLOAD, UPDATES_GET, UPDATES_INSTALL, UPDATES_SET_ALPHA_UNLOCKED,
  UPDATES_SET_AUTO_UPDATE, UPDATES_SET_CHANNEL, UPDATE_STATUS,
  WINDOW_CLOSE, WINDOW_GET_ZOOM, WINDOW_IS_MAXIMIZED, WINDOW_MAXIMIZED_CHANGED, WINDOW_MINIMIZE,
  WINDOW_SET_ZOOM, WINDOW_TOGGLE_MAXIMIZE,
} from "./channels";

// 注：曾尝试 Chromium overlay 滚动条（--enable-features=OverlayScrollbar）以避免 scrollbar-gutter 槽位，
// 但 Electron 44 存在回归（electron#53350）：appendSwitch / appendArgument 均不生效，反而回落到经典滚动条。
// 现改为：渲染层用自定义滚动条 + scrollbar-gutter 不抖动，槽位与轨道透出「窗口底色」，
// 故把窗口底色取成页面右缘近似色，使槽位与页面/header 融为一体。
protocol.registerSchemesAsPrivileged([{ scheme: "local-ai-model", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const SERVICE = "imagotune";
const LEGACY_SERVICES = ["ai-image-studio", "pinaic-image-studio"];
const ACCOUNT = "default";
const DEFAULT_BASE_URL = "";
const LEGACY_SAVE_DIR = "D:\\codexproject\\生图\\保存图片";
const controllers = new Map<string, AbortController>();
const cancelledRequests = new Set<string>();
const timedOutRequests = new Set<string>();
let updateStatus: UpdateStatus = { phase: "idle", message: "尚未检查更新" };
let updateCheckInFlight = false;
let updatePromptOpen = false;

type BinaryInput = BinaryPayload;
type RequestInput = Record<string, unknown> & { requestId: string; recipe?: ImageRecipeV1; title?: string };
type EditInput = RequestInput & { image: BinaryInput; mask?: BinaryInput };
const DEFAULT_TEMPLATES: PromptTemplate[] = [
  { id: "builtin-poster", title: "科技产品海报", category: "海报", prompt: "一张高级科技感产品海报，主体清晰突出，蓝紫与粉色渐变光效，留出标题和副标题空间，商业广告级构图", kind: "positive", ratio: "4:5", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-cover", title: "内容平台封面", category: "封面", prompt: "一张适合内容平台封面的视觉主图，主题明确，主体醒目，画面干净，保留适合叠加标题的留白区域", kind: "positive", ratio: "16:9", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-product", title: "产品展示图", category: "产品", prompt: "专业产品摄影，主体居中，干净高级的棚拍光线，细腻材质，简洁背景，无品牌文字和水印", kind: "positive", ratio: "1:1", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-social", title: "社交媒体配图", category: "社交媒体", prompt: "一张适合社交媒体发布的吸睛视觉，主体明确，色彩明快，构图平衡，细节丰富但画面不拥挤", kind: "positive", ratio: "9:16", resolution: "1k", quality: "medium", builtin: true },
  { id: "builtin-negative-quality", title: "通用高质量", category: "通用", prompt: "低清晰度、模糊、噪点、压缩伪影、错误透视、重复元素、水印、签名、乱码文字", kind: "negative", builtin: true },
  { id: "builtin-negative-portrait", title: "人像无畸变", category: "人像", prompt: "多余手指、缺失手指、手部畸形、肢体扭曲、五官错位、双人脸、蜡像皮肤、过度磨皮", kind: "negative", builtin: true },
  { id: "builtin-negative-real", title: "写实去 AI 感", category: "写实", prompt: "塑料质感、过度锐化、虚假光影、悬浮物体、不自然景深、过饱和、AI 绘画感", kind: "negative", builtin: true },
  { id: "builtin-negative-clean", title: "干净背景", category: "背景", prompt: "杂乱背景、无关人物、无关道具、品牌标志、水印、边框、脏污、视觉噪声", kind: "negative", builtin: true }
];
let saveDir = "";
let galleryDir = "";
let galleryStore: GalleryStore;
let queueStore: QueueStore;
let localAIModels: LocalAIModelManager;
let activeQueueJobId: string | null = null;

const saveDirManager = createDirectoryManager({
  credentialKey: `${ACCOUNT}:saveDir`,
  systemDir: systemSaveDir,
  legacyDir: LEGACY_SAVE_DIR,
  activate: activateSaveDirectory,
  currentDir: () => saveDir,
  dialogTitle: "选择 ImagoTune 保存位置",
  resultKey: "saveDir",
  guard: () => (activeQueueJobId ? { ok: false, error: "当前有任务正在生成，请等待完成后再切换保存位置" } : null),
  chooseError: "无法使用所选保存位置",
  resetError: "无法恢复系统默认保存位置",
  readCredential: storedCredential,
  writeCredential: (account, value) => keytar.setPassword(SERVICE, account, value),
});

const modelDirManager = createDirectoryManager({
  credentialKey: `${ACCOUNT}:modelDir`,
  systemDir: systemModelDir,
  activate: activateModelDirectory,
  currentDir: () => localAIModels.modelsDir,
  dialogTitle: "选择本地 AI 模型保存位置",
  resultKey: "modelsDir",
  guard: () => (localAIModels.hasActiveDownloads() ? { ok: false, error: "当前有模型正在下载，请先暂停或等待完成" } : null),
  resultExtras: async () => ({ items: await localAIModels.list() }),
  chooseError: "无法使用所选模型位置",
  resetError: "无法恢复默认模型位置",
  readCredential: storedCredential,
  writeCredential: (account, value) => keytar.setPassword(SERVICE, account, value),
});

function systemModelDir() {
  return path.join(app.getPath("userData"), "models");
}

async function copyModelFiles(source: string, target: string) {
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) return;
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(onnx|part|json)$/i.test(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    const [sourceStat, targetStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(targetPath).catch(() => null),
    ]);
    if (!targetStat || sourceStat.size > targetStat.size) await fs.copyFile(sourcePath, targetPath);
  }
}

async function activateModelDirectory(directory: string, copyFrom?: string) {
  const target = path.resolve(directory);
  await fs.mkdir(target, { recursive: true });
  if (copyFrom) await copyModelFiles(copyFrom, target);
  localAIModels = new LocalAIModelManager(
    target,
    (progress) => broadcast(LOCAL_AI_MODEL_PROGRESS, progress),
    undefined,
    (url, init) => net.fetch(url, init),
  );
  return target;
}

async function archiveImages(images: ApiImage[], input: RequestInput | EditInput, enabled: boolean) {
  const recipe = normalizeRecipe(input, "image" in input ? "edit" : "generate");
  return galleryStore.addImages(images, { title: String(input.title || recipe.prompt.slice(0, 48)), recipe }, enabled);
}

function systemSaveDir() {
  return path.join(app.getPath("pictures"), "ImagoTune");
}

async function activateSaveDirectory(directory: string) {
  const nextSaveDir = path.resolve(directory);
  const nextGalleryDir = path.join(nextSaveDir, "图库");
  await fs.mkdir(nextGalleryDir, { recursive: true });
  const nextGalleryStore = createGalleryStore(nextGalleryDir);
  await nextGalleryStore.readState();
  saveDir = nextSaveDir;
  galleryDir = nextGalleryDir;
  galleryStore = nextGalleryStore;
  return saveDir;
}
async function templatesFile() { return path.join(app.getPath("userData"), "image-studio-templates.json"); }
async function readCustomTemplates(): Promise<PromptTemplate[]> {
  try {
    const raw = await fs.readFile(await templatesFile(), "utf8");
    const value = JSON.parse(raw) as Array<Partial<PromptTemplate>>;
    return Array.isArray(value) ? value.map((item) => ({ ...item, kind: item.kind === "negative" ? "negative" : "positive" })) as PromptTemplate[] : [];
  } catch {
    try {
      const legacy = path.join(app.getPath("userData"), "pinaic-image-templates.json");
      const raw = await fs.readFile(legacy, "utf8");
      const value = JSON.parse(raw) as Array<Partial<PromptTemplate>>;
      return Array.isArray(value) ? value.map((item) => ({ ...item, kind: item.kind === "negative" ? "negative" : "positive" })) as PromptTemplate[] : [];
    } catch { return []; }
  }
}

async function migrateLegacyUserData() {
  try {
    const newDir = app.getPath("userData");
    const oldDir = path.join(app.getPath("appData"), "AI Image Studio");
    if (path.resolve(newDir) === path.resolve(oldDir)) return;
    const existing = await fs.readdir(newDir).catch(() => [] as string[]);
    if (existing.length > 0) return;
    const legacy = await fs.stat(oldDir).catch(() => null);
    if (!legacy || !legacy.isDirectory()) return;
    await fs.cp(oldDir, newDir, { recursive: true, force: true, errorOnExist: false });
  } catch (error) {
    // 迁移失败只告警，绝不删除旧目录，也绝不阻断启动。
    console.warn("迁移旧版 ImagoTune 用户数据目录失败：", error);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 980, minHeight: 680,
    // 系统原生窗口按钮（WCO）：titleBarStyle:'hidden' 隐去系统标题栏，titleBarOverlay 叠加
    // 原生最小化/最大化/关闭按钮；overlay 取全透明且 RGB 用页面基色（#fdf5f9），页面渐变得以
    // 透出、hover 高亮与页面融合；height:32 与旧自绘控件等高，symbolColor 沿用旧图标色。
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "rgba(253,245,249,0)", symbolColor: "#43506b", height: 32 },
    // 仅兜底窗口首帧底色（页面加载前防白闪）：滚动条槽位与透明轨道现由渲染层
    // .app 自身背景绘制（见 src/styles.css v2.1 四层背景），不再依赖此值配色。
    backgroundColor: "#fdf5f9",
    icon: path.join(__dirname, "../ImagoTune.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // 最大化/还原状态仍推送给渲染层（原生 WCO 按钮由系统绘制，此事件保留供渲染层感知窗口状态）。
  win.on("maximize", () => win.webContents.send(WINDOW_MAXIMIZED_CHANGED, true));
  win.on("unmaximize", () => win.webContents.send(WINDOW_MAXIMIZED_CHANGED, false));
  if (process.argv.includes("--dev")) {
    // 移除原生菜单后，开发期仍需 F12/Ctrl+Shift+I 开发者工具与刷新快捷键。
    // 用 before-input-event 只在当前窗口聚焦时拦截，不使用 globalShortcut（避免全局生效）。
    win.webContents.on("before-input-event", (event, input) => {
      const key = input.key.toLowerCase();
      if (input.key === "F12" || (input.control && input.shift && key === "i")) {
        event.preventDefault();
        win.webContents.toggleDevTools();
      } else if (input.control && input.shift && key === "r") {
        event.preventDefault();
        win.webContents.reloadIgnoringCache();
      } else if (input.control && !input.shift && key === "r") {
        event.preventDefault();
        win.webContents.reload();
      } else if (input.key === "F5") {
        event.preventDefault();
        win.webContents.reload();
      }
    });
  }
  if (process.argv.includes("--dev")) win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  else win.loadFile(path.join(__dirname, "../dist-renderer/index.html"));
}

async function storedCredential(account: string) {
  const current = await keytar.getPassword(SERVICE, account);
  if (current !== null) return current;
  for (const legacyService of LEGACY_SERVICES) {
    const legacy = await keytar.getPassword(legacyService, account);
    if (legacy !== null) {
      try {
        await keytar.setPassword(SERVICE, account, legacy);
      } catch {
        // 回写失败也要返回读到的旧值，避免用户凭据丢失。
      }
      return legacy;
    }
  }
  return null;
}

async function config() {
  const archiveSetting = await storedCredential(`${ACCOUNT}:autoArchive`);
  return {
    apiKey: await storedCredential(ACCOUNT),
    baseUrl: (await storedCredential(`${ACCOUNT}:baseUrl`)) || DEFAULT_BASE_URL,
    imageModel: (await storedCredential(`${ACCOUNT}:imageModel`)) || DEFAULT_IMAGE_MODEL,
    chatModel: (await storedCredential(`${ACCOUNT}:chatModel`)) || DEFAULT_CHAT_MODEL,
    autoArchive: archiveSetting !== "false",
  };
}

async function updateChannelPref(): Promise<UpdateChannel> {
  const stored = await storedCredential(`${ACCOUNT}:updateChannel`);
  return stored === "beta" ? "beta" : stored === "alpha" ? "alpha" : "stable";
}

// 隐藏 Alpha 内测渠道的解锁标志：仅存于 keytar，渲染层无法直接读写。
async function alphaChannelUnlocked(): Promise<boolean> {
  return (await storedCredential(`${ACCOUNT}:alphaChannelUnlocked`)) === "true";
}

async function autoUpdatePref(): Promise<boolean> {
  const current = await storedCredential(`${ACCOUNT}:autoUpdate`);
  if (current !== null) return current !== "false";
  // 向后兼容旧键 checkUpdatesAtStartup：仅显式 "false" 视为关闭，缺失或其它值视为开启。
  return (await storedCredential(`${ACCOUNT}:checkUpdatesAtStartup`)) !== "false";
}

function publishUpdateStatus(next: UpdateStatus) {
  updateStatus = next;
  broadcast(UPDATE_STATUS, updateStatus);
}

function updateWindow() {
  return BrowserWindow.getAllWindows()[0];
}

async function downloadAppUpdate() {
  if (!app.isPackaged) return { ok: false, message: "开发模式不检查更新，请使用安装版测试。" };
  if (updateStatus.phase === "downloading") return { ok: true, message: "更新正在下载。" };
  try {
    publishUpdateStatus({ phase: "downloading", version: updateStatus.version, progress: 0, message: "正在下载更新…" });
    await autoUpdater.downloadUpdate();
    return { ok: true, message: "更新下载完成。" };
  } catch (error) {
    const message = errorMessage(error, "更新下载失败");
    publishUpdateStatus({ phase: "error", message });
    return { ok: false, message };
  }
}

async function promptForDownload(info: UpdateInfo) {
  if (updatePromptOpen) return;
  const win = updateWindow();
  if (!win) return;
  updatePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(win, {
      type: "info",
      title: "发现新版本",
      message: "ImagoTune " + info.version + " 已可更新",
      detail: "是否现在下载？下载完成后仍由你选择是否重启安装。",
      buttons: ["稍后再说", "下载更新"],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    });
    if (result.response === 1) await downloadAppUpdate();
  } finally {
    updatePromptOpen = false;
  }
}

async function checkForAppUpdate() {
  if (!app.isPackaged) {
    const message = "开发模式不检查更新，请使用安装版测试。";
    publishUpdateStatus({ phase: "idle", message });
    return { ok: false, message };
  }
  if (updateCheckInFlight) return { ok: true, message: "正在检查更新…" };
  try {
    updateCheckInFlight = true;
    await autoUpdater.checkForUpdates();
    return { ok: true, message: "已完成更新检查。" };
  } catch (error) {
    const message = errorMessage(error, "检查更新失败");
    publishUpdateStatus({ phase: "error", message });
    return { ok: false, message };
  } finally {
    updateCheckInFlight = false;
  }
}

async function applyUpdatePreferences() {
  const channel = await updateChannelPref();
  autoUpdater.channel = channel === "stable" ? "latest" : channel;
  autoUpdater.allowPrerelease = channel !== "stable";
  // electron-updater's channel setter unconditionally flips allowDowngrade to true.
  // Force it back off so switching beta -> stable never silently downgrades.
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = await autoUpdatePref(); // on = background auto-download; off = manual
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => publishUpdateStatus({ phase: "checking", message: "正在检查更新…" }));
  autoUpdater.on("update-available", (info) => {
    publishUpdateStatus({ phase: "available", version: info.version, message: "发现新版本 v" + info.version });
    if (!autoUpdater.autoDownload) void promptForDownload(info);
  });
  autoUpdater.on("update-not-available", () => publishUpdateStatus({ phase: "not-available", message: "当前已是最新版本。" }));
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    const percent = Math.round(progress.percent);
    publishUpdateStatus({ phase: "downloading", version: updateStatus.version, progress: percent, message: "正在下载更新：" + percent + "%" });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    publishUpdateStatus({ phase: "downloaded", version: info.version, progress: 100, message: "v" + info.version + " 已下载，等待安装。" });
    const win = updateWindow();
    if (!win) return;
    const result = await dialog.showMessageBox(win, {
      type: "info",
      title: "更新已下载",
      message: "ImagoTune " + info.version + " 已准备好",
      detail: "是否现在重启并安装？你也可以稍后在“设置”中执行安装。",
      buttons: ["稍后安装", "重启并安装"],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    });
    if (result.response === 1) autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", (error) => publishUpdateStatus({ phase: "error", message: error.message || "更新服务发生错误" }));
}

function emit(win: BrowserWindow, requestId: string, status: string, progress?: number, message?: string) {
  win.webContents.send(IMAGE_PROGRESS, { requestId, status, progress, message });
}

function formatHttpError(status: number, body: string) {
  return new GenerationError(classifyHttpError(status, body));
}

async function parseResponse(response: Response, win: BrowserWindow, requestId: string): Promise<ImageResponse[]> {
  const type = response.headers.get("content-type") || "";
  if (!response.body) throw new Error("接口没有返回内容");
  if (!type.includes("text/event-stream")) {
    const json = await response.json() as { data?: ImageResponse[]; seed?: string | number };
    return (json.data || []).map((image) => image.seed === undefined && json.seed !== undefined ? { ...image, seed: json.seed } : image);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const images: ApiImage[] = [];
  const consume = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") return;
    try {
      const payload = JSON.parse(value) as { data?: ImageResponse[]; images?: ImageResponse[]; progress?: number; status?: string; message?: string; b64_json?: string; seed?: string | number };
      if (payload.data) images.push(...payload.data.map((image) => image.seed === undefined && payload.seed !== undefined ? { ...image, seed: payload.seed } : image));
      if (payload.images) images.push(...payload.images.map((image) => image.seed === undefined && payload.seed !== undefined ? { ...image, seed: payload.seed } : image));
      if (payload.b64_json) images.push({ b64_json: payload.b64_json, seed: payload.seed });
      emit(win, requestId, payload.status || "生成中", payload.progress, payload.message);
    } catch { /* ignore non-JSON keepalive events */ }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
    lines.forEach(consume);
    if (done) break;
  }
  if (buffer) consume(buffer);
  return images;
}

async function materializeImageResponse(image: ImageResponse, baseUrl: string, apiKey: string, signal: AbortSignal): Promise<ApiImage> {
  if (image.b64_json) return { ...image, b64_json: normalizeImageBase64(image.b64_json) };
  const source = stringValue(image.url);
  if (!source) return image;
  if (source.startsWith("data:image/") && source.includes(";base64,")) {
    return { ...image, b64_json: normalizeImageBase64(source) };
  }
  let target: URL;
  try { target = new URL(source, baseUrl); } catch { throw new Error("接口返回了无效的图片链接"); }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error("接口返回了不支持的图片链接协议");
  const headers: Record<string, string> = {};
  try {
    if (target.origin === new URL(baseUrl).origin) headers.Authorization = `Bearer ${apiKey}`;
  } catch { /* base URL validation is handled by the API request */ }
  const response = await fetch(target, { headers, signal });
  if (!response.ok) throw new Error(`图片链接下载失败（${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error("接口返回的图片文件无效或过大");
  const png = nativeImage.createFromBuffer(bytes).toPNG();
  if (!png.length) throw new Error("接口返回的内容不是有效图片");
  return { ...image, b64_json: png.toString("base64") };
}

async function callImages(win: BrowserWindow, endpoint: "generations" | "edits", input: RequestInput | EditInput) {
  const { apiKey, baseUrl } = await config();
  if (!baseUrl) throw new GenerationError({ category: "authentication", title: "尚未配置基础地址", message: "客户端没有可用于请求图片服务的 API Base URL。", suggestion: "请先在设置中填写兼容平台提供的基础地址。", retryable: false });
  if (!apiKey) throw new GenerationError({ category: "authentication", title: "尚未配置 API 密钥", message: "客户端没有可用于请求图片服务的密钥。", suggestion: "请先在设置中保存兼容平台提供的 API 密钥。", retryable: false });
  const recipe = normalizeRecipe(input, endpoint === "edits" ? "edit" : "generate");
  const effectivePrompt = composeImagePrompt(recipe);
  const controller = new AbortController(); controllers.set(input.requestId, controller);
  // 必须保留两项副作用：controllers 记账供 queue:cancel/IMAGE_CANCEL 中止，timedOutRequests 区分超时与用户取消。
  const timeout = withTimeout(300_000, () => { timedOutRequests.add(input.requestId); controller.abort(); });
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    const progress = Math.min(90, 10 + Math.floor(seconds / 6));
    emit(win, input.requestId, "模型生成中", progress, `已等待 ${seconds} 秒；高分辨率、多张图片或服务排队会更久`);
  }, 5_000);
  try {
    emit(win, input.requestId, "已提交", 5, "请求已发送，正在等待图片服务响应");
    let response: Response;
    if (endpoint === "generations") {
      const body: Record<string, unknown> = { model: recipe.model, prompt: effectivePrompt, size: recipe.size, n: recipe.n, response_format: "b64_json", stream: true };
      if (recipe.quality && recipe.quality !== "auto") body.quality = recipe.quality;
      response = await fetch(joinBase(baseUrl, "/images/generations"), { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    } else {
      const edit = input as EditInput;
      const form = new FormData();
      form.append("model", recipe.model); form.append("prompt", effectivePrompt); form.append("size", recipe.size); form.append("n", String(recipe.n)); form.append("response_format", "b64_json"); form.append("stream", "true");
      if (recipe.quality && recipe.quality !== "auto") form.append("quality", recipe.quality);
      form.append("image", new Blob([Buffer.from(edit.image.data)], { type: edit.image.type || "application/octet-stream" }), edit.image.name);
      if (edit.mask) form.append("mask", new Blob([Buffer.from(edit.mask.data)], { type: edit.mask.type || "application/octet-stream" }), edit.mask.name);
      response = await fetch(joinBase(baseUrl, "/images/edits"), { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal });
    }
    if (!response.ok) { const text = await response.text(); throw formatHttpError(response.status, text); }
    emit(win, input.requestId, "正在接收图片", 92, "图片服务已响应，正在读取结果");
    const parsedImages = await parseResponse(response, win, input.requestId);
    const selectedImages = prioritizeImageResponses(parsedImages, recipe.n);
    if (selectedImages.some((image) => !image.b64_json && image.url)) {
      emit(win, input.requestId, "正在保存图片", 96, "接口返回了图片链接，正在转存为本地 PNG");
    }
    const images: ApiImage[] = [];
    for (const image of selectedImages) {
      images.push(await materializeImageResponse(image, baseUrl, apiKey, controller.signal));
    }
    if (!images.length) throw new Error("接口未返回图片数据");
    emit(win, input.requestId, "完成", 100, `生成完成，用时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`);
    const settings = await config();
    const normalizedInput = { ...input, recipe } as RequestInput | EditInput;
    let gallery: Awaited<ReturnType<typeof archiveImages>> = [];
    let archiveWarning: string | undefined;
    if (settings.autoArchive) {
      try {
        gallery = await archiveImages(images, normalizedInput, true);
      } catch (error) {
        archiveWarning = "图片已经生成成功，但自动归档失败：" + errorMessage(error, "无法写入本地图库") + "。请立即在结果区手动保存，避免图片丢失。";
        emit(win, input.requestId, "生成完成，归档失败", 100, archiveWarning);
      }
    }
    return { ok: true, images, gallery, recipe, archiveWarning, requestId: input.requestId, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new GenerationError(classifyRuntimeError(error, {
        cancelled: cancelledRequests.has(input.requestId),
        timedOut: timedOutRequests.has(input.requestId),
      }));
    }
    const message = errorMessage(error, "生成失败");
    if (/quality/i.test(message) && /(unsupported|unknown|invalid|不支持)/i.test(message)) {
      throw new GenerationError({ category: "parameters", title: "清晰度参数不兼容", message: "当前接口不支持所选清晰度参数。", suggestion: "切换为“自动”后手动重试。", retryable: false, details: message });
    }
    throw new GenerationError(classifyRuntimeError(error));
  } finally {
    timeout.clear();
    clearInterval(heartbeat);
    controllers.delete(input.requestId);
    cancelledRequests.delete(input.requestId);
    timedOutRequests.delete(input.requestId);
  }
}

async function enhancePromptWithModel(prompt: string, mode: "generate" | "edit") {
  const { apiKey, baseUrl, chatModel } = await config(); if (!baseUrl || !apiKey) throw new Error("请先保存基础地址和 API 密钥");
  const timeout = withTimeout(60_000);
  try {
    const response = await fetch(joinBase(baseUrl, "/chat/completions"), { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: chatModel, temperature: 0.7, max_tokens: 1200, messages: [{ role: "system", content: "你是图片提示词优化助手。保留用户意图，不增加不相关主体；输出一段可以直接用于图片生成的中文提示词，不要解释，不要加引号。" }, { role: "user", content: `模式：${mode === "edit" ? "图片编辑，保持主体不变" : "文生图"}\n原始提示词：${prompt}` }] }), signal: timeout.signal });
    if (!response.ok) throw new Error(`提示词增强接口返回 ${response.status}`); const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }; const content = json.choices?.[0]?.message?.content?.trim(); if (!content) throw new Error("提示词增强没有返回内容"); return content;
  } catch (error) { if ((error as Error).name === "AbortError") throw new Error("提示词增强超时，请保留原提示词重试"); throw error; } finally { timeout.clear(); }
}

async function reversePromptWithModel(image: BinaryInput) {
  const { apiKey, baseUrl, chatModel } = await config();
  if (!baseUrl || !apiKey) throw new Error("请先保存基础地址和 API 密钥");
  if (!image.data?.length) throw new Error("请选择需要分析的图片");
  const timeout = withTimeout(90_000);
  try {
    const mime = image.type === "image/png" ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${Buffer.from(image.data).toString("base64")}`;
    const response = await fetch(joinBase(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        temperature: 0.35,
        max_tokens: 1600,
        messages: [
          { role: "system", content: "你是专业图片提示词分析助手。分析画面主体、环境、构图、镜头、光线、色彩、材质和风格，返回可直接用于图片生成的中英文提示词。只输出 JSON：{\"zh\":\"中文提示词\",\"en\":\"English prompt\"}。不要添加 Markdown。" },
          { role: "user", content: [
            { type: "text", text: "请反推这张图片的生成提示词，忠实描述可见内容，不猜测不可见信息。" },
            { type: "image_url", image_url: { url: dataUrl } },
          ] },
        ],
      }),
      signal: timeout.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      if (isVisionInputUnsupported(body)) {
        throw new Error("当前聊天模型或接口不支持图片输入，原提示词未改变。");
      }
      throw new Error(`图反推接口返回 ${response.status}：${body.replace(/\s+/g, " ").slice(0, 300)}`);
    }
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("图反推没有返回提示词");
    return parseReversePrompt(content);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("图反推超过 90 秒，请稍后重试，原提示词未改变。");
    throw error;
  } finally { timeout.clear(); }
}
function broadcast(channel: string, value: unknown) { for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, value); }
async function queueSnapshot() { return queueStore ? queueStore.read() : []; }
async function processQueue() {
  if (!queueStore || activeQueueJobId) return; const items = await queueStore.read(); const job = items.find(item => item.status === "queued"); if (!job) { broadcast(QUEUE_UPDATE, items); return; }
  const win = BrowserWindow.getAllWindows()[0]; if (!win) return; activeQueueJobId = job.id; const running = { ...job, status: "running" as const, attempts: job.attempts + 1, updatedAt: nowISO(), error: undefined, errorInfo: undefined }; await queueStore.save(running); broadcast(QUEUE_UPDATE, await queueStore.read());
  try { const raw = await queueStore.materialize(running); const result = await callImages(win, running.kind === "edit" ? "edits" : "generations", raw as RequestInput & Partial<EditInput>); const completed = { ...running, status: "completed" as const, elapsedMs: result.elapsedMs, resultGalleryIds: (result.gallery || []).map(item => item.id), updatedAt: nowISO() }; await queueStore.save(completed); broadcast(QUEUE_RESULT, { job: completed, result }); }
  catch (error) { const current = (await queueStore.read()).find(item => item.id === running.id); if (current?.status === "cancelled") broadcast(QUEUE_ERROR, current); else { const errorInfo = classifyRuntimeError(error); const failed = { ...running, status: "failed" as const, error: errorInfoMessage(errorInfo), errorInfo, updatedAt: nowISO() }; await queueStore.save(failed); broadcast(QUEUE_ERROR, failed); } }
  finally { const current = (await queueStore.read()).find(item => item.id === running.id); if (current?.status === "completed") await queueStore.removeAssets(running); activeQueueJobId = null; broadcast(QUEUE_UPDATE, await queueStore.read()); void processQueue(); }
}
app.whenReady().then(async () => {
  await migrateLegacyUserData();
  await saveDirManager.activate(await saveDirManager.resolve());
  queueStore = createQueueStore(app.getPath("userData")); await queueStore.recover();
  await modelDirManager.activate(await modelDirManager.resolve());
  protocol.handle("local-ai-model", async (request) => {
    const id = decodeURIComponent(new URL(request.url).hostname) as LocalAIModelId;
    const model = localAIModelById(id);
    if (!model) return new Response("Unknown model", { status: 404 });
    const status = await localAIModels.status(id);
    if (!status.installed) return new Response("Model is not installed", { status: 404 });
    return net.fetch(pathToFileURL(localAIModels.modelPath(id)).toString());
  });
  // 无边框窗口由渲染层自绘标题栏，移除原生应用菜单（菜单项功能迁移至设置页 / 窗口快捷键）。
  Menu.setApplicationMenu(null);
  ipcMain.handle(SETTINGS_GET, async () => { const c = await config(); return { configured: Boolean(c.apiKey && c.baseUrl), hasSavedApiKey: Boolean(c.apiKey), baseUrl: c.baseUrl, imageModel: c.imageModel, chatModel: c.chatModel, autoArchive: c.autoArchive, saveDir }; });
  ipcMain.handle(SETTINGS_SAVE, async (_e, value: { apiKey: string; baseUrl: string; imageModel: string; chatModel: string; autoArchive?: boolean }) => { if (value.apiKey.trim()) await keytar.setPassword(SERVICE, ACCOUNT, value.apiKey.trim()); await keytar.setPassword(SERVICE, `${ACCOUNT}:baseUrl`, value.baseUrl.trim()); await keytar.setPassword(SERVICE, `${ACCOUNT}:imageModel`, value.imageModel.trim() || DEFAULT_IMAGE_MODEL); await keytar.setPassword(SERVICE, `${ACCOUNT}:chatModel`, value.chatModel.trim() || DEFAULT_CHAT_MODEL); await keytar.setPassword(SERVICE, `${ACCOUNT}:autoArchive`, value.autoArchive === false ? "false" : "true"); return { ok: true }; });
  ipcMain.handle(SETTINGS_CHOOSE_SAVE_DIR, () => saveDirManager.choose());
  ipcMain.handle(WINDOW_MINIMIZE, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: "窗口不存在" };
      win.minimize();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error, "无法最小化窗口") };
    }
  });
  ipcMain.handle(WINDOW_TOGGLE_MAXIMIZE, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: "窗口不存在" };
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { ok: true, maximized: win.isMaximized() };
    } catch (error) {
      return { ok: false, error: errorMessage(error, "无法切换窗口最大化状态") };
    }
  });
  ipcMain.handle(WINDOW_CLOSE, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: "窗口不存在" };
      win.close();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error, "无法关闭窗口") };
    }
  });
  ipcMain.handle(WINDOW_IS_MAXIMIZED, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: "窗口不存在" };
      return { ok: true, maximized: win.isMaximized() };
    } catch (error) {
      return { ok: false, error: errorMessage(error, "无法读取窗口最大化状态") };
    }
  });
  ipcMain.handle(WINDOW_GET_ZOOM, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: "窗口不存在" };
      return { ok: true, factor: win.webContents.getZoomFactor() };
    } catch (error) {
      return { ok: false, error: errorMessage(error, "无法读取界面缩放") };
    }
  });
  ipcMain.handle(WINDOW_SET_ZOOM, async (event, factor: number) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: "窗口不存在" };
      if (!Number.isFinite(factor)) return { ok: false, error: "缩放比例无效" };
      const clamped = Math.min(2, Math.max(0.5, factor));
      win.webContents.setZoomFactor(clamped);
      return { ok: true, factor: clamped };
    } catch (error) {
      return { ok: false, error: errorMessage(error, "无法设置界面缩放") };
    }
  });
  ipcMain.handle(SETTINGS_RESET_SAVE_DIR, () => saveDirManager.reset());
  ipcMain.handle(SETTINGS_OPEN_SAVE_DIR, () => saveDirManager.open());
  ipcMain.handle(SETTINGS_CLEAR, async () => { await Promise.all([keytar.deletePassword(SERVICE, ACCOUNT), ...LEGACY_SERVICES.map((service) => keytar.deletePassword(service, ACCOUNT))]); return { ok: true }; });
  ipcMain.handle(SETTINGS_TEST, async () => { const c = await config(); if (!c.baseUrl) return { ok: false, message: "尚未配置 API Base URL" }; if (!c.apiKey) return { ok: false, message: "尚未配置 API 密钥" }; try { new URL(c.baseUrl); const r = await fetch(joinBase(c.baseUrl, "/models"), { headers: { Authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(20_000) }); return r.ok ? { ok: true, message: "连接成功" } : { ok: false, message: `接口返回 ${r.status}` }; } catch (e) { return { ok: false, message: (e as Error).message }; } });
  ipcMain.handle(LOCAL_AI_CAPABILITIES, async () => ({
    ok: true,
    webgpu: !app.commandLine.hasSwitch("disable-gpu"),
    wasm: true,
    maxOutputEdge: 8192,
    maxOutputPixels: 70_000_000,
    modelsDir: localAIModels.modelsDir,
  }));
  ipcMain.handle(LOCAL_AI_MODELS, async () => ({ ok: true, items: await localAIModels.list() }));
  ipcMain.handle(LOCAL_AI_CHOOSE_MODEL_DIR, () => modelDirManager.choose());
  ipcMain.handle(LOCAL_AI_RESET_MODEL_DIR, () => modelDirManager.reset());
  ipcMain.handle(LOCAL_AI_OPEN_MODEL_DIR, () => modelDirManager.open());
  ipcMain.handle(LOCAL_AI_MODEL_URL, async (_event, id: LocalAIModelId) => {
    const status = await localAIModels.status(id);
    return status.installed ? { ok: true, url: `local-ai-model://${id}/${encodeURIComponent(localAIModelById(id)!.fileName)}` } : { ok: false, error: "模型尚未安装" };
  });
  ipcMain.handle(LOCAL_AI_DOWNLOAD_MODEL, async (_event, id: LocalAIModelId) => {
    try { return { ok: true, item: await localAIModels.download(id) }; }
    catch (error) { return { ok: false, error: errorMessage(error, "模型下载失败") }; }
  });
  ipcMain.handle(LOCAL_AI_PAUSE_DOWNLOAD, async (_event, id: LocalAIModelId) => ({ ok: localAIModels.pause(id) }));
  ipcMain.handle(LOCAL_AI_DELETE_MODEL, async (_event, id: LocalAIModelId) => {
    try { await localAIModels.delete(id); return { ok: true }; }
    catch (error) { return { ok: false, error: errorMessage(error, "无法删除模型") }; }
  });
  ipcMain.handle(LOCAL_AI_ARCHIVE_RESULT, async (_event, input: { dataUrl: string; title?: string; recipe: ImageRecipeV1 }) => {
    try {
      const base64 = String(input.dataUrl || "").replace(/^data:image\/\w+;base64,/, "");
      if (!base64) return { ok: false, error: "本地处理结果为空" };
      const recipe = normalizeRecipe({ recipe: input.recipe }, input.recipe.mode);
      const created = await galleryStore.addImages([{ b64_json: base64 }], { title: String(input.title || recipe.variationLabel || "本地 AI 处理结果"), recipe }, true);
      return created[0] ? { ok: true, item: created[0] } : { ok: false, error: "本地处理结果归档失败" };
    } catch (error) { return { ok: false, error: errorMessage(error, "本地处理结果归档失败") }; }
  });
  ipcMain.handle(UPDATES_GET, async () => {
    const channel = await updateChannelPref();
    return { ok: true, appVersion: app.getVersion(), channel, autoUpdate: await autoUpdatePref(), supported: app.isPackaged, status: updateStatus, alphaUnlocked: (await alphaChannelUnlocked()) || channel === "alpha" };
  });
  ipcMain.handle(UPDATES_SET_CHANNEL, async (_e, channel: UpdateChannel) => {
    try {
      const next: UpdateChannel = channel === "beta" ? "beta" : channel === "alpha" ? "alpha" : "stable";
      // Alpha 渠道必须先经隐藏手势解锁，未解锁时拒绝写入。
      if (next === "alpha" && !(await alphaChannelUnlocked())) return { ok: false, error: "Alpha 测试渠道尚未解锁" };
      await keytar.setPassword(SERVICE, `${ACCOUNT}:updateChannel`, next);
      await applyUpdatePreferences();
      if ((await autoUpdatePref()) && app.isPackaged) void checkForAppUpdate();
      return { ok: true, channel: next };
    } catch (error) { return { ok: false, error: errorMessage(error, "无法保存更新通道设置") }; }
  });
  ipcMain.handle(UPDATES_SET_ALPHA_UNLOCKED, async (_e, enabled: boolean) => {
    try {
      await keytar.setPassword(SERVICE, `${ACCOUNT}:alphaChannelUnlocked`, enabled ? "true" : "false");
      let channel = await updateChannelPref();
      // 退出内测时若当前渠道仍是 alpha，回落到 stable 并按偏好立即重查更新。
      if (enabled === false && channel === "alpha") {
        await keytar.setPassword(SERVICE, `${ACCOUNT}:updateChannel`, "stable");
        channel = "stable";
        await applyUpdatePreferences();
        if ((await autoUpdatePref()) && app.isPackaged) void checkForAppUpdate();
      }
      return { ok: true, channel };
    } catch (error) { return { ok: false, error: errorMessage(error, "无法保存内测渠道解锁状态") }; }
  });
  ipcMain.handle(UPDATES_SET_AUTO_UPDATE, async (_e, enabled: boolean) => {
    try {
      await keytar.setPassword(SERVICE, `${ACCOUNT}:autoUpdate`, enabled ? "true" : "false");
      await applyUpdatePreferences();
      if (enabled && app.isPackaged && updateStatus.phase === "available") void downloadAppUpdate();
      return { ok: true, autoUpdate: enabled };
    } catch (error) { return { ok: false, error: errorMessage(error, "无法保存自动更新设置") }; }
  });
  ipcMain.handle(UPDATES_CHECK, async () => checkForAppUpdate());
  ipcMain.handle(UPDATES_DOWNLOAD, async () => downloadAppUpdate());
  ipcMain.handle(UPDATES_INSTALL, async () => {
    if (!app.isPackaged) return { ok: false, message: "开发模式不支持安装更新。" };
    if (updateStatus.phase !== "downloaded") return { ok: false, message: "尚未下载可安装的更新。" };
    autoUpdater.quitAndInstall();
    return { ok: true, message: "正在重启并安装更新。" };
  });
  ipcMain.handle(IMAGE_GENERATE, (e, input: RequestInput) => callImages(BrowserWindow.fromWebContents(e.sender)!, "generations", input));
  ipcMain.handle(IMAGE_EDIT, (e, input: EditInput) => callImages(BrowserWindow.fromWebContents(e.sender)!, "edits", input));
  ipcMain.handle(IMAGE_CANCEL, async (_e, requestId: string) => { cancelledRequests.add(requestId); controllers.get(requestId)?.abort(); });
  ipcMain.handle(IMAGE_SAVE, async (_e, value: { dataUrl: string; suggestedName: string; recipe?: ImageRecipeV1 }) => {
    await fs.mkdir(saveDir, { recursive: true });
    const result = await dialog.showSaveDialog({ defaultPath: path.join(saveDir, value.suggestedName || `image-studio-${Date.now()}.png`), filters: [{ name: "PNG 图片", extensions: ["png"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const base64 = value.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const raw = Buffer.from(base64, "base64");
    const output = value.recipe ? embedRecipeInPng(raw, normalizeRecipe({ recipe: value.recipe }, value.recipe.mode)) : raw;
    // The dialog is filtered to PNG, but Windows still lets users type a different
    // extension. Keep the on-disk suffix truthful because the bytes are PNG.
    const outputPath = path.extname(result.filePath).toLowerCase() === ".png"
      ? result.filePath
      : `${result.filePath}.png`;
    await fs.writeFile(outputPath, output);
    return { canceled: false, path: outputPath };
  });
  ipcMain.handle(PNG_READ_RECIPE, async (_e, value: { dataUrl?: string; data?: number[] }) => {
    try {
      const raw = value.data ? Buffer.from(value.data) : Buffer.from(String(value.dataUrl || "").replace(/^data:image\/\w+;base64,/, ""), "base64");
      const recipe = readRecipeFromPng(raw);
      return recipe ? { ok: true, recipe } : { ok: false, error: "PNG 中没有 ImagoTune 配方元数据" };
    } catch (error) { return { ok: false, error: errorMessage(error, "无法读取 PNG 元数据") }; }
  });
  ipcMain.handle(OUTPAINT_PREPARE, async (_e, input: { sourceWidth: number; sourceHeight: number; targetSize: string }) => {
    const match = /^(\d+)x(\d+)$/.exec(String(input.targetSize || ""));
    if (!match) return { ok: false, error: "目标分辨率格式无效" };
    const width = Number(match[1]); const height = Number(match[2]);
    if (width < Number(input.sourceWidth) || height < Number(input.sourceHeight)) return { ok: false, error: "扩图目标不能小于原图" };
    if (width % CANVAS_MULTIPLE || height % CANVAS_MULTIPLE || width > CANVAS_MAX_EDGE || height > CANVAS_MAX_EDGE || width * height > CANVAS_MAX_PIXELS) return { ok: false, error: "目标尺寸超出安全范围或不是 16 的倍数" };
    return { ok: true, size: `${width}x${height}` };
  });
  ipcMain.handle(GALLERY_LIST, async () => { const result = await galleryStore.search({ pageSize: 100 }); return { ok: true, ...result, projects: await galleryStore.getProjects() }; });
  ipcMain.handle(GALLERY_WORKSPACE, async () => ({ ok: true, ...(await galleryStore.readState()) }));
  ipcMain.handle(GALLERY_SEARCH, async (_e, input: GallerySearch = {}) => ({ ok: true, ...(await galleryStore.search(input)) }));
  ipcMain.handle(GALLERY_THUMBNAIL, async (_e, id: string) => {
    const value = await galleryStore.thumbnail(id); if (!value) return { ok: false, error: "图库记录不存在" }; if (typeof value === "string") return { ok: true, b64: value };
    const image = nativeImage.createFromPath(value.sourcePath); if (image.isEmpty()) return { ok: false, error: "图片文件不存在" }; const thumb = image.resize({ width: 360, quality: "good" }).toJPEG(82); await fs.writeFile(value.thumbPath, thumb); return { ok: true, b64: thumb.toString("base64") };
  });
  ipcMain.handle(GALLERY_LOAD_IMAGE, async (_e, id: string) => { const value = await galleryStore.load(id); return value?.b64 ? { ok: true, b64: value.b64, item: value.item } : { ok: false, error: "图片文件不存在" }; });
  ipcMain.handle(GALLERY_UPDATE, async (_e, id: string, patch: { title?: string; tags?: string[]; projectId?: string }) => {
    const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; if (typeof patch.title === "string") item.title = patch.title.trim().slice(0, 120) || item.title; if (Array.isArray(patch.tags)) item.recipe.tags = tagsValue(patch.tags); if (patch.projectId && state.projects.some(project => project.id === patch.projectId)) item.recipe.projectId = patch.projectId; await galleryStore.writeState(state); return { ok: true, item };
  });
  ipcMain.handle(GALLERY_TOGGLE_FAVORITE, async (_e, id: string) => { const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; item.favorite = !item.favorite; await galleryStore.writeState(state); return { ok: true, item }; });
  ipcMain.handle(GALLERY_DELETE, async (_e, id: string) => { const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; await fs.rm(path.join(galleryDir, path.basename(item.fileName)), { force: true }); await fs.rm(path.join(galleryStore.thumbsDir, `${item.id}.jpg`), { force: true }); state.items = state.items.filter(value => value.id !== id); for (const project of state.projects) if (project.coverId === id) delete project.coverId; await galleryStore.writeState(state); return { ok: true }; });
  ipcMain.handle(PROJECTS_CREATE, async (_e, name: string) => { const state = await galleryStore.readState(); const clean = String(name || "").trim().slice(0, 80); if (!clean) return { ok: false, error: "项目名称不能为空" }; const timestamp = nowISO(); const project: GalleryProject = { id: randomUUID(), name: clean, createdAt: timestamp, updatedAt: timestamp }; state.projects.push(project); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle(PROJECTS_RENAME, async (_e, id: string, name: string) => { const state = await galleryStore.readState(); const project = state.projects.find(value => value.id === id); const clean = String(name || "").trim().slice(0, 80); if (!project || id === INBOX_PROJECT_ID || !clean) return { ok: false, error: "项目不可修改" }; project.name = clean; project.updatedAt = nowISO(); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle(PROJECTS_DELETE, async (_e, id: string) => { if (id === INBOX_PROJECT_ID) return { ok: false, error: "收件箱不能删除" }; const state = await galleryStore.readState(); if (!state.projects.some(value => value.id === id)) return { ok: false, error: "项目不存在" }; state.items = state.items.map(item => item.recipe.projectId === id ? { ...item, recipe: { ...item.recipe, projectId: INBOX_PROJECT_ID } } : item); state.projects = state.projects.filter(value => value.id !== id); await galleryStore.writeState(state); return { ok: true }; });
  ipcMain.handle(PROJECTS_SET_COVER, async (_e, projectId: string, itemId: string) => { const state = await galleryStore.readState(); const project = state.projects.find(value => value.id === projectId); const item = state.items.find(value => value.id === itemId); if (!project || !item || item.recipe.projectId !== projectId) return { ok: false, error: "图片不属于该项目" }; project.coverId = itemId; project.updatedAt = nowISO(); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle(GALLERY_BULK, async (_e, input: { ids: string[]; action: "move" | "favorite" | "delete" | "tags"; projectId?: string; favorite?: boolean; tags?: string[] }) => {
    const ids = new Set((input.ids || []).filter(Boolean)); const state = await galleryStore.readState(); const selected = state.items.filter(item => ids.has(item.id)); if (!selected.length) return { ok: false, error: "未选择图片" };
    if (input.action === "delete") { for (const item of selected) { await fs.rm(path.join(galleryDir, path.basename(item.fileName)), { force: true }); await fs.rm(path.join(galleryStore.thumbsDir, `${item.id}.jpg`), { force: true }); } state.items = state.items.filter(item => !ids.has(item.id)); for (const project of state.projects) if (project.coverId && ids.has(project.coverId)) delete project.coverId; }
    if (input.action === "move" && input.projectId && state.projects.some(project => project.id === input.projectId)) state.items = state.items.map(item => ids.has(item.id) ? { ...item, recipe: { ...item.recipe, projectId: input.projectId! } } : item);
    if (input.action === "favorite") state.items = state.items.map(item => ids.has(item.id) ? { ...item, favorite: Boolean(input.favorite) } : item);
    if (input.action === "tags") { const tags = tagsValue(input.tags || []); state.items = state.items.map(item => ids.has(item.id) ? { ...item, recipe: { ...item.recipe, tags } } : item); }
    await galleryStore.writeState(state); return { ok: true, count: selected.length };
  });
  ipcMain.handle(PROMPT_ENHANCE, async (_e, input: { prompt: string; mode: "generate" | "edit" }) => { const prompt = String(input?.prompt || "").trim(); if (!prompt) return { ok: false, error: "请先输入提示词" }; try { return { ok: true, prompt: await enhancePromptWithModel(prompt, input.mode === "edit" ? "edit" : "generate") }; } catch (error) { return { ok: false, error: errorMessage(error, "提示词增强失败") }; } });
  ipcMain.handle(PROMPT_REVERSE, async (_e, input: { image: BinaryInput }) => { try { return { ok: true, ...(await reversePromptWithModel(input.image)) }; } catch (error) { return { ok: false, error: errorMessage(error, "图反推失败，原提示词未改变") }; } });
  ipcMain.handle(QUEUE_LIST, async () => ({ ok: true, items: await queueSnapshot() }));
  ipcMain.handle(QUEUE_ENQUEUE, async (_e, input: { kind: "generate" | "edit"; payload: Record<string, unknown> }) => { try { const job = await queueStore.enqueue(input.kind, input.payload); broadcast(QUEUE_UPDATE, await queueStore.read()); setImmediate(() => { void processQueue(); }); return { ok: true, job }; } catch (error) { return { ok: false, error: errorMessage(error, "无法创建任务") }; } });
  ipcMain.handle(QUEUE_RETRY, async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || !["failed", "interrupted", "cancelled"].includes(job.status)) return { ok: false, error: "任务不可重试" }; const next = { ...job, status: "queued" as const, error: undefined, errorInfo: undefined, updatedAt: nowISO() }; await queueStore.save(next); broadcast(QUEUE_UPDATE, await queueStore.read()); setImmediate(() => { void processQueue(); }); return { ok: true, job: next }; });
  ipcMain.handle(QUEUE_CANCEL, async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || !["queued", "running"].includes(job.status)) return { ok: false, error: "任务不可取消" }; const errorInfo: GenerationErrorInfo = cancelledErrorInfo(); const next = { ...job, status: "cancelled" as const, error: errorInfoMessage(errorInfo), errorInfo, updatedAt: nowISO() }; await queueStore.save(next); if (job.status === "running") { cancelledRequests.add(job.requestId); controllers.get(job.requestId)?.abort(); } broadcast(QUEUE_UPDATE, await queueStore.read()); return { ok: true, job: next }; });
  ipcMain.handle(QUEUE_REMOVE, async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || job.status === "running") return { ok: false, error: "运行中的任务不可移除" }; await queueStore.remove(id); broadcast(QUEUE_UPDATE, await queueStore.read()); return { ok: true }; });
  ipcMain.handle(CLIPBOARD_COPY_TEXT, async (_e, value: string) => { clipboard.writeText(String(value || "")); return { ok: true }; });
  ipcMain.handle(CLIPBOARD_COPY_IMAGE, async (_e, b64: string) => { const image = nativeImage.createFromBuffer(Buffer.from(String(b64 || "").replace(/^data:image\/\w+;base64,/, ""), "base64")); if (image.isEmpty()) return { ok: false, error: "图片数据无效" }; const png = image.toPNG(); const pngArrayBuffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer; await clipboard.write([new ClipboardItem({ "image/png": new Blob([pngArrayBuffer], { type: "image/png" }) })]); return { ok: true }; });
  ipcMain.handle(CLIPBOARD_READ_IMAGE, async () => {
    const items = await clipboard.read();
    const imageItem = items.find((item) => item.types.some((type) => type === "image/png" || type.startsWith("image/")));
    if (!imageItem) return { ok: false, error: "剪贴板中没有可用图片" };
    const imageType = imageItem.types.find((type) => type === "image/png" || type.startsWith("image/"));
    if (!imageType) return { ok: false, error: "无法读取剪贴板图片" };
    const blob = await imageItem.getType(imageType) as Blob;
    const png = Buffer.from(await blob.arrayBuffer());
    return png.length ? { ok: true, b64: png.toString("base64") } : { ok: false, error: "无法读取剪贴板图片" };
  });
  ipcMain.handle(GALLERY_EXPORT_ZIP, async (_e, ids: string[]) => {
    const state = await galleryStore.readState(); const selected = state.items.filter(item => (ids || []).includes(item.id)); if (!selected.length) return { ok: false, error: "未选择图片" }; await fs.mkdir(saveDir, { recursive: true }); const dialogResult = await dialog.showSaveDialog({ defaultPath: path.join(saveDir, `image-studio-${Date.now()}.zip`), filters: [{ name: "ZIP 文件", extensions: ["zip"] }] }); if (dialogResult.canceled || !dialogResult.filePath) return { ok: true, canceled: true };
    await new Promise<void>((resolve, reject) => { const output = createWriteStream(dialogResult.filePath!); const archive = new archiver.ZipArchive({ zlib: { level: 9 } }); output.on("close", resolve); archive.on("error", reject); archive.pipe(output); for (const item of selected) archive.file(path.join(galleryDir, path.basename(item.fileName)), { name: `${item.title.replace(/[\\/:*?\"<>|]/g, "_") || item.id}.png` }); void archive.finalize(); }); return { ok: true, path: dialogResult.filePath, count: selected.length };
  });
  ipcMain.handle(TEMPLATES_LIST, async () => ({ ok: true, items: [...DEFAULT_TEMPLATES, ...(await readCustomTemplates())] }));
  ipcMain.handle(TEMPLATES_SAVE, async (_e, input: Partial<PromptTemplate>) => { if (!input.title?.trim() || !input.prompt?.trim()) return { ok: false, error: "模板标题和提示词不能为空" }; const items = await readCustomTemplates(); const item: PromptTemplate = { id: input.id && !input.id.startsWith("builtin-") ? input.id : `custom-${randomUUID()}`, title: input.title.trim(), category: input.category?.trim() || "自定义", prompt: input.prompt.trim(), kind: input.kind === "negative" ? "negative" : "positive", ratio: input.ratio, resolution: input.resolution, quality: input.quality }; const next = [...items.filter(value => value.id !== item.id), item]; await fs.mkdir(path.dirname(await templatesFile()), { recursive: true }); await fs.writeFile(await templatesFile(), JSON.stringify(next, null, 2), "utf8"); return { ok: true, item }; });
  ipcMain.handle(TEMPLATES_DELETE, async (_e, id: string) => { if (id.startsWith("builtin-")) return { ok: false, error: "内置模板不能删除" }; const items = await readCustomTemplates(); await fs.writeFile(await templatesFile(), JSON.stringify(items.filter(item => item.id !== id), null, 2), "utf8"); return { ok: true }; });
  configureAutoUpdater();
  await applyUpdatePreferences();
  createWindow();
  if (app.isPackaged && await autoUpdatePref()) setTimeout(() => { void checkForAppUpdate(); }, 5_000);
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
