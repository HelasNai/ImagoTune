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
  variationLabel?: string;
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

export type LocalAIModelProgress = LocalAIModelStatus & { message: string };

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
  | "upload"
  | "content"
  | "rate_limit"
  | "timeout"
  | "server"
  | "cancelled"
  | "unknown";

export interface GenerationErrorInfo {
  category: GenerationErrorCategory;
  title: string;
  message: string;
  suggestion: string;
  retryable: boolean;
  status?: number;
  details?: string;
}

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

export interface ProviderModel {
  id: string;
  roles: ModelRole[];
  source?: "custom";
  missing?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  models: ProviderModel[];
  modelsUpdatedAt?: string;
}

export interface ProviderSummary extends ProviderConfig {
  hasKey: boolean;
}

export interface ModelConfig {
  version: 1;
  providers: ProviderConfig[];
  roles: Record<ModelRole, RoleBinding | null>;
  autoArchive: boolean;
}

export interface SettingsSnapshot {
  providers: ProviderSummary[];
  roles: Record<ModelRole, RoleBinding | null>;
  autoArchive: boolean;
  saveDir: string;
  configured: boolean;
  hasSavedApiKey: boolean;
  warning?: string;
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
