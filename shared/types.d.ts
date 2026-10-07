// shared/types.d.ts
// 单一来源：主进程（electron/）与渲染进程（src/）共享的全部跨进程类型。
// 本文件为模块（顶层 export），通过相对路径 `../shared/types` 从两端导入。
// 约定：两端都声明过的类型以 electron 侧为超集；形状与语义保持迁移前一致（只搬移，不重新设计）。
// 注意：本文件不参与任何 tsconfig 的 include，仅靠被 import 时按需加载；不得改 rootDir/outDir/include。

export interface AppProgress {
  requestId: string;
  progress?: number;
  status: string;
  message?: string;
}

/** 进度作用域：任务型活动。下载类（更新/模型）继续走各自既有数据模型，不并入此处。 */
export type ProgressScope = "generate" | "enhance" | "reverse" | "local-ai" | "export";

/** 进度事件状态：running 进行中；done / error / cancelled 为终态。 */
export type ProgressState = "running" | "done" | "error" | "cancelled";

/**
 * 统一进度事件（统一进度反馈模型）。
 * 与 AppProgress 并存：AppProgress 是云生图旧通道载荷，TaskProgressEvent 是渲染层统一消费的模型。
 * 关键约定：progress 缺省即"不确定进度"（渲染流光条），绝不编造百分比。
 */
export interface TaskProgressEvent {
  /** 关联 id：生成/增强/反推/导出由渲染层传入 requestId，主进程原样回显；本地推理用 taskId。 */
  id: string;
  scope: ProgressScope;
  /** 面向用户的当前阶段文案（中文）。 */
  message: string;
  /** 0-100 全局进度；缺省 = 不确定进度（流光条，绝不编造百分比）。 */
  progress?: number;
  /** 多阶段流水线（如人脸→超分→抠图）：当前阶段（0 起）与总数；单阶段省略。 */
  stageIndex?: number;
  totalStages?: number;
  stageLabel?: string;
  /** 起始时间 epoch ms：渲染层本地秒表用，主进程无需高频心跳。 */
  startedAt?: number;
  /** 终态总耗时（done / error 时给出精确值）。 */
  elapsedMs?: number;
  state: ProgressState;
  /** 附加信息，如 device: "webgpu" | "wasm"。 */
  detail?: string;
}

export interface BinaryPayload {
  name: string;
  type: string;
  data: number[];
}

export type RecipeMode = "generate" | "edit" | "outpaint";

export type UpdateChannel = "stable" | "beta" | "alpha";

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";

export interface OutpaintRecipe {
  sourceSize: string;
  targetSize: string;
  top: number;
  right: number;
  bottom: number;
  left: number;
  preset?: string;
}

export type LocalAITool = "upscale" | "remove-background" | "face-restore";

export type LocalAIModelId = "realesrgan-x2" | "realesrgan-x4" | "isnet-general" | "yunet" | "gfpgan-v1.4";

export interface PostProcessingStep {
  tool: LocalAITool;
  modelId: string;
  modelVersion: string;
  parameters: Record<string, string | number | boolean>;
  device: "webgpu" | "wasm";
  elapsedMs: number;
  createdAt: string;
}

export interface ImageRecipeV1 {
  version: 1;
  prompt: string;
  negativePrompt: string;
  model: string;
  size: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  n: number;
  mode: RecipeMode;
  projectId: string;
  tags: string[];
  createdAt: string;
  sourceId?: string;
  /**
   * 变体/衍生动作标签。本地 AI 归档（upscale/matting/face/combo 工具）写**动作 code**
   * （`"upscale" | "matting" | "face" | "combo"`），渲染层经 `localAIArchiveLabel` 按语言翻译；
   * 其它来源（如在线变体）与历史记录仍为已本地化字符串，渲染层冻结原样。
   */
  variationLabel?: string;
  /**
   * 图库恢复标记（T29）：`rebuildFromPngFiles` 为「无内嵌配方」的 PNG 写入系统默认名
   * `"恢复的历史图片"` 时置 true，渲染层据此把该默认名按当前语言渲染；无标记的历史记录冻结原样。
   * 内嵌配方的恢复项保留真实 prompt，不置此标记。
   */
  recovered?: boolean;
  referenceCount?: number;
  seed?: string;
  outpaint?: OutpaintRecipe;
  postProcessing?: PostProcessingStep[];
}

export type ModelDownloadState = "missing" | "partial" | "downloading" | "verifying" | "installed" | "error";

export interface LocalAIModelStatus {
  id: LocalAIModelId;
  name: string;
  version: string;
  size: number;
  downloaded: number;
  progress: number;
  state: ModelDownloadState;
  installed: boolean;
  license: string;
  sourceUrl: string;
  purpose: string;
  beta?: boolean;
  error?: string;
}

export type LocalAIModelProgress = LocalAIModelStatus & {
  message: string;
  /** 下载进度语义 code（值不含 `localai.` 前缀；渲染层经 tCode("localai", code, params, message) 查 en 词典，zh 用 message 回退）。 */
  code?: LocalAIModelProgressCode;
  /** 消息插值参数（如 `{name}`/`{status}`/`{expected}`/`{actual}`）；缺失参数保留占位符原文。 */
  params?: Record<string, string | number>;
};

/** 本地 AI 模型下载/校验的进度语义 code；新增一条 = 本联合 + `en/localai.ts` 的 `localai.<code>` 键。 */
export type LocalAIModelProgressCode =
  | "verifyingExisting"
  | "verifyingSha"
  | "installed"
  | "paused"
  | "downloading"
  | "verifyFailed"
  | "httpStatus"
  | "noBody"
  | "failed";

export interface LocalAICapabilities {
  ok: boolean;
  webgpu: boolean;
  wasm: boolean;
  maxOutputEdge: number;
  maxOutputPixels: number;
  modelsDir: string;
}

export type GenerationErrorCategory =
  | "network"
  | "authentication"
  | "balance"
  | "parameters"
  | "endpoint"
  | "upload"
  | "content"
  | "rate_limit"
  | "timeout"
  | "server"
  | "cancelled"
  | "unknown";

// 生成错误语义 code（值不含 `error.` 前缀；渲染层经 tCode("error", `${code}.title`) 查 en 词典，
// zh 用下方 title/message/suggestion 存储原文回退）。新增一条 = 新增一个 code + en 词典三键。
export type GenerationErrorCode =
  | "parameters.quality"
  | "content.rejected"
  | "http.balance"
  | "http.unauthorized"
  | "http.forbidden"
  | "upload.tooLarge"
  | "http.timeout"
  | "http.rateLimit"
  | "http.notFound"
  | "parameters.size"
  | "http.server"
  | "http.unknown"
  | "cancel.user"
  | "cancel.interrupt"
  | "network.timeout"
  | "archive.failed"
  | "network.offline"
  | "runtime.unknown"
  | "hunyuan.singleImage"
  | "hunyuan.sizeUnsupported"
  | "hunyuan.invalidResponse"
  | "hunyuan.noImageUrl"
  | "hunyuan.endpointMissing"
  // 通用平台适配器错误（智谱/火山/阿里/硅基/xAI/OpenRouter 六家共享；新增一条 = 本联合 + en/errors.ts 三键）
  | "parameters.imageCount"
  | "parameters.referenceUnsupported"
  | "response.invalid"
  // 队列绑定失败（T28）：执行期解析不到原快照必需的供应商/模型。旧记录此字段缺省，
  // 渲染层回退存储中文；新增记录必须带码，en 才可本地化。
  | "provider.unavailable"
  | "queue.missingModel";

export interface GenerationErrorInfo {
  category: GenerationErrorCategory;
  title: string;
  message: string;
  suggestion: string;
  retryable: boolean;
  status?: number;
  details?: string;
  /** 语义 code（可选：历史错误/未分类路径无此字段，渲染层回退存储文本）。 */
  code?: GenerationErrorCode;
  /** 消息插值参数（如 `{seconds}`）；缺失参数保留占位符原文。 */
  params?: Record<string, string | number>;
}

// 主进程 IPC 失败语义 code（值不含 `ipc.` 前缀；渲染层经 tCode("ipc", code, params, error) 查 en 词典，
// zh 用各 handler 保留的中文 error 原文回退）。新增一条 = 新增一个 code + 对应域分片的 `ipc.<code>` 键。
// 覆盖范围：图库/项目、队列、模板、本地 AI、剪贴板（T24），以及设置/更新/目录/扩图/提示词/PNG（T25）。
export type IpcCode =
  | "gallery.notFound"
  | "gallery.thumbnailFailed"
  | "gallery.loadFailed"
  | "gallery.openFailed"
  | "gallery.nothingSelected"
  | "gallery.projectNameRequired"
  | "gallery.projectNotEditable"
  | "gallery.inboxNotDeletable"
  | "gallery.projectNotFound"
  | "gallery.coverMismatch"
  | "queue.noBinding"
  | "queue.enqueueFailed"
  | "queue.notRetryable"
  | "queue.notCancellable"
  | "queue.runningNotRemovable"
  | "queue.clearFailed"
  | "template.empty"
  | "template.builtinNotDeletable"
  | "localai.notInstalled"
  | "localai.downloadFailed"
  | "localai.deleteFailed"
  | "localai.emptyResult"
  | "localai.archiveFailed"
  | "clipboard.copyImageFailed"
  | "clipboard.noImage"
  | "clipboard.readImageFailed"
  // —— T25：设置 / 更新 / 目录 / 扩图 / 提示词 / PNG ——
  | "settings.invalidPayload"
  | "settings.providerBusy"
  | "settings.saveFailed"
  | "settings.unsupportedLocale"
  | "settings.localeSaveFailed"
  | "settings.providerIdRequired"
  | "settings.providerIdDuplicate"
  | "settings.providerNameRequired"
  | "settings.providerApiInvalid"
  | "settings.providerIdReserved"
  | "settings.providerIdFormat"
  | "settings.bindingProviderMissing"
  | "settings.bindingModelRequired"
  | "settings.credentialFailed"
  | "settings.configWriteFailed"
  | "updates.alphaLocked"
  | "updates.channelSaveFailed"
  | "updates.alphaUnlockSaveFailed"
  | "updates.autoUpdateSaveFailed"
  | "directory.saveDirBusy"
  | "directory.modelDirBusy"
  | "directory.saveChooseFailed"
  | "directory.modelChooseFailed"
  | "directory.saveResetFailed"
  | "directory.modelResetFailed"
  | "outpaint.invalidTarget"
  | "outpaint.targetTooSmall"
  | "outpaint.targetUnsafe"
  | "prompt.empty"
  | "prompt.enhanceFailed"
  | "prompt.reverseFailed"
  | "png.noRecipe"
  | "png.readFailed";

export interface ApiImage {
  b64_json?: string;
  url?: string;
  seed?: string | number;
}

export interface ApiResult {
  ok: boolean;
  images?: ApiImage[];
  gallery?: GalleryItem[];
  recipe?: ImageRecipeV1;
  archiveWarning?: string;
  error?: string;
  errorInfo?: GenerationErrorInfo;
  requestId?: string;
  elapsedMs?: number;
}

export interface GalleryProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  coverId?: string;
}

export interface GalleryItem {
  id: string;
  fileName: string;
  title: string;
  createdAt: string;
  favorite: boolean;
  recipe: ImageRecipeV1;
}

export interface GalleryState {
  version: 3;
  projects: GalleryProject[];
  items: GalleryItem[];
}

export interface GallerySearch {
  query?: string;
  favoriteOnly?: boolean;
  projectId?: string;
  tag?: string;
  resolution?: string;
  size?: string;
  seed?: string;
  sort?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
}

export interface PromptTemplate {
  id: string;
  title: string;
  category: string;
  prompt: string;
  kind: "positive" | "negative";
  ratio?: string;
  resolution?: string;
  quality?: string;
  builtin?: boolean;
}

export type QueueStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface StoredAttachment {
  name: string;
  type: string;
  path: string;
}

export type ModelRole = "image" | "reverse" | "enhance";

export interface RoleBinding {
  providerId: string;
  model: string;
}

/** 供应商接口风格；缺省（undefined）等同 "openai"，旧配置与 JSON 无需迁移 */
export type ProviderApiStyle =
  | "openai"
  | "hunyuan-image"
  | "zhipu-image"
  | "volcengine-image"
  | "dashscope-image"
  | "siliconflow-image"
  | "xai-image"
  | "openrouter-image";

export interface ProviderModel {
  id: string;
  roles: ModelRole[];
  source?: "custom";
  missing?: boolean;
  /** 曾出现在某次「刷新模型」返回的列表中；平台列表端点覆盖不到的模型永不置位（区分「真·从列表消失」与「平台列表从不返回」）。 */
  seen?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  models: ProviderModel[];
  modelsUpdatedAt?: string;
  /** 接口风格；缺省（undefined）等同 "openai" */
  api?: ProviderApiStyle;
}

export interface ProviderSummary extends ProviderConfig {
  hasKey: boolean;
}

/** 内置预设平台：预设与自定义共用 ProviderConfig 结构，仅多一个 api 字段 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  api: ProviderApiStyle;
  presetModels: ProviderModel[];
  keyHelp: string;
}

/** 界面语言：zh（简体中文）/ en（English）。单一来源，主进程持久化与渲染层共享。 */
export type Locale = "zh" | "en";

export interface ModelConfig {
  version: 1;
  providers: ProviderConfig[];
  roles: Record<ModelRole, RoleBinding | null>;
  autoArchive: boolean;
  /** 界面语言偏好；非法值在读取时丢弃，重启后保持。 */
  locale?: Locale;
}

export interface SettingsSnapshot {
  providers: ProviderSummary[];
  roles: Record<ModelRole, RoleBinding | null>;
  autoArchive: boolean;
  saveDir: string;
  configured: boolean;
  hasSavedApiKey: boolean;
  /** 当前界面语言（经主进程校验，必为 zh | en）。 */
  locale: Locale;
  warning?: string;
  /** 内置预设平台列表（供设置页渲染，不含密钥）；暂为可选，待主进程快照填充 */
  presets?: ProviderPreset[];
}

export interface SettingsSavePayload {
  providers: Array<ProviderConfig & { apiKey?: string }>;
  removedProviderIds: string[];
  roles: Record<ModelRole, RoleBinding | null>;
  autoArchive: boolean;
}

export interface SettingsTestInput {
  providerId?: string;
  transient?: { baseUrl?: string; apiKey?: string };
}

export interface SettingsTestResult {
  ok: boolean;
  message: string;
  code?:
    | "test.ok"
    | "test.noProvider"
    | "test.notConfigured"
    | "test.noKey"
    | "test.badBaseUrl"
    | "test.scheme"
    | "test.http"
    | "test.network";
  params?: { status?: number };
  models?: string[];
}

export interface QueueRetryOptions {
  useCurrentBinding?: boolean;
}

export interface QueueJob {
  id: string;
  requestId: string;
  kind: "generate" | "edit";
  status: QueueStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  input: Record<string, unknown>;
  attachments?: { image?: StoredAttachment; mask?: StoredAttachment };
  error?: string;
  errorInfo?: GenerationErrorInfo;
  elapsedMs?: number;
  resultGalleryIds?: string[];
  /** 入队时主进程快照的 image 角色绑定（D1）；旧任务可能缺失 */
  providerId?: string;
  model?: string;
}

export interface UpdateStatus {
  phase: UpdatePhase;
  version?: string;
  progress?: number;
  message: string;
  /**
   * 稳定机器码（如 "update.available"），供渲染层经 `tCode("update", code, params, message)` 本地化；
   * message 保留为由主进程按当前 locale 生成的文案，旧消费方可直接显示。
   */
  code?: string;
  params?: Record<string, string | number>;
}

export interface LocalAIModelManifest {
  id: LocalAIModelId;
  name: string;
  fileName: string;
  version: string;
  size: number;
  sha256: string;
  urls: string[];
  license: string;
  sourceUrl: string;
  purpose: "upscale" | "remove-background" | "face-detection" | "face-restoration";
  beta?: boolean;
  input: string;
}
