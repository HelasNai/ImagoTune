import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import keytar from "keytar";
import archiver from "archiver";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { createGalleryStore, GalleryProject, GallerySearch, INBOX_PROJECT_ID } from "./gallery-store";
import { createQueueStore, QueueJob, QueueStore } from "./queue-store";
import { composeImagePrompt, ImageRecipeV1, normalizeRecipe } from "./image-recipe";
import { classifyHttpError, classifyRuntimeError, errorInfoMessage, GenerationError, GenerationErrorInfo } from "./generation-error";
import { embedRecipeInPng, readRecipeFromPng } from "./png-metadata";
import { isVisionInputUnsupported, parseReversePrompt } from "./reverse-prompt";

const SERVICE = "pinaic-image-studio";
const ACCOUNT = "default";
const DEFAULT_BASE_URL = "https://api.pinaic.com/v1";
const DEFAULT_SAVE_DIR = "D:\\codexproject\\生图\\保存图片";
const controllers = new Map<string, AbortController>();
const cancelledRequests = new Set<string>();
const timedOutRequests = new Set<string>();
type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
type UpdateStatus = { phase: UpdatePhase; version?: string; progress?: number; message: string };
let updateStatus: UpdateStatus = { phase: "idle", message: "尚未检查更新" };
let updateCheckInFlight = false;
let updatePromptOpen = false;

type BinaryInput = { name: string; type: string; data: number[] };
type RequestInput = Record<string, unknown> & { requestId: string; recipe?: ImageRecipeV1; title?: string };
type EditInput = RequestInput & { image: BinaryInput; mask?: BinaryInput };
type PromptTemplate = { id: string; title: string; category: string; prompt: string; kind: "positive" | "negative"; ratio?: string; resolution?: string; quality?: string; builtin?: boolean };
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
const galleryDir = path.join(DEFAULT_SAVE_DIR, "图库");
const galleryStore = createGalleryStore(galleryDir);
let queueStore: QueueStore;
let activeQueueJobId: string | null = null;

async function archiveImages(images: ApiImage[], input: RequestInput | EditInput, enabled: boolean) {
  const recipe = normalizeRecipe(input, "image" in input ? "edit" : "generate");
  return galleryStore.addImages(images, { title: String(input.title || recipe.prompt.slice(0, 48)), recipe }, enabled);
}
async function templatesFile() { return path.join(app.getPath("userData"), "pinaic-image-templates.json"); }
async function readCustomTemplates(): Promise<PromptTemplate[]> {
  try {
    const raw = await fs.readFile(await templatesFile(), "utf8");
    const value = JSON.parse(raw) as Array<Partial<PromptTemplate>>;
    return Array.isArray(value) ? value.map((item) => ({ ...item, kind: item.kind === "negative" ? "negative" : "positive" })) as PromptTemplate[] : [];
  } catch { return []; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 980, minHeight: 680,
    backgroundColor: "#f7f8fc",
    icon: path.join(__dirname, "../PinAI Image Studio.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  if (process.argv.includes("--dev")) win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
}

async function config() {
  const archiveSetting = await keytar.getPassword(SERVICE, `${ACCOUNT}:autoArchive`);
  return { apiKey: await keytar.getPassword(SERVICE, ACCOUNT), baseUrl: (await keytar.getPassword(SERVICE, `${ACCOUNT}:baseUrl`)) || DEFAULT_BASE_URL, autoArchive: archiveSetting !== "false" };
}

async function checkUpdatesAtStartup() {
  return (await keytar.getPassword(SERVICE, ACCOUNT + ":checkUpdatesAtStartup")) !== "false";
}

function publishUpdateStatus(next: UpdateStatus) {
  updateStatus = next;
  broadcast("update:status", updateStatus);
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
    const message = (error as Error).message || "更新下载失败";
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
      message: "PinAI Image Studio " + info.version + " 已可更新",
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
    const message = (error as Error).message || "检查更新失败";
    publishUpdateStatus({ phase: "error", message });
    return { ok: false, message };
  } finally {
    updateCheckInFlight = false;
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => publishUpdateStatus({ phase: "checking", message: "正在检查更新…" }));
  autoUpdater.on("update-available", (info) => {
    publishUpdateStatus({ phase: "available", version: info.version, message: "发现新版本 v" + info.version });
    void promptForDownload(info);
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
      message: "PinAI Image Studio " + info.version + " 已准备好",
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
  win.webContents.send("image:progress", { requestId, status, progress, message });
}

function formatHttpError(status: number, body: string) {
  return new GenerationError(classifyHttpError(status, body));
}

async function parseResponse(response: Response, win: BrowserWindow, requestId: string): Promise<ApiImage[]> {
  const type = response.headers.get("content-type") || "";
  if (!response.body) throw new Error("接口没有返回内容");
  if (!type.includes("text/event-stream")) {
    const json = await response.json() as { data?: ApiImage[]; seed?: string | number };
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
      const payload = JSON.parse(value) as { data?: ApiImage[]; images?: ApiImage[]; progress?: number; status?: string; message?: string; b64_json?: string; seed?: string | number };
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

async function callImages(win: BrowserWindow, endpoint: "generations" | "edits", input: RequestInput | EditInput) {
  const { apiKey, baseUrl } = await config();
  if (!apiKey) throw new GenerationError({ category: "authentication", title: "尚未配置 API 密钥", message: "客户端没有可用于请求 PinAI 的密钥。", suggestion: "请先在设置中保存有效的 PinAI API 密钥。", retryable: false });
  const recipe = normalizeRecipe(input, endpoint === "edits" ? "edit" : "generate");
  const effectivePrompt = composeImagePrompt(recipe);
  const controller = new AbortController(); controllers.set(input.requestId, controller);
  const timer = setTimeout(() => { timedOutRequests.add(input.requestId); controller.abort(); }, 300_000);
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
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    } else {
      const edit = input as EditInput;
      const form = new FormData();
      form.append("model", recipe.model); form.append("prompt", effectivePrompt); form.append("size", recipe.size); form.append("n", String(recipe.n)); form.append("response_format", "b64_json"); form.append("stream", "true");
      if (recipe.quality && recipe.quality !== "auto") form.append("quality", recipe.quality);
      form.append("image", new Blob([Buffer.from(edit.image.data)], { type: edit.image.type || "application/octet-stream" }), edit.image.name);
      if (edit.mask) form.append("mask", new Blob([Buffer.from(edit.mask.data)], { type: edit.mask.type || "application/octet-stream" }), edit.mask.name);
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal });
    }
    if (!response.ok) { const text = await response.text(); throw formatHttpError(response.status, text); }
    emit(win, input.requestId, "正在接收图片", 92, "图片服务已响应，正在读取结果");
    const parsedImages = await parseResponse(response, win, input.requestId);
    const seen = new Set<string>();
    const images = parsedImages.filter(image => {
      const key = image.b64_json || image.url;
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, recipe.n);
    if (!images.length) throw new Error("接口未返回图片数据");
    emit(win, input.requestId, "完成", 100, `生成完成，用时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`);
    const settings = await config();
    const normalizedInput = { ...input, recipe } as RequestInput | EditInput;
    const gallery = await archiveImages(images, normalizedInput, settings.autoArchive);
    return { ok: true, images, gallery, recipe, requestId: input.requestId, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new GenerationError(classifyRuntimeError(error, {
        cancelled: cancelledRequests.has(input.requestId),
        timedOut: timedOutRequests.has(input.requestId),
      }));
    }
    const message = (error as Error).message || "生成失败";
    if (/quality/i.test(message) && /(unsupported|unknown|invalid|不支持)/i.test(message)) {
      throw new GenerationError({ category: "parameters", title: "清晰度参数不兼容", message: "PinAI 不支持当前清晰度参数。", suggestion: "切换为“自动”后手动重试。", retryable: false, details: message });
    }
    throw new GenerationError(classifyRuntimeError(error));
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    controllers.delete(input.requestId);
    cancelledRequests.delete(input.requestId);
    timedOutRequests.delete(input.requestId);
  }
}

async function enhancePromptWithModel(prompt: string, mode: "generate" | "edit") {
  const { apiKey, baseUrl } = await config(); if (!apiKey) throw new Error("请先保存 API 密钥");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o", temperature: 0.7, max_tokens: 1200, messages: [{ role: "system", content: "你是图片提示词优化助手。保留用户意图，不增加不相关主体；输出一段可以直接用于图片生成的中文提示词，不要解释，不要加引号。" }, { role: "user", content: `模式：${mode === "edit" ? "图片编辑，保持主体不变" : "文生图"}\n原始提示词：${prompt}` }] }), signal: controller.signal });
    if (!response.ok) throw new Error(`提示词增强接口返回 ${response.status}`); const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }; const content = json.choices?.[0]?.message?.content?.trim(); if (!content) throw new Error("提示词增强没有返回内容"); return content;
  } catch (error) { if ((error as Error).name === "AbortError") throw new Error("提示词增强超时，请保留原提示词重试"); throw error; } finally { clearTimeout(timer); }
}

async function reversePromptWithModel(image: BinaryInput) {
  const { apiKey, baseUrl } = await config();
  if (!apiKey) throw new Error("请先保存 API 密钥");
  if (!image.data?.length) throw new Error("请选择需要分析的图片");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const mime = image.type === "image/png" ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${Buffer.from(image.data).toString("base64")}`;
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
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
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      if (isVisionInputUnsupported(body)) {
        throw new Error("当前 PinAI gpt-4o 通道不支持图片输入，原提示词未改变。");
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
  } finally { clearTimeout(timer); }
}
function broadcast(channel: string, value: unknown) { for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, value); }
async function queueSnapshot() { return queueStore ? queueStore.read() : []; }
async function processQueue() {
  if (!queueStore || activeQueueJobId) return; const items = await queueStore.read(); const job = items.find(item => item.status === "queued"); if (!job) { broadcast("queue:update", items); return; }
  const win = BrowserWindow.getAllWindows()[0]; if (!win) return; activeQueueJobId = job.id; const running = { ...job, status: "running" as const, attempts: job.attempts + 1, updatedAt: new Date().toISOString(), error: undefined, errorInfo: undefined }; await queueStore.save(running); broadcast("queue:update", await queueStore.read());
  try { const raw = await queueStore.materialize(running); const result = await callImages(win, running.kind === "edit" ? "edits" : "generations", raw as RequestInput & Partial<EditInput>); const completed = { ...running, status: "completed" as const, elapsedMs: result.elapsedMs, resultGalleryIds: (result.gallery || []).map(item => item.id), updatedAt: new Date().toISOString() }; await queueStore.save(completed); broadcast("queue:result", { job: completed, result }); }
  catch (error) { const current = (await queueStore.read()).find(item => item.id === running.id); if (current?.status === "cancelled") broadcast("queue:error", current); else { const errorInfo = classifyRuntimeError(error); const failed = { ...running, status: "failed" as const, error: errorInfoMessage(errorInfo), errorInfo, updatedAt: new Date().toISOString() }; await queueStore.save(failed); broadcast("queue:error", failed); } }
  finally { const current = (await queueStore.read()).find(item => item.id === running.id); if (current?.status === "completed") await queueStore.removeAssets(running); activeQueueJobId = null; broadcast("queue:update", await queueStore.read()); void processQueue(); }
}
app.whenReady().then(async () => {
  queueStore = createQueueStore(app.getPath("userData")); await queueStore.recover();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "文件", submenu: [{ label: "关闭窗口", role: "close" }] },
    { label: "编辑", submenu: [
      { label: "撤销", role: "undo" }, { label: "重做", role: "redo" }, { type: "separator" },
      { label: "剪切", role: "cut" }, { label: "复制", role: "copy" }, { label: "粘贴", role: "paste" }, { label: "全选", role: "selectAll" }
    ] },
    { label: "查看", submenu: [
      { label: "重新加载", role: "reload" }, { label: "强制重新加载", role: "forceReload" },
      { label: "开发者工具", role: "toggleDevTools" }, { type: "separator" },
      { label: "实际大小", role: "resetZoom" }, { label: "放大", role: "zoomIn" }, { label: "缩小", role: "zoomOut" },
      { type: "separator" }, { label: "全屏", role: "togglefullscreen" }
    ] },
    { label: "窗口", submenu: [{ label: "最小化", role: "minimize" }, { label: "关闭", role: "close" }] },
    { label: "帮助", submenu: [{ label: "PinAI Image Studio 使用说明", click: () => dialog.showMessageBox({ type: "info", title: "PinAI Image Studio", message: "本地 PinAI 图片生成工具\n支持文生图、图片编辑、比例与 1K/2K/4K 清晰度选择。" }) }] }
  ]));
  ipcMain.handle("settings:get", async () => { const c = await config(); return { configured: Boolean(c.apiKey), baseUrl: c.baseUrl, autoArchive: c.autoArchive }; });
  ipcMain.handle("settings:save", async (_e, value: { apiKey: string; baseUrl: string; autoArchive?: boolean }) => { if (value.apiKey.trim()) await keytar.setPassword(SERVICE, ACCOUNT, value.apiKey.trim()); await keytar.setPassword(SERVICE, `${ACCOUNT}:baseUrl`, value.baseUrl.trim() || DEFAULT_BASE_URL); await keytar.setPassword(SERVICE, `${ACCOUNT}:autoArchive`, value.autoArchive === false ? "false" : "true"); return { ok: true }; });
  ipcMain.handle("settings:clear", async () => { await keytar.deletePassword(SERVICE, ACCOUNT); return { ok: true }; });
  ipcMain.handle("settings:test", async () => { const c = await config(); if (!c.apiKey) return { ok: false, message: "尚未配置 API 密钥" }; try { const r = await fetch(`${c.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(20_000) }); return r.ok ? { ok: true, message: "连接成功" } : { ok: false, message: `接口返回 ${r.status}` }; } catch (e) { return { ok: false, message: (e as Error).message }; } });
  ipcMain.handle("updates:get", async () => ({ ok: true, appVersion: app.getVersion(), checkAtStartup: await checkUpdatesAtStartup(), supported: app.isPackaged, status: updateStatus }));
  ipcMain.handle("updates:setStartup", async (_e, enabled: boolean) => { await keytar.setPassword(SERVICE, ACCOUNT + ":checkUpdatesAtStartup", enabled ? "true" : "false"); return { ok: true, checkAtStartup: enabled }; });
  ipcMain.handle("updates:check", async () => checkForAppUpdate());
  ipcMain.handle("updates:download", async () => downloadAppUpdate());
  ipcMain.handle("updates:install", async () => {
    if (!app.isPackaged) return { ok: false, message: "开发模式不支持安装更新。" };
    if (updateStatus.phase !== "downloaded") return { ok: false, message: "尚未下载可安装的更新。" };
    autoUpdater.quitAndInstall();
    return { ok: true, message: "正在重启并安装更新。" };
  });
  ipcMain.handle("image:generate", (e, input: RequestInput) => callImages(BrowserWindow.fromWebContents(e.sender)!, "generations", input));
  ipcMain.handle("image:edit", (e, input: EditInput) => callImages(BrowserWindow.fromWebContents(e.sender)!, "edits", input));
  ipcMain.handle("image:cancel", async (_e, requestId: string) => { cancelledRequests.add(requestId); controllers.get(requestId)?.abort(); });
  ipcMain.handle("image:save", async (_e, value: { dataUrl: string; suggestedName: string; recipe?: ImageRecipeV1 }) => {
    await fs.mkdir(DEFAULT_SAVE_DIR, { recursive: true });
    const result = await dialog.showSaveDialog({ defaultPath: path.join(DEFAULT_SAVE_DIR, value.suggestedName || `pinaic-${Date.now()}.png`), filters: [{ name: "PNG 图片", extensions: ["png"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const base64 = value.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const raw = Buffer.from(base64, "base64");
    const output = value.recipe ? embedRecipeInPng(raw, normalizeRecipe({ recipe: value.recipe }, value.recipe.mode)) : raw;
    await fs.writeFile(result.filePath, output);
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle("png:readRecipe", async (_e, value: { dataUrl?: string; data?: number[] }) => {
    try {
      const raw = value.data ? Buffer.from(value.data) : Buffer.from(String(value.dataUrl || "").replace(/^data:image\/\w+;base64,/, ""), "base64");
      const recipe = readRecipeFromPng(raw);
      return recipe ? { ok: true, recipe } : { ok: false, error: "PNG 中没有 PinAI 配方元数据" };
    } catch (error) { return { ok: false, error: (error as Error).message || "无法读取 PNG 元数据" }; }
  });
  ipcMain.handle("outpaint:prepare", async (_e, input: { sourceWidth: number; sourceHeight: number; targetSize: string }) => {
    const match = /^(\d+)x(\d+)$/.exec(String(input.targetSize || ""));
    if (!match) return { ok: false, error: "目标分辨率格式无效" };
    const width = Number(match[1]); const height = Number(match[2]);
    if (width < Number(input.sourceWidth) || height < Number(input.sourceHeight)) return { ok: false, error: "扩图目标不能小于原图" };
    if (width % 16 || height % 16 || width > 3840 || height > 3840 || width * height > 8_294_400) return { ok: false, error: "目标尺寸超出安全范围或不是 16 的倍数" };
    return { ok: true, size: `${width}x${height}` };
  });
  ipcMain.handle("gallery:list", async () => { const result = await galleryStore.search({ pageSize: 100 }); return { ok: true, ...result, projects: await galleryStore.getProjects() }; });
  ipcMain.handle("gallery:workspace", async () => ({ ok: true, ...(await galleryStore.readState()) }));
  ipcMain.handle("gallery:search", async (_e, input: GallerySearch = {}) => ({ ok: true, ...(await galleryStore.search(input)) }));
  ipcMain.handle("gallery:thumbnail", async (_e, id: string) => {
    const value = await galleryStore.thumbnail(id); if (!value) return { ok: false, error: "图库记录不存在" }; if (typeof value === "string") return { ok: true, b64: value };
    const image = nativeImage.createFromPath(value.sourcePath); if (image.isEmpty()) return { ok: false, error: "图片文件不存在" }; const thumb = image.resize({ width: 360, quality: "good" }).toJPEG(82); await fs.writeFile(value.thumbPath, thumb); return { ok: true, b64: thumb.toString("base64") };
  });
  ipcMain.handle("gallery:loadImage", async (_e, id: string) => { const value = await galleryStore.load(id); return value?.b64 ? { ok: true, b64: value.b64, item: value.item } : { ok: false, error: "图片文件不存在" }; });
  ipcMain.handle("gallery:update", async (_e, id: string, patch: { title?: string; tags?: string[]; projectId?: string }) => {
    const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; if (typeof patch.title === "string") item.title = patch.title.trim().slice(0, 120) || item.title; if (Array.isArray(patch.tags)) item.recipe.tags = [...new Set(patch.tags.map(value => String(value).trim()).filter(Boolean))].slice(0, 20); if (patch.projectId && state.projects.some(project => project.id === patch.projectId)) item.recipe.projectId = patch.projectId; await galleryStore.writeState(state); return { ok: true, item };
  });
  ipcMain.handle("gallery:toggleFavorite", async (_e, id: string) => { const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; item.favorite = !item.favorite; await galleryStore.writeState(state); return { ok: true, item }; });
  ipcMain.handle("gallery:delete", async (_e, id: string) => { const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; await fs.rm(path.join(galleryDir, path.basename(item.fileName)), { force: true }); await fs.rm(path.join(galleryStore.thumbsDir, `${item.id}.jpg`), { force: true }); state.items = state.items.filter(value => value.id !== id); for (const project of state.projects) if (project.coverId === id) delete project.coverId; await galleryStore.writeState(state); return { ok: true }; });
  ipcMain.handle("projects:create", async (_e, name: string) => { const state = await galleryStore.readState(); const clean = String(name || "").trim().slice(0, 80); if (!clean) return { ok: false, error: "项目名称不能为空" }; const timestamp = new Date().toISOString(); const project: GalleryProject = { id: randomUUID(), name: clean, createdAt: timestamp, updatedAt: timestamp }; state.projects.push(project); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle("projects:rename", async (_e, id: string, name: string) => { const state = await galleryStore.readState(); const project = state.projects.find(value => value.id === id); const clean = String(name || "").trim().slice(0, 80); if (!project || id === INBOX_PROJECT_ID || !clean) return { ok: false, error: "项目不可修改" }; project.name = clean; project.updatedAt = new Date().toISOString(); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle("projects:delete", async (_e, id: string) => { if (id === INBOX_PROJECT_ID) return { ok: false, error: "收件箱不能删除" }; const state = await galleryStore.readState(); if (!state.projects.some(value => value.id === id)) return { ok: false, error: "项目不存在" }; state.items = state.items.map(item => item.recipe.projectId === id ? { ...item, recipe: { ...item.recipe, projectId: INBOX_PROJECT_ID } } : item); state.projects = state.projects.filter(value => value.id !== id); await galleryStore.writeState(state); return { ok: true }; });
  ipcMain.handle("projects:setCover", async (_e, projectId: string, itemId: string) => { const state = await galleryStore.readState(); const project = state.projects.find(value => value.id === projectId); const item = state.items.find(value => value.id === itemId); if (!project || !item || item.recipe.projectId !== projectId) return { ok: false, error: "图片不属于该项目" }; project.coverId = itemId; project.updatedAt = new Date().toISOString(); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle("gallery:bulk", async (_e, input: { ids: string[]; action: "move" | "favorite" | "delete" | "tags"; projectId?: string; favorite?: boolean; tags?: string[] }) => {
    const ids = new Set((input.ids || []).filter(Boolean)); const state = await galleryStore.readState(); const selected = state.items.filter(item => ids.has(item.id)); if (!selected.length) return { ok: false, error: "未选择图片" };
    if (input.action === "delete") { for (const item of selected) { await fs.rm(path.join(galleryDir, path.basename(item.fileName)), { force: true }); await fs.rm(path.join(galleryStore.thumbsDir, `${item.id}.jpg`), { force: true }); } state.items = state.items.filter(item => !ids.has(item.id)); for (const project of state.projects) if (project.coverId && ids.has(project.coverId)) delete project.coverId; }
    if (input.action === "move" && input.projectId && state.projects.some(project => project.id === input.projectId)) state.items = state.items.map(item => ids.has(item.id) ? { ...item, recipe: { ...item.recipe, projectId: input.projectId! } } : item);
    if (input.action === "favorite") state.items = state.items.map(item => ids.has(item.id) ? { ...item, favorite: Boolean(input.favorite) } : item);
    if (input.action === "tags") { const tags = [...new Set((input.tags || []).map(value => String(value).trim()).filter(Boolean))].slice(0, 20); state.items = state.items.map(item => ids.has(item.id) ? { ...item, recipe: { ...item.recipe, tags } } : item); }
    await galleryStore.writeState(state); return { ok: true, count: selected.length };
  });
  ipcMain.handle("prompt:enhance", async (_e, input: { prompt: string; mode: "generate" | "edit" }) => { const prompt = String(input?.prompt || "").trim(); if (!prompt) return { ok: false, error: "请先输入提示词" }; try { return { ok: true, prompt: await enhancePromptWithModel(prompt, input.mode === "edit" ? "edit" : "generate") }; } catch (error) { return { ok: false, error: (error as Error).message || "提示词增强失败" }; } });
  ipcMain.handle("prompt:reverse", async (_e, input: { image: BinaryInput }) => { try { return { ok: true, ...(await reversePromptWithModel(input.image)) }; } catch (error) { return { ok: false, error: (error as Error).message || "图反推失败，原提示词未改变" }; } });
  ipcMain.handle("queue:list", async () => ({ ok: true, items: await queueSnapshot() }));
  ipcMain.handle("queue:enqueue", async (_e, input: { kind: "generate" | "edit"; payload: Record<string, unknown> }) => { const job = await queueStore.enqueue(input.kind, input.payload); broadcast("queue:update", await queueStore.read()); void processQueue(); return { ok: true, job }; });
  ipcMain.handle("queue:retry", async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || !["failed", "interrupted", "cancelled"].includes(job.status)) return { ok: false, error: "任务不可重试" }; const next = { ...job, status: "queued" as const, error: undefined, errorInfo: undefined, updatedAt: new Date().toISOString() }; await queueStore.save(next); broadcast("queue:update", await queueStore.read()); void processQueue(); return { ok: true, job: next }; });
  ipcMain.handle("queue:cancel", async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || !["queued", "running"].includes(job.status)) return { ok: false, error: "任务不可取消" }; const errorInfo: GenerationErrorInfo = { category: "cancelled", title: "任务已取消", message: "请求已由用户取消。", suggestion: "修改参数后可重新加入队列。", retryable: false }; const next = { ...job, status: "cancelled" as const, error: errorInfoMessage(errorInfo), errorInfo, updatedAt: new Date().toISOString() }; await queueStore.save(next); if (job.status === "running") { cancelledRequests.add(job.requestId); controllers.get(job.requestId)?.abort(); } broadcast("queue:update", await queueStore.read()); return { ok: true, job: next }; });
  ipcMain.handle("queue:remove", async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || job.status === "running") return { ok: false, error: "运行中的任务不可移除" }; await queueStore.remove(id); broadcast("queue:update", await queueStore.read()); return { ok: true }; });
  ipcMain.handle("clipboard:copyText", async (_e, value: string) => { clipboard.writeText(String(value || "")); return { ok: true }; });
  ipcMain.handle("clipboard:copyImage", async (_e, b64: string) => { const image = nativeImage.createFromBuffer(Buffer.from(String(b64 || "").replace(/^data:image\/\w+;base64,/, ""), "base64")); if (image.isEmpty()) return { ok: false, error: "图片数据无效" }; clipboard.writeImage(image); return { ok: true }; });
  ipcMain.handle("gallery:exportZip", async (_e, ids: string[]) => {
    const state = await galleryStore.readState(); const selected = state.items.filter(item => (ids || []).includes(item.id)); if (!selected.length) return { ok: false, error: "未选择图片" }; await fs.mkdir(DEFAULT_SAVE_DIR, { recursive: true }); const dialogResult = await dialog.showSaveDialog({ defaultPath: path.join(DEFAULT_SAVE_DIR, `pinaic-images-${Date.now()}.zip`), filters: [{ name: "ZIP 文件", extensions: ["zip"] }] }); if (dialogResult.canceled || !dialogResult.filePath) return { ok: true, canceled: true };
    await new Promise<void>((resolve, reject) => { const output = createWriteStream(dialogResult.filePath!); const archive = archiver("zip", { zlib: { level: 9 } }); output.on("close", resolve); archive.on("error", reject); archive.pipe(output); for (const item of selected) archive.file(path.join(galleryDir, path.basename(item.fileName)), { name: `${item.title.replace(/[\\/:*?\"<>|]/g, "_") || item.id}.png` }); void archive.finalize(); }); return { ok: true, path: dialogResult.filePath, count: selected.length };
  });
  ipcMain.handle("templates:list", async () => ({ ok: true, items: [...DEFAULT_TEMPLATES, ...(await readCustomTemplates())] }));
  ipcMain.handle("templates:save", async (_e, input: Partial<PromptTemplate>) => { if (!input.title?.trim() || !input.prompt?.trim()) return { ok: false, error: "模板标题和提示词不能为空" }; const items = await readCustomTemplates(); const item: PromptTemplate = { id: input.id && !input.id.startsWith("builtin-") ? input.id : `custom-${randomUUID()}`, title: input.title.trim(), category: input.category?.trim() || "自定义", prompt: input.prompt.trim(), kind: input.kind === "negative" ? "negative" : "positive", ratio: input.ratio, resolution: input.resolution, quality: input.quality }; const next = [...items.filter(value => value.id !== item.id), item]; await fs.mkdir(path.dirname(await templatesFile()), { recursive: true }); await fs.writeFile(await templatesFile(), JSON.stringify(next, null, 2), "utf8"); return { ok: true, item }; });
  ipcMain.handle("templates:delete", async (_e, id: string) => { if (id.startsWith("builtin-")) return { ok: false, error: "内置模板不能删除" }; const items = await readCustomTemplates(); await fs.writeFile(await templatesFile(), JSON.stringify(items.filter(item => item.id !== id), null, 2), "utf8"); return { ok: true }; });
  configureAutoUpdater();
  createWindow();
  if (app.isPackaged && await checkUpdatesAtStartup()) setTimeout(() => { void checkForAppUpdate(); }, 5_000);
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

type ApiImage = { b64_json?: string; url?: string; seed?: string | number };
