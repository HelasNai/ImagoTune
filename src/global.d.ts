import type * as Shared from "../shared/types";

export {};

declare global {
  interface Window {
    imageStudio: {
      settings: {
        get: () => Promise<SettingsSnapshot>;
        save: (input: SettingsSavePayload) => Promise<{ ok: boolean; error?: string }>;
        chooseSaveDir: () => Promise<{ ok: boolean; canceled?: boolean; saveDir?: string; error?: string }>;
        resetSaveDir: () => Promise<{ ok: boolean; saveDir?: string; error?: string }>;
        openSaveDir: () => Promise<{ ok: boolean; error?: string }>;
        clear: () => Promise<{ ok: boolean }>;
        test: (input?: SettingsTestInput) => Promise<SettingsTestResult>;
      };
      updates: {
        get: () => Promise<{ ok: boolean; appVersion: string; channel: UpdateChannel; autoUpdate: boolean; supported: boolean; status: UpdateStatus; alphaUnlocked: boolean }>;
        setChannel: (channel: UpdateChannel) => Promise<{ ok: boolean; channel?: UpdateChannel; error?: string }>;
        setAlphaUnlocked: (enabled: boolean) => Promise<{ ok: boolean; channel?: UpdateChannel; error?: string }>;
        setAutoUpdate: (enabled: boolean) => Promise<{ ok: boolean; autoUpdate?: boolean; error?: string }>;
        check: () => Promise<{ ok: boolean; message: string }>;
        download: () => Promise<{ ok: boolean; message: string }>;
        install: () => Promise<{ ok: boolean; message: string }>;
      };
      generate: (input: unknown) => Promise<ApiResult>;
      edit: (input: unknown) => Promise<ApiResult>;
      cancel: (requestId: string) => Promise<void>;
      saveImage: (input: { dataUrl: string; suggestedName: string; recipe?: ImageRecipeV1 }) => Promise<{ canceled: boolean; path?: string }>;
      prompt: {
        enhance: (input: { prompt: string; mode: "generate" | "edit" }) => Promise<{ ok: boolean; prompt?: string; error?: string }>;
        reverse: (input: { image: BinaryPayload }) => Promise<{ ok: boolean; zh?: string; en?: string; error?: string }>;
      };
      outpaint: { prepare: (input: { sourceWidth: number; sourceHeight: number; targetSize: string }) => Promise<{ ok: boolean; size?: string; error?: string }> };
      localAI: {
        capabilities: () => Promise<LocalAICapabilities>;
        models: () => Promise<{ ok: boolean; items: LocalAIModelStatus[] }>;
        chooseModelDir: () => Promise<{ ok: boolean; canceled?: boolean; modelsDir?: string; items?: LocalAIModelStatus[]; error?: string }>;
        resetModelDir: () => Promise<{ ok: boolean; modelsDir?: string; items?: LocalAIModelStatus[]; error?: string }>;
        openModelDir: () => Promise<{ ok: boolean; error?: string }>;
        modelUrl: (id: LocalAIModelId) => Promise<{ ok: boolean; url?: string; error?: string }>;
        downloadModel: (id: LocalAIModelId) => Promise<{ ok: boolean; item?: LocalAIModelStatus; error?: string }>;
        pauseDownload: (id: LocalAIModelId) => Promise<{ ok: boolean }>;
        deleteModel: (id: LocalAIModelId) => Promise<{ ok: boolean; error?: string }>;
        archiveResult: (input: { dataUrl: string; title?: string; recipe: ImageRecipeV1 }) => Promise<{ ok: boolean; item?: GalleryItem; error?: string }>;
      };
      png: { readRecipe: (input: { dataUrl?: string; data?: number[] }) => Promise<{ ok: boolean; recipe?: ImageRecipeV1; error?: string }> };
      queue: {
        list: () => Promise<{ ok: boolean; items: QueueJob[] }>;
        enqueue: (input: { kind: "generate" | "edit"; payload: unknown }) => Promise<{ ok: boolean; job?: QueueJob; error?: string }>;
        retry: (id: string, options?: QueueRetryOptions) => Promise<{ ok: boolean; job?: QueueJob; error?: string }>;
        cancel: (id: string) => Promise<{ ok: boolean; job?: QueueJob; error?: string }>;
        remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
        clear: () => Promise<{ ok: boolean; removed?: number; error?: string }>;
      };
      clipboard: {
        copyText: (value: string) => Promise<{ ok: boolean; error?: string }>;
        copyImage: (b64: string) => Promise<{ ok: boolean; error?: string }>;
        readImage: () => Promise<{ ok: boolean; b64?: string; error?: string }>;
      };
      windowControls: {
        minimize: () => Promise<{ ok: boolean; error?: string }>;
        toggleMaximize: () => Promise<{ ok: boolean; maximized?: boolean; error?: string }>;
        close: () => Promise<{ ok: boolean; error?: string }>;
        isMaximized: () => Promise<{ ok: boolean; maximized?: boolean; error?: string }>;
        getZoom: () => Promise<{ ok: boolean; factor?: number; error?: string }>;
        setZoom: (factor: number) => Promise<{ ok: boolean; factor?: number; error?: string }>;
        onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
      };
      gallery: {
        list: (input?: unknown) => Promise<{ ok: boolean; items: GalleryItem[]; projects?: GalleryProject[]; total?: number; error?: string }>;
        workspace: () => Promise<{ ok: boolean; projects: GalleryProject[]; items: GalleryItem[] }>;
        search: (input?: unknown) => Promise<{ ok: boolean; items: GalleryItem[]; total?: number; page?: number; pageSize?: number; error?: string }>;
        thumbnail: (id: string) => Promise<{ ok: boolean; b64?: string; error?: string }>;
        toggleFavorite: (id: string) => Promise<{ ok: boolean; item?: GalleryItem; error?: string }>;
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
        update: (id: string, patch: unknown) => Promise<{ ok: boolean; item?: GalleryItem; error?: string }>;
        bulk: (input: unknown) => Promise<{ ok: boolean; count?: number; error?: string }>;
        exportZip: (ids: string[]) => Promise<{ ok: boolean; canceled?: boolean; path?: string; count?: number; error?: string }>;
        loadImage: (id: string) => Promise<{ ok: boolean; b64?: string; item?: GalleryItem; error?: string }>;
      };
      projects: {
        create: (name: string) => Promise<{ ok: boolean; project?: GalleryProject; error?: string }>;
        rename: (id: string, name: string) => Promise<{ ok: boolean; project?: GalleryProject; error?: string }>;
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
        setCover: (projectId: string, itemId: string) => Promise<{ ok: boolean; project?: GalleryProject; error?: string }>;
      };
      templates: {
        list: () => Promise<{ ok: boolean; items: PromptTemplate[] }>;
        save: (input: unknown) => Promise<{ ok: boolean; item?: PromptTemplate; error?: string }>;
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      };
      onProgress: (callback: (event: AppProgress) => void) => () => void;
      onProgressUpdate: (callback: (event: TaskProgressEvent) => void) => () => void;
      onQueueUpdate: (callback: (event: QueueJob[]) => void) => () => void;
      onQueueResult: (callback: (event: { job: QueueJob; result: ApiResult }) => void) => () => void;
      onQueueError: (callback: (event: QueueJob) => void) => () => void;
      onUpdateStatus: (callback: (event: UpdateStatus) => void) => () => void;
      onLocalAIModelProgress: (callback: (event: LocalAIModelProgress) => void) => () => void;
      onTutorialOpen: (callback: () => void) => () => void;
    };
  }

  // 跨进程共享类型：定义已全部迁至 shared/types.d.ts（单一来源），此处仅保留全局别名。
  // 渲染层消费者继续以这些名字引用类型（如 ImageRecipeV1 / QueueJob / GalleryItem），无需改动。
  type AppProgress = Shared.AppProgress;
  type ProgressScope = Shared.ProgressScope;
  type ProgressState = Shared.ProgressState;
  type TaskProgressEvent = Shared.TaskProgressEvent;
  type BinaryPayload = Shared.BinaryPayload;
  type RecipeMode = Shared.RecipeMode;
  type UpdateChannel = Shared.UpdateChannel;
  type UpdatePhase = Shared.UpdatePhase;
  type OutpaintRecipe = Shared.OutpaintRecipe;
  type LocalAITool = Shared.LocalAITool;
  type LocalAIModelId = Shared.LocalAIModelId;
  type PostProcessingStep = Shared.PostProcessingStep;
  type ImageRecipeV1 = Shared.ImageRecipeV1;
  type LocalAIModelStatus = Shared.LocalAIModelStatus;
  type LocalAIModelProgress = Shared.LocalAIModelProgress;
  type LocalAICapabilities = Shared.LocalAICapabilities;
  type GenerationErrorCategory = Shared.GenerationErrorCategory;
  type GenerationErrorInfo = Shared.GenerationErrorInfo;
  type ApiImage = Shared.ApiImage;
  type ApiResult = Shared.ApiResult;
  type GalleryProject = Shared.GalleryProject;
  type GalleryItem = Shared.GalleryItem;
  type GalleryState = Shared.GalleryState;
  type GallerySearch = Shared.GallerySearch;
  type PromptTemplate = Shared.PromptTemplate;
  type QueueJob = Shared.QueueJob;
  type QueueStatus = Shared.QueueStatus;
  type UpdateStatus = Shared.UpdateStatus;
  type LocalAIModelManifest = Shared.LocalAIModelManifest;
  type ModelDownloadState = Shared.ModelDownloadState;
  type StoredAttachment = Shared.StoredAttachment;
  type ModelRole = Shared.ModelRole;
  type RoleBinding = Shared.RoleBinding;
  type ProviderApiStyle = Shared.ProviderApiStyle;
  type ProviderModel = Shared.ProviderModel;
  type ProviderConfig = Shared.ProviderConfig;
  type ProviderSummary = Shared.ProviderSummary;
  type ProviderPreset = Shared.ProviderPreset;
  type ModelConfig = Shared.ModelConfig;
  type SettingsSnapshot = Shared.SettingsSnapshot;
  type SettingsSavePayload = Shared.SettingsSavePayload;
  type SettingsTestInput = Shared.SettingsTestInput;
  type SettingsTestResult = Shared.SettingsTestResult;
  type QueueRetryOptions = Shared.QueueRetryOptions;
}
