export {};

declare global {
  interface Window {
    imageStudio: {
      settings: {
        get: () => Promise<{ configured: boolean; baseUrl: string; imageModel: string; chatModel: string; autoArchive: boolean; saveDir: string }>;
        save: (input: { apiKey: string; baseUrl: string; imageModel: string; chatModel: string; autoArchive?: boolean }) => Promise<{ ok: boolean }>;
        chooseSaveDir: () => Promise<{ ok: boolean; canceled?: boolean; saveDir?: string; error?: string }>;
        resetSaveDir: () => Promise<{ ok: boolean; saveDir?: string; error?: string }>;
        openSaveDir: () => Promise<{ ok: boolean; error?: string }>;
        clear: () => Promise<{ ok: boolean }>;
        test: () => Promise<{ ok: boolean; message: string }>;
      };
      updates: {
        get: () => Promise<{ ok: boolean; appVersion: string; checkAtStartup: boolean; supported: boolean; status: UpdateStatus }>;
        setStartup: (enabled: boolean) => Promise<{ ok: boolean; checkAtStartup: boolean }>;
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
        retry: (id: string) => Promise<{ ok: boolean; job?: QueueJob; error?: string }>;
        cancel: (id: string) => Promise<{ ok: boolean; job?: QueueJob; error?: string }>;
        remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
      };
      clipboard: {
        copyText: (value: string) => Promise<{ ok: boolean; error?: string }>;
        copyImage: (b64: string) => Promise<{ ok: boolean; error?: string }>;
        readImage: () => Promise<{ ok: boolean; b64?: string; error?: string }>;
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
      onQueueUpdate: (callback: (event: QueueJob[]) => void) => () => void;
      onQueueResult: (callback: (event: { job: QueueJob; result: ApiResult }) => void) => () => void;
      onQueueError: (callback: (event: QueueJob) => void) => () => void;
      onUpdateStatus: (callback: (event: UpdateStatus) => void) => () => void;
      onLocalAIModelProgress: (callback: (event: LocalAIModelProgress) => void) => () => void;
    };
  }

  interface AppProgress { requestId: string; progress?: number; status: string; message?: string }
  interface BinaryPayload { name: string; type: string; data: number[] }
  type RecipeMode = "generate" | "edit" | "outpaint";
  interface OutpaintRecipe { sourceSize: string; targetSize: string; top: number; right: number; bottom: number; left: number; preset?: string }
  type LocalAITool = "upscale" | "remove-background" | "face-restore";
  type LocalAIModelId = "realesrgan-x2" | "realesrgan-x4" | "isnet-general" | "yunet" | "gfpgan-v1.4";
  interface PostProcessingStep { tool: LocalAITool; modelId: string; modelVersion: string; parameters: Record<string, string | number | boolean>; device: "webgpu" | "wasm"; elapsedMs: number; createdAt: string }
  interface ImageRecipeV1 { version: 1; prompt: string; negativePrompt: string; model: string; size: string; ratio?: string; resolution?: string; quality?: string; n: number; mode: RecipeMode; projectId: string; tags: string[]; createdAt: string; sourceId?: string; variationLabel?: string; referenceCount?: number; seed?: string; outpaint?: OutpaintRecipe; postProcessing?: PostProcessingStep[] }
  interface LocalAIModelStatus { id: LocalAIModelId; name: string; version: string; size: number; downloaded: number; progress: number; state: "missing" | "partial" | "downloading" | "verifying" | "installed" | "error"; installed: boolean; license: string; sourceUrl: string; purpose: string; beta?: boolean; error?: string }
  interface LocalAIModelProgress extends LocalAIModelStatus { message: string }
  interface LocalAICapabilities { ok: boolean; webgpu: boolean; wasm: boolean; maxOutputEdge: number; maxOutputPixels: number; modelsDir: string }
  type GenerationErrorCategory = "network" | "authentication" | "balance" | "parameters" | "upload" | "content" | "rate_limit" | "timeout" | "server" | "cancelled" | "unknown";
  interface GenerationErrorInfo { category: GenerationErrorCategory; title: string; message: string; suggestion: string; retryable: boolean; status?: number; details?: string }
  interface ApiImage { b64_json?: string; url?: string; seed?: string | number }
  interface ApiResult { ok: boolean; images?: ApiImage[]; gallery?: GalleryItem[]; recipe?: ImageRecipeV1; archiveWarning?: string; error?: string; errorInfo?: GenerationErrorInfo; requestId?: string; elapsedMs?: number }
  interface GalleryProject { id: string; name: string; createdAt: string; updatedAt: string; coverId?: string }
  interface GalleryItem { id: string; fileName: string; title: string; createdAt: string; favorite: boolean; recipe: ImageRecipeV1 }
  interface PromptTemplate { id: string; title: string; category: string; prompt: string; kind: "positive" | "negative"; ratio?: string; resolution?: string; quality?: string; builtin?: boolean }
  interface QueueJob { id: string; requestId: string; kind: "generate" | "edit"; status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"; createdAt: string; updatedAt: string; attempts: number; input: Record<string, unknown>; error?: string; errorInfo?: GenerationErrorInfo; elapsedMs?: number; resultGalleryIds?: string[] }
  interface UpdateStatus { phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error"; version?: string; progress?: number; message: string }
}
