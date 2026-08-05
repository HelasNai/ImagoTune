import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import keytar from "keytar";
import archiver from "archiver";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { createGalleryStore, GalleryItem, GalleryProject, GallerySearch, GalleryState, INBOX_PROJECT_ID } from "./gallery-store";
import { createQueueStore, QueueJob, QueueStore } from "./queue-store";

const SERVICE = "pinaic-image-studio";
const ACCOUNT = "default";
const DEFAULT_BASE_URL = "https://api.pinaic.com/v1";
const DEFAULT_SAVE_DIR = "D:\\codexproject\\生图\\保存图片";
const controllers = new Map<string, AbortController>();
type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
type UpdateStatus = { phase: UpdatePhase; version?: string; progress?: number; message: string };
let updateStatus: UpdateStatus = { phase: "idle", message: "尚未检查更新" };
let updateCheckInFlight = false;
let updatePromptOpen = false;

type RequestInput = { requestId: string; prompt: string; userPrompt?: string; model: string; size: string; n: number; quality?: string; ratio?: string; resolution?: string; projectId?: string; title?: string; tags?: string[]; sourceId?: string; variationLabel?: string };
type EditInput = RequestInput & { image: { name: string; type: string; data: number[] }; mask?: { name: string; type: string; data: number[] } };
type PromptTemplate = { id: string; title: string; category: string; prompt: string; ratio?: string; resolution?: string; quality?: string; builtin?: boolean };
const DEFAULT_TEMPLATES: PromptTemplate[] = [
  { id: "builtin-poster", title: "科技产品海报", category: "海报", prompt: "一张高级科技感产品海报，主体清晰突出，蓝紫与粉色渐变光效，留出标题和副标题空间，商业广告级构图", ratio: "4:5", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-cover", title: "内容平台封面", category: "封面", prompt: "一张适合内容平台封面的视觉主图，主题明确，主体醒目，画面干净，保留适合叠加标题的留白区域", ratio: "16:9", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-product", title: "产品展示图", category: "产品", prompt: "专业产品摄影，主体居中，干净高级的棚拍光线，细腻材质，简洁背景，无品牌文字和水印", ratio: "1:1", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-social", title: "社交媒体配图", category: "社交媒体", prompt: "一张适合社交媒体发布的吸睛视觉，主体明确，色彩明快，构图平衡，细节丰富但画面不拥挤", ratio: "9:16", resolution: "1k", quality: "medium", builtin: true }
];
const galleryDir = path.join(DEFAULT_SAVE_DIR, "图库");
const galleryStore = createGalleryStore(galleryDir);
let queueStore: QueueStore;
let activeQueueJobId: string | null = null;

async function archiveImages(images: ApiImage[], input: RequestInput | EditInput, enabled: boolean) {
  const userPrompt = input.userPrompt || input.prompt;
  return galleryStore.addImages(images, { title: input.title || userPrompt.slice(0, 48), prompt: userPrompt, model: input.model, size: input.size, quality: input.quality, ratio: input.ratio, resolution: input.resolution, mode: "image" in input ? "edit" : "generate", projectId: input.projectId || INBOX_PROJECT_ID, tags: input.tags || [], sourceId: input.sourceId, variationLabel: input.variationLabel }, enabled);
}
async function templatesFile() { return path.join(app.getPath("userData"), "pinaic-image-templates.json"); }
async function readCustomTemplates(): Promise<PromptTemplate[]> { try { const raw = await fs.readFile(await templatesFile(), "utf8"); const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; } }

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
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 500);
  const hints: Record<number, string> = {
    400: "参数不被接口接受。建议使用 1K、自动细节质量、单张生成，或调整尺寸与比例。",
    401: "API 密钥无效或已失效，请在设置中重新保存。",
    402: "账户余额、订阅或卡密权益可能不足。",
    403: "当前密钥没有调用图片模型的权限。",
    408: "接口等待超时，可稍后手动再次提交。",
    413: "上传图片或请求内容过大，请压缩原图后重试。",
    422: "图片尺寸、质量或编辑参数不兼容，请先切换到 1K 和自动细节质量。",
    429: "服务繁忙或已达到并发限制，请等待片刻后手动再次提交。",
    500: "图片服务暂时异常，请稍后手动再次提交。",
    502: "图片服务网关暂时异常，请稍后手动再次提交。",
    503: "图片服务正在繁忙或维护，请稍后手动再次提交。",
    504: "图片服务响应超时，请稍后手动再次提交。"
  };
  const retryable = status === 408 || status === 429 || status >= 500;
  return new Error(`${retryable ? "[可重试] " : ""}PinAI ${status}：${hints[status] || "请求失败，请检查参数和网络。"}${detail ? `\n接口详情：${detail}` : ""}`);
}

async function parseResponse(response: Response, win: BrowserWindow, requestId: string): Promise<ApiImage[]> {
  const type = response.headers.get("content-type") || "";
  if (!response.body) throw new Error("接口没有返回内容");
  if (!type.includes("text/event-stream")) {
    const json = await response.json() as { data?: ApiImage[] };
    return json.data || [];
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
      const payload = JSON.parse(value) as { data?: ApiImage[]; images?: ApiImage[]; progress?: number; status?: string; message?: string; b64_json?: string };
      if (payload.data) images.push(...payload.data);
      if (payload.images) images.push(...payload.images);
      if (payload.b64_json) images.push({ b64_json: payload.b64_json });
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
  if (!apiKey) throw new Error("请先在设置中保存 PinAI API 密钥");
  const controller = new AbortController(); controllers.set(input.requestId, controller);
  const timer = setTimeout(() => controller.abort(), 300_000);
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
      const body: Record<string, unknown> = { model: input.model, prompt: input.prompt, size: input.size, n: input.n, response_format: "b64_json", stream: true };
      if (input.quality && input.quality !== "auto") body.quality = input.quality;
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    } else {
      const edit = input as EditInput;
      const form = new FormData();
      form.append("model", edit.model); form.append("prompt", edit.prompt); form.append("size", edit.size); form.append("n", String(edit.n)); form.append("response_format", "b64_json"); form.append("stream", "true");
      if (edit.quality && edit.quality !== "auto") form.append("quality", edit.quality);
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
    }).slice(0, input.n);
    if (!images.length) throw new Error("接口未返回图片数据");
    emit(win, input.requestId, "完成", 100, `生成完成，用时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`);
    const settings = await config();
    const gallery = await archiveImages(images, input, settings.autoArchive);
    return { ok: true, images, gallery, requestId: input.requestId, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("[可重试] 请求已取消或超过 300 秒超时。请降低到 1K、单张后手动再次提交。");
    const message = (error as Error).message || "生成失败";
    if (/quality/i.test(message) && /(unsupported|unknown|invalid|不支持)/i.test(message)) throw new Error(`PinAI 不支持当前清晰度参数，请切换为“自动”后重试。\n${message}`);
    throw error;
  } finally { clearTimeout(timer); clearInterval(heartbeat); controllers.delete(input.requestId); }
}

async function enhancePromptWithModel(prompt: string, mode: "generate" | "edit") {
  const { apiKey, baseUrl } = await config(); if (!apiKey) throw new Error("请先保存 API 密钥");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o", temperature: 0.7, max_tokens: 1200, messages: [{ role: "system", content: "你是图片提示词优化助手。保留用户意图，不增加不相关主体；输出一段可以直接用于图片生成的中文提示词，不要解释，不要加引号。" }, { role: "user", content: `模式：${mode === "edit" ? "图片编辑，保持主体不变" : "文生图"}\n原始提示词：${prompt}` }] }), signal: controller.signal });
    if (!response.ok) throw new Error(`提示词增强接口返回 ${response.status}`); const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }; const content = json.choices?.[0]?.message?.content?.trim(); if (!content) throw new Error("提示词增强没有返回内容"); return content;
  } catch (error) { if ((error as Error).name === "AbortError") throw new Error("提示词增强超时，请保留原提示词重试"); throw error; } finally { clearTimeout(timer); }
}
function broadcast(channel: string, value: unknown) { for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, value); }
async function queueSnapshot() { return queueStore ? queueStore.read() : []; }
async function processQueue() {
  if (!queueStore || activeQueueJobId) return; const items = await queueStore.read(); const job = items.find(item => item.status === "queued"); if (!job) { broadcast("queue:update", items); return; }
  const win = BrowserWindow.getAllWindows()[0]; if (!win) return; activeQueueJobId = job.id; const running = { ...job, status: "running" as const, attempts: job.attempts + 1, updatedAt: new Date().toISOString(), error: undefined }; await queueStore.save(running); broadcast("queue:update", await queueStore.read());
  try { const raw = await queueStore.materialize(running); const result = await callImages(win, running.kind === "edit" ? "edits" : "generations", raw as RequestInput & Partial<EditInput>); const completed = { ...running, status: "completed" as const, elapsedMs: result.elapsedMs, resultGalleryIds: (result.gallery || []).map(item => item.id), updatedAt: new Date().toISOString() }; await queueStore.save(completed); broadcast("queue:result", { job: completed, result }); }
  catch (error) { const current = (await queueStore.read()).find(item => item.id === running.id); if (current?.status === "cancelled") broadcast("queue:error", current); else { const failed = { ...running, status: "failed" as const, error: (error as Error).message || "生成失败", updatedAt: new Date().toISOString() }; await queueStore.save(failed); broadcast("queue:error", failed); } }
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
  ipcMain.handle("image:cancel", async (_e, requestId: string) => { controllers.get(requestId)?.abort(); });
  ipcMain.handle("image:save", async (_e, value: { dataUrl: string; suggestedName: string }) => {
    await fs.mkdir(DEFAULT_SAVE_DIR, { recursive: true });
    const result = await dialog.showSaveDialog({ defaultPath: path.join(DEFAULT_SAVE_DIR, value.suggestedName || `pinaic-${Date.now()}.png`), filters: [{ name: "PNG 图片", extensions: ["png"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const base64 = value.dataUrl.replace(/^data:image\/\w+;base64,/, ""); await fs.writeFile(result.filePath, Buffer.from(base64, "base64")); return { canceled: false, path: result.filePath };
  });
  ipcMain.handle("gallery:list", async () => { const result = await galleryStore.search({ pageSize: 100 }); return { ok: true, ...result, projects: await galleryStore.getProjects() }; });
  ipcMain.handle("gallery:workspace", async () => ({ ok: true, ...(await galleryStore.readState()) }));
  ipcMain.handle("gallery:search", async (_e, input: GallerySearch = {}) => ({ ok: true, ...(await galleryStore.search(input)) }));
  ipcMain.handle("gallery:thumbnail", async (_e, id: string) => {
    const value = await galleryStore.thumbnail(id); if (!value) return { ok: false, error: "图库记录不存在" }; if (typeof value === "string") return { ok: true, b64: value };
    const image = nativeImage.createFromPath(value.sourcePath); if (image.isEmpty()) return { ok: false, error: "图片文件不存在" }; const thumb = image.resize({ width: 360, quality: "good" }).toJPEG(82); await fs.writeFile(value.thumbPath, thumb); return { ok: true, b64: thumb.toString("base64") };
  });
  ipcMain.handle("gallery:loadImage", async (_e, id: string) => { const value = await galleryStore.load(id); return value?.b64 ? { ok: true, b64: value.b64, item: value.item } : { ok: false, error: "图片文件不存在" }; });
  ipcMain.handle("gallery:update", async (_e, id: string, patch: Partial<Pick<GalleryItem, "title" | "tags" | "projectId">>) => {
    const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; if (typeof patch.title === "string") item.title = patch.title.trim().slice(0, 120) || item.title; if (Array.isArray(patch.tags)) item.tags = [...new Set(patch.tags.map(value => String(value).trim()).filter(Boolean))].slice(0, 20); if (patch.projectId && state.projects.some(project => project.id === patch.projectId)) item.projectId = patch.projectId; await galleryStore.writeState(state); return { ok: true, item };
  });
  ipcMain.handle("gallery:toggleFavorite", async (_e, id: string) => { const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; item.favorite = !item.favorite; await galleryStore.writeState(state); return { ok: true, item }; });
  ipcMain.handle("gallery:delete", async (_e, id: string) => { const state = await galleryStore.readState(); const item = state.items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; await fs.rm(path.join(galleryDir, path.basename(item.fileName)), { force: true }); await fs.rm(path.join(galleryStore.thumbsDir, `${item.id}.jpg`), { force: true }); state.items = state.items.filter(value => value.id !== id); for (const project of state.projects) if (project.coverId === id) delete project.coverId; await galleryStore.writeState(state); return { ok: true }; });
  ipcMain.handle("projects:create", async (_e, name: string) => { const state = await galleryStore.readState(); const clean = String(name || "").trim().slice(0, 80); if (!clean) return { ok: false, error: "项目名称不能为空" }; const timestamp = new Date().toISOString(); const project: GalleryProject = { id: randomUUID(), name: clean, createdAt: timestamp, updatedAt: timestamp }; state.projects.push(project); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle("projects:rename", async (_e, id: string, name: string) => { const state = await galleryStore.readState(); const project = state.projects.find(value => value.id === id); const clean = String(name || "").trim().slice(0, 80); if (!project || id === INBOX_PROJECT_ID || !clean) return { ok: false, error: "项目不可修改" }; project.name = clean; project.updatedAt = new Date().toISOString(); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle("projects:delete", async (_e, id: string) => { if (id === INBOX_PROJECT_ID) return { ok: false, error: "收件箱不能删除" }; const state = await galleryStore.readState(); if (!state.projects.some(value => value.id === id)) return { ok: false, error: "项目不存在" }; state.items = state.items.map(item => item.projectId === id ? { ...item, projectId: INBOX_PROJECT_ID } : item); state.projects = state.projects.filter(value => value.id !== id); await galleryStore.writeState(state); return { ok: true }; });
  ipcMain.handle("projects:setCover", async (_e, projectId: string, itemId: string) => { const state = await galleryStore.readState(); const project = state.projects.find(value => value.id === projectId); const item = state.items.find(value => value.id === itemId); if (!project || !item || item.projectId !== projectId) return { ok: false, error: "图片不属于该项目" }; project.coverId = itemId; project.updatedAt = new Date().toISOString(); await galleryStore.writeState(state); return { ok: true, project }; });
  ipcMain.handle("gallery:bulk", async (_e, input: { ids: string[]; action: "move" | "favorite" | "delete" | "tags"; projectId?: string; favorite?: boolean; tags?: string[] }) => {
    const ids = new Set((input.ids || []).filter(Boolean)); const state = await galleryStore.readState(); const selected = state.items.filter(item => ids.has(item.id)); if (!selected.length) return { ok: false, error: "未选择图片" };
    if (input.action === "delete") { for (const item of selected) { await fs.rm(path.join(galleryDir, path.basename(item.fileName)), { force: true }); await fs.rm(path.join(galleryStore.thumbsDir, `${item.id}.jpg`), { force: true }); } state.items = state.items.filter(item => !ids.has(item.id)); for (const project of state.projects) if (project.coverId && ids.has(project.coverId)) delete project.coverId; }
    if (input.action === "move" && input.projectId && state.projects.some(project => project.id === input.projectId)) state.items = state.items.map(item => ids.has(item.id) ? { ...item, projectId: input.projectId! } : item);
    if (input.action === "favorite") state.items = state.items.map(item => ids.has(item.id) ? { ...item, favorite: Boolean(input.favorite) } : item);
    if (input.action === "tags") { const tags = [...new Set((input.tags || []).map(value => String(value).trim()).filter(Boolean))].slice(0, 20); state.items = state.items.map(item => ids.has(item.id) ? { ...item, tags } : item); }
    await galleryStore.writeState(state); return { ok: true, count: selected.length };
  });
  ipcMain.handle("prompt:enhance", async (_e, input: { prompt: string; mode: "generate" | "edit" }) => { const prompt = String(input?.prompt || "").trim(); if (!prompt) return { ok: false, error: "请先输入提示词" }; try { return { ok: true, prompt: await enhancePromptWithModel(prompt, input.mode === "edit" ? "edit" : "generate") }; } catch (error) { return { ok: false, error: (error as Error).message || "提示词增强失败" }; } });
  ipcMain.handle("queue:list", async () => ({ ok: true, items: await queueSnapshot() }));
  ipcMain.handle("queue:enqueue", async (_e, input: { kind: "generate" | "edit"; payload: Record<string, unknown> }) => { const job = await queueStore.enqueue(input.kind, input.payload); broadcast("queue:update", await queueStore.read()); void processQueue(); return { ok: true, job }; });
  ipcMain.handle("queue:retry", async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || !["failed", "interrupted", "cancelled"].includes(job.status)) return { ok: false, error: "任务不可重试" }; const next = { ...job, status: "queued" as const, error: undefined, updatedAt: new Date().toISOString() }; await queueStore.save(next); broadcast("queue:update", await queueStore.read()); void processQueue(); return { ok: true, job: next }; });
  ipcMain.handle("queue:cancel", async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || !["queued", "running"].includes(job.status)) return { ok: false, error: "任务不可取消" }; const next = { ...job, status: "cancelled" as const, error: "已取消", updatedAt: new Date().toISOString() }; await queueStore.save(next); if (job.status === "running") controllers.get(job.requestId)?.abort(); broadcast("queue:update", await queueStore.read()); return { ok: true, job: next }; });
  ipcMain.handle("queue:remove", async (_e, id: string) => { const items = await queueStore.read(); const job = items.find(value => value.id === id); if (!job || job.status === "running") return { ok: false, error: "运行中的任务不可移除" }; await queueStore.remove(id); broadcast("queue:update", await queueStore.read()); return { ok: true }; });
  ipcMain.handle("clipboard:copyText", async (_e, value: string) => { clipboard.writeText(String(value || "")); return { ok: true }; });
  ipcMain.handle("clipboard:copyImage", async (_e, b64: string) => { const image = nativeImage.createFromBuffer(Buffer.from(String(b64 || "").replace(/^data:image\/\w+;base64,/, ""), "base64")); if (image.isEmpty()) return { ok: false, error: "图片数据无效" }; clipboard.writeImage(image); return { ok: true }; });
  ipcMain.handle("gallery:exportZip", async (_e, ids: string[]) => {
    const state = await galleryStore.readState(); const selected = state.items.filter(item => (ids || []).includes(item.id)); if (!selected.length) return { ok: false, error: "未选择图片" }; await fs.mkdir(DEFAULT_SAVE_DIR, { recursive: true }); const dialogResult = await dialog.showSaveDialog({ defaultPath: path.join(DEFAULT_SAVE_DIR, `pinaic-images-${Date.now()}.zip`), filters: [{ name: "ZIP 文件", extensions: ["zip"] }] }); if (dialogResult.canceled || !dialogResult.filePath) return { ok: true, canceled: true };
    await new Promise<void>((resolve, reject) => { const output = createWriteStream(dialogResult.filePath!); const archive = archiver("zip", { zlib: { level: 9 } }); output.on("close", resolve); archive.on("error", reject); archive.pipe(output); for (const item of selected) archive.file(path.join(galleryDir, path.basename(item.fileName)), { name: `${item.title.replace(/[\\/:*?\"<>|]/g, "_") || item.id}.png` }); void archive.finalize(); }); return { ok: true, path: dialogResult.filePath, count: selected.length };
  });
  ipcMain.handle("templates:list", async () => ({ ok: true, items: [...DEFAULT_TEMPLATES, ...(await readCustomTemplates())] }));
  ipcMain.handle("templates:save", async (_e, input: Partial<PromptTemplate>) => { if (!input.title?.trim() || !input.prompt?.trim()) return { ok: false, error: "模板标题和提示词不能为空" }; const items = await readCustomTemplates(); const item: PromptTemplate = { id: input.id && !input.id.startsWith("builtin-") ? input.id : `custom-${randomUUID()}`, title: input.title.trim(), category: input.category?.trim() || "自定义", prompt: input.prompt.trim(), ratio: input.ratio, resolution: input.resolution, quality: input.quality }; const next = [...items.filter(value => value.id !== item.id), item]; await fs.mkdir(path.dirname(await templatesFile()), { recursive: true }); await fs.writeFile(await templatesFile(), JSON.stringify(next, null, 2), "utf8"); return { ok: true, item }; });
  ipcMain.handle("templates:delete", async (_e, id: string) => { if (id.startsWith("builtin-")) return { ok: false, error: "内置模板不能删除" }; const items = await readCustomTemplates(); await fs.writeFile(await templatesFile(), JSON.stringify(items.filter(item => item.id !== id), null, 2), "utf8"); return { ok: true }; });
  configureAutoUpdater();
  createWindow();
  if (app.isPackaged && await checkUpdatesAtStartup()) setTimeout(() => { void checkForAppUpdate(); }, 5_000);
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

type ApiImage = { b64_json?: string; url?: string };
