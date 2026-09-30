// IPC 通道名常量（单一来源）。main.ts 的 ipcMain.handle 与 webContents.send、
// preload.ts 的 ipcRenderer.invoke/on 均引用此处，避免两端字符串失联。
// 通道字符串本身不得改动——它们是对外契约。

// —— invoke：设置 ——
export const SETTINGS_GET = "settings:get";
export const SETTINGS_SAVE = "settings:save";
export const SETTINGS_CHOOSE_SAVE_DIR = "settings:chooseSaveDir";
export const SETTINGS_RESET_SAVE_DIR = "settings:resetSaveDir";
export const SETTINGS_OPEN_SAVE_DIR = "settings:openSaveDir";
export const SETTINGS_CLEAR = "settings:clear";
export const SETTINGS_TEST = "settings:test";

// —— invoke：窗口控制 ——
export const WINDOW_MINIMIZE = "window:minimize";
export const WINDOW_TOGGLE_MAXIMIZE = "window:toggleMaximize";
export const WINDOW_CLOSE = "window:close";
export const WINDOW_IS_MAXIMIZED = "window:isMaximized";
export const WINDOW_GET_ZOOM = "window:getZoom";
export const WINDOW_SET_ZOOM = "window:setZoom";

// —— invoke：更新 ——
export const UPDATES_GET = "updates:get";
export const UPDATES_SET_CHANNEL = "updates:setChannel";
export const UPDATES_SET_ALPHA_UNLOCKED = "updates:setAlphaUnlocked";
export const UPDATES_SET_AUTO_UPDATE = "updates:setAutoUpdate";
export const UPDATES_CHECK = "updates:check";
export const UPDATES_DOWNLOAD = "updates:download";
export const UPDATES_INSTALL = "updates:install";

// —— invoke：图片生成 ——
export const IMAGE_GENERATE = "image:generate";
export const IMAGE_EDIT = "image:edit";
export const IMAGE_CANCEL = "image:cancel";
export const IMAGE_SAVE = "image:save";

// —— invoke：提示词与扩图 ——
export const PROMPT_ENHANCE = "prompt:enhance";
export const PROMPT_REVERSE = "prompt:reverse";
export const OUTPAINT_PREPARE = "outpaint:prepare";

// —— invoke：本地 AI ——
export const LOCAL_AI_CAPABILITIES = "localAI:capabilities";
export const LOCAL_AI_MODELS = "localAI:models";
export const LOCAL_AI_CHOOSE_MODEL_DIR = "localAI:chooseModelDir";
export const LOCAL_AI_RESET_MODEL_DIR = "localAI:resetModelDir";
export const LOCAL_AI_OPEN_MODEL_DIR = "localAI:openModelDir";
export const LOCAL_AI_MODEL_URL = "localAI:modelUrl";
export const LOCAL_AI_DOWNLOAD_MODEL = "localAI:downloadModel";
export const LOCAL_AI_PAUSE_DOWNLOAD = "localAI:pauseDownload";
export const LOCAL_AI_DELETE_MODEL = "localAI:deleteModel";
export const LOCAL_AI_ARCHIVE_RESULT = "localAI:archiveResult";

// —— invoke：PNG 配方 ——
export const PNG_READ_RECIPE = "png:readRecipe";

// —— invoke：队列 ——
export const QUEUE_LIST = "queue:list";
export const QUEUE_ENQUEUE = "queue:enqueue";
export const QUEUE_RETRY = "queue:retry";
export const QUEUE_CANCEL = "queue:cancel";
export const QUEUE_REMOVE = "queue:remove";

// —— invoke：剪贴板 ——
export const CLIPBOARD_COPY_TEXT = "clipboard:copyText";
export const CLIPBOARD_COPY_IMAGE = "clipboard:copyImage";
export const CLIPBOARD_READ_IMAGE = "clipboard:readImage";

// —— invoke：图库 ——
export const GALLERY_LIST = "gallery:list";
export const GALLERY_WORKSPACE = "gallery:workspace";
export const GALLERY_SEARCH = "gallery:search";
export const GALLERY_THUMBNAIL = "gallery:thumbnail";
export const GALLERY_TOGGLE_FAVORITE = "gallery:toggleFavorite";
export const GALLERY_DELETE = "gallery:delete";
export const GALLERY_UPDATE = "gallery:update";
export const GALLERY_BULK = "gallery:bulk";
export const GALLERY_EXPORT_ZIP = "gallery:exportZip";
export const GALLERY_LOAD_IMAGE = "gallery:loadImage";

// —— invoke：项目 ——
export const PROJECTS_CREATE = "projects:create";
export const PROJECTS_RENAME = "projects:rename";
export const PROJECTS_DELETE = "projects:delete";
export const PROJECTS_SET_COVER = "projects:setCover";

// —— invoke：模板 ——
export const TEMPLATES_LIST = "templates:list";
export const TEMPLATES_SAVE = "templates:save";
export const TEMPLATES_DELETE = "templates:delete";

// —— push：主进程 -> 渲染进程 ——
export const WINDOW_MAXIMIZED_CHANGED = "window:maximized-changed";
export const IMAGE_PROGRESS = "image:progress";
export const QUEUE_UPDATE = "queue:update";
export const QUEUE_RESULT = "queue:result";
export const QUEUE_ERROR = "queue:error";
export const UPDATE_STATUS = "update:status";
export const LOCAL_AI_MODEL_PROGRESS = "localAI:modelProgress";
export const PROGRESS_UPDATE = "progress:update";
export const TUTORIAL_OPEN = "tutorial:open";
