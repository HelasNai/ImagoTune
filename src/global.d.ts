export {};

declare global {
  interface Window {
    pinaic: {
      settings: {
        get: () => Promise<{ configured: boolean; baseUrl: string; autoArchive: boolean }>;
        save: (input: { apiKey: string; baseUrl: string; autoArchive?: boolean }) => Promise<{ ok: boolean }>;
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
      saveImage: (input: { dataUrl: string; suggestedName: string }) => Promise<{ canceled: boolean; path?: string }>;
      prompt: { enhance: (input: { prompt: string; mode: "generate" | "edit" }) => Promise<{ ok: boolean; prompt?: string; error?: string }> };
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
    };
  }

  interface AppProgress { requestId: string; progress?: number; status: string; message?: string }
  interface ApiImage { b64_json?: string; url?: string }
  interface ApiResult { ok: boolean; images?: ApiImage[]; gallery?: GalleryItem[]; error?: string; requestId?: string; elapsedMs?: number }
  interface GalleryProject { id: string; name: string; createdAt: string; updatedAt: string; coverId?: string }
  interface GalleryItem { id: string; fileName: string; title: string; prompt: string; model: string; size: string; quality?: string; ratio?: string; resolution?: string; mode: "generate" | "edit"; createdAt: string; favorite: boolean; projectId: string; tags: string[]; sourceId?: string; variationLabel?: string }
  interface PromptTemplate { id: string; title: string; category: string; prompt: string; ratio?: string; resolution?: string; quality?: string; builtin?: boolean }
  interface QueueJob { id: string; requestId: string; kind: "generate" | "edit"; status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"; createdAt: string; updatedAt: string; attempts: number; input: Record<string, unknown>; error?: string; elapsedMs?: number; resultGalleryIds?: string[] }
  interface UpdateStatus { phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error"; version?: string; progress?: number; message: string }
}
