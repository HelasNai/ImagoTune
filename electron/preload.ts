import { contextBridge, ipcRenderer } from "electron";
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
  TUTORIAL_OPEN, UPDATES_CHECK, UPDATES_DOWNLOAD, UPDATES_GET, UPDATES_INSTALL,
  UPDATES_SET_ALPHA_UNLOCKED, UPDATES_SET_AUTO_UPDATE, UPDATES_SET_CHANNEL, UPDATE_STATUS,
  WINDOW_CLOSE, WINDOW_GET_ZOOM, WINDOW_IS_MAXIMIZED, WINDOW_MAXIMIZED_CHANGED, WINDOW_MINIMIZE,
  WINDOW_SET_ZOOM, WINDOW_TOGGLE_MAXIMIZE,
} from "./channels";

contextBridge.exposeInMainWorld("imageStudio", {
  settings: {
    get: () => ipcRenderer.invoke(SETTINGS_GET),
    save: (input: { apiKey: string; baseUrl: string; imageModel: string; chatModel: string; autoArchive?: boolean }) => ipcRenderer.invoke(SETTINGS_SAVE, input),
    chooseSaveDir: () => ipcRenderer.invoke(SETTINGS_CHOOSE_SAVE_DIR),
    resetSaveDir: () => ipcRenderer.invoke(SETTINGS_RESET_SAVE_DIR),
    openSaveDir: () => ipcRenderer.invoke(SETTINGS_OPEN_SAVE_DIR),
    clear: () => ipcRenderer.invoke(SETTINGS_CLEAR),
    test: () => ipcRenderer.invoke(SETTINGS_TEST)
  },
  updates: {
    get: () => ipcRenderer.invoke(UPDATES_GET),
    setChannel: (channel: string) => ipcRenderer.invoke(UPDATES_SET_CHANNEL, channel),
    setAlphaUnlocked: (enabled: boolean) => ipcRenderer.invoke(UPDATES_SET_ALPHA_UNLOCKED, enabled),
    setAutoUpdate: (enabled: boolean) => ipcRenderer.invoke(UPDATES_SET_AUTO_UPDATE, enabled),
    check: () => ipcRenderer.invoke(UPDATES_CHECK),
    download: () => ipcRenderer.invoke(UPDATES_DOWNLOAD),
    install: () => ipcRenderer.invoke(UPDATES_INSTALL)
  },
  generate: (input: unknown) => ipcRenderer.invoke(IMAGE_GENERATE, input),
  edit: (input: unknown) => ipcRenderer.invoke(IMAGE_EDIT, input),
  cancel: (requestId: string) => ipcRenderer.invoke(IMAGE_CANCEL, requestId),
  saveImage: (input: { dataUrl: string; suggestedName: string; recipe?: unknown }) => ipcRenderer.invoke(IMAGE_SAVE, input),
  prompt: {
    enhance: (input: { prompt: string; mode: "generate" | "edit" }) => ipcRenderer.invoke(PROMPT_ENHANCE, input),
    reverse: (input: unknown) => ipcRenderer.invoke(PROMPT_REVERSE, input)
  },
  outpaint: { prepare: (input: unknown) => ipcRenderer.invoke(OUTPAINT_PREPARE, input) },
  localAI: {
    capabilities: () => ipcRenderer.invoke(LOCAL_AI_CAPABILITIES),
    models: () => ipcRenderer.invoke(LOCAL_AI_MODELS),
    chooseModelDir: () => ipcRenderer.invoke(LOCAL_AI_CHOOSE_MODEL_DIR),
    resetModelDir: () => ipcRenderer.invoke(LOCAL_AI_RESET_MODEL_DIR),
    openModelDir: () => ipcRenderer.invoke(LOCAL_AI_OPEN_MODEL_DIR),
    modelUrl: (id: string) => ipcRenderer.invoke(LOCAL_AI_MODEL_URL, id),
    downloadModel: (id: string) => ipcRenderer.invoke(LOCAL_AI_DOWNLOAD_MODEL, id),
    pauseDownload: (id: string) => ipcRenderer.invoke(LOCAL_AI_PAUSE_DOWNLOAD, id),
    deleteModel: (id: string) => ipcRenderer.invoke(LOCAL_AI_DELETE_MODEL, id),
    archiveResult: (input: unknown) => ipcRenderer.invoke(LOCAL_AI_ARCHIVE_RESULT, input),
  },
  png: { readRecipe: (input: unknown) => ipcRenderer.invoke(PNG_READ_RECIPE, input) },
  queue: {
    list: () => ipcRenderer.invoke(QUEUE_LIST),
    enqueue: (input: { kind: "generate" | "edit"; payload: unknown }) => ipcRenderer.invoke(QUEUE_ENQUEUE, input),
    retry: (id: string) => ipcRenderer.invoke(QUEUE_RETRY, id),
    cancel: (id: string) => ipcRenderer.invoke(QUEUE_CANCEL, id),
    remove: (id: string) => ipcRenderer.invoke(QUEUE_REMOVE, id)
  },
  clipboard: {
    copyText: (value: string) => ipcRenderer.invoke(CLIPBOARD_COPY_TEXT, value),
    copyImage: (b64: string) => ipcRenderer.invoke(CLIPBOARD_COPY_IMAGE, b64),
    readImage: () => ipcRenderer.invoke(CLIPBOARD_READ_IMAGE),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke(WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.invoke(WINDOW_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.invoke(WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(WINDOW_IS_MAXIMIZED),
    getZoom: () => ipcRenderer.invoke(WINDOW_GET_ZOOM),
    setZoom: (factor: number) => ipcRenderer.invoke(WINDOW_SET_ZOOM, factor),
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const channel = WINDOW_MAXIMIZED_CHANGED;
      const listener = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  gallery: {
    list: (input?: unknown) => ipcRenderer.invoke(GALLERY_LIST, input || {}),
    workspace: () => ipcRenderer.invoke(GALLERY_WORKSPACE),
    search: (input?: unknown) => ipcRenderer.invoke(GALLERY_SEARCH, input || {}),
    thumbnail: (id: string) => ipcRenderer.invoke(GALLERY_THUMBNAIL, id),
    toggleFavorite: (id: string) => ipcRenderer.invoke(GALLERY_TOGGLE_FAVORITE, id),
    delete: (id: string) => ipcRenderer.invoke(GALLERY_DELETE, id),
    update: (id: string, patch: unknown) => ipcRenderer.invoke(GALLERY_UPDATE, id, patch),
    bulk: (input: unknown) => ipcRenderer.invoke(GALLERY_BULK, input),
    exportZip: (ids: string[]) => ipcRenderer.invoke(GALLERY_EXPORT_ZIP, ids),
    loadImage: (id: string) => ipcRenderer.invoke(GALLERY_LOAD_IMAGE, id)
  },
  projects: { create: (name: string) => ipcRenderer.invoke(PROJECTS_CREATE, name), rename: (id: string, name: string) => ipcRenderer.invoke(PROJECTS_RENAME, id, name), delete: (id: string) => ipcRenderer.invoke(PROJECTS_DELETE, id), setCover: (projectId: string, itemId: string) => ipcRenderer.invoke(PROJECTS_SET_COVER, projectId, itemId) },
  templates: {
    list: () => ipcRenderer.invoke(TEMPLATES_LIST),
    save: (input: unknown) => ipcRenderer.invoke(TEMPLATES_SAVE, input),
    delete: (id: string) => ipcRenderer.invoke(TEMPLATES_DELETE, id)
  },
  onQueueUpdate: (callback: (event: unknown) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on(QUEUE_UPDATE, listener); return () => ipcRenderer.removeListener(QUEUE_UPDATE, listener); },
  onQueueResult: (callback: (event: unknown) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on(QUEUE_RESULT, listener); return () => ipcRenderer.removeListener(QUEUE_RESULT, listener); },
  onQueueError: (callback: (event: unknown) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on(QUEUE_ERROR, listener); return () => ipcRenderer.removeListener(QUEUE_ERROR, listener); },
  onProgress: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on(IMAGE_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IMAGE_PROGRESS, listener);
  },
  onUpdateStatus: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on(UPDATE_STATUS, listener);
    return () => ipcRenderer.removeListener(UPDATE_STATUS, listener);
  },
  onLocalAIModelProgress: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on(LOCAL_AI_MODEL_PROGRESS, listener);
    return () => ipcRenderer.removeListener(LOCAL_AI_MODEL_PROGRESS, listener);
  },
  onTutorialOpen: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(TUTORIAL_OPEN, listener);
    return () => ipcRenderer.removeListener(TUTORIAL_OPEN, listener);
  },
});
