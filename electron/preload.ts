import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("imageStudio", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (input: { apiKey: string; baseUrl: string; imageModel: string; chatModel: string; autoArchive?: boolean }) => ipcRenderer.invoke("settings:save", input),
    chooseSaveDir: () => ipcRenderer.invoke("settings:chooseSaveDir"),
    resetSaveDir: () => ipcRenderer.invoke("settings:resetSaveDir"),
    openSaveDir: () => ipcRenderer.invoke("settings:openSaveDir"),
    clear: () => ipcRenderer.invoke("settings:clear"),
    test: () => ipcRenderer.invoke("settings:test")
  },
  updates: {
    get: () => ipcRenderer.invoke("updates:get"),
    setStartup: (enabled: boolean) => ipcRenderer.invoke("updates:setStartup", enabled),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install")
  },
  generate: (input: unknown) => ipcRenderer.invoke("image:generate", input),
  edit: (input: unknown) => ipcRenderer.invoke("image:edit", input),
  cancel: (requestId: string) => ipcRenderer.invoke("image:cancel", requestId),
  saveImage: (input: { dataUrl: string; suggestedName: string; recipe?: unknown }) => ipcRenderer.invoke("image:save", input),
  prompt: {
    enhance: (input: { prompt: string; mode: "generate" | "edit" }) => ipcRenderer.invoke("prompt:enhance", input),
    reverse: (input: unknown) => ipcRenderer.invoke("prompt:reverse", input)
  },
  outpaint: { prepare: (input: unknown) => ipcRenderer.invoke("outpaint:prepare", input) },
  localAI: {
    capabilities: () => ipcRenderer.invoke("localAI:capabilities"),
    models: () => ipcRenderer.invoke("localAI:models"),
    chooseModelDir: () => ipcRenderer.invoke("localAI:chooseModelDir"),
    resetModelDir: () => ipcRenderer.invoke("localAI:resetModelDir"),
    openModelDir: () => ipcRenderer.invoke("localAI:openModelDir"),
    modelUrl: (id: string) => ipcRenderer.invoke("localAI:modelUrl", id),
    downloadModel: (id: string) => ipcRenderer.invoke("localAI:downloadModel", id),
    pauseDownload: (id: string) => ipcRenderer.invoke("localAI:pauseDownload", id),
    deleteModel: (id: string) => ipcRenderer.invoke("localAI:deleteModel", id),
    archiveResult: (input: unknown) => ipcRenderer.invoke("localAI:archiveResult", input),
  },
  png: { readRecipe: (input: unknown) => ipcRenderer.invoke("png:readRecipe", input) },
  queue: {
    list: () => ipcRenderer.invoke("queue:list"),
    enqueue: (input: { kind: "generate" | "edit"; payload: unknown }) => ipcRenderer.invoke("queue:enqueue", input),
    retry: (id: string) => ipcRenderer.invoke("queue:retry", id),
    cancel: (id: string) => ipcRenderer.invoke("queue:cancel", id),
    remove: (id: string) => ipcRenderer.invoke("queue:remove", id)
  },
  clipboard: {
    copyText: (value: string) => ipcRenderer.invoke("clipboard:copyText", value),
    copyImage: (b64: string) => ipcRenderer.invoke("clipboard:copyImage", b64),
    readImage: () => ipcRenderer.invoke("clipboard:readImage"),
  },
  gallery: {
    list: (input?: unknown) => ipcRenderer.invoke("gallery:list", input || {}),
    workspace: () => ipcRenderer.invoke("gallery:workspace"),
    search: (input?: unknown) => ipcRenderer.invoke("gallery:search", input || {}),
    thumbnail: (id: string) => ipcRenderer.invoke("gallery:thumbnail", id),
    toggleFavorite: (id: string) => ipcRenderer.invoke("gallery:toggleFavorite", id),
    delete: (id: string) => ipcRenderer.invoke("gallery:delete", id),
    update: (id: string, patch: unknown) => ipcRenderer.invoke("gallery:update", id, patch),
    bulk: (input: unknown) => ipcRenderer.invoke("gallery:bulk", input),
    exportZip: (ids: string[]) => ipcRenderer.invoke("gallery:exportZip", ids),
    loadImage: (id: string) => ipcRenderer.invoke("gallery:loadImage", id)
  },
  projects: { create: (name: string) => ipcRenderer.invoke("projects:create", name), rename: (id: string, name: string) => ipcRenderer.invoke("projects:rename", id, name), delete: (id: string) => ipcRenderer.invoke("projects:delete", id), setCover: (projectId: string, itemId: string) => ipcRenderer.invoke("projects:setCover", projectId, itemId) },
  templates: {
    list: () => ipcRenderer.invoke("templates:list"),
    save: (input: unknown) => ipcRenderer.invoke("templates:save", input),
    delete: (id: string) => ipcRenderer.invoke("templates:delete", id)
  },
  onQueueUpdate: (callback: (event: unknown) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on("queue:update", listener); return () => ipcRenderer.removeListener("queue:update", listener); },
  onQueueResult: (callback: (event: unknown) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on("queue:result", listener); return () => ipcRenderer.removeListener("queue:result", listener); },
  onQueueError: (callback: (event: unknown) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on("queue:error", listener); return () => ipcRenderer.removeListener("queue:error", listener); },
  onProgress: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("image:progress", listener);
    return () => ipcRenderer.removeListener("image:progress", listener);
  },
  onUpdateStatus: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  onLocalAIModelProgress: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("localAI:modelProgress", listener);
    return () => ipcRenderer.removeListener("localAI:modelProgress", listener);
  },
});
