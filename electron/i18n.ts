/**
 * 主进程原生面小词典（T11）。
 *
 * 纯模块：只做「模块级 locale 单例 + 查表 + {param} 插值」，不含 IPC / DOM / electron 依赖，
 * 可被 vitest 直接导入。渲染层词典在 `src/lib/i18n/`，二者互不 import（主进程文案只服务
 * Electron 原生面：updater 弹窗、原生保存对话框过滤器、目录选择对话框标题、失败兜底）。
 *
 * 与渲染层的分工：`update:status` 的机器码经 `UpdateStatus.code` 下发，`message` 由本模块
 * 按当前主进程 locale 生成（旧渲染层直接显示 message、新渲染层可按 code 经 tCode 覆盖）。
 */

export type MainLocale = "zh" | "en";

/** 词典条目：zh 为当前真实中文原文，en 遵循 GLOSSARY 写作规范。 */
type Entry = { zh: string; en: string };

const DICTIONARY: Record<string, Entry> = {
  // —— 更新状态 message（publishUpdateStatus 直接下发）——
  "update.idle": { zh: "尚未检查更新", en: "No update check yet" },
  "update.checking": { zh: "正在检查更新…", en: "Checking for updates…" },
  "update.check-done": { zh: "已完成更新检查。", en: "Update check complete." },
  "update.check-failed": { zh: "检查更新失败", en: "Update check failed" },
  "update.available": { zh: "发现新版本 v{version}", en: "New version v{version} available" },
  "update.not-available": { zh: "当前已是最新版本。", en: "You're on the latest version." },
  "update.downloading": { zh: "正在下载更新…", en: "Downloading update…" },
  "update.downloading-progress": { zh: "正在下载更新：{percent}%", en: "Downloading update: {percent}%" },
  "update.downloaded": { zh: "v{version} 已下载，等待安装。", en: "v{version} downloaded, ready to install." },
  "update.download-in-flight": { zh: "更新正在下载。", en: "Update is downloading." },
  "update.download-done": { zh: "更新下载完成。", en: "Update downloaded." },
  "update.download-failed": { zh: "更新下载失败", en: "Update download failed" },
  "update.error": { zh: "更新服务发生错误", en: "Update service error" },
  "update.dev-mode": { zh: "开发模式不检查更新，请使用安装版测试。", en: "Update checks are disabled in development. Use a packaged build to test." },
  "update.install-dev-mode": { zh: "开发模式不支持安装更新。", en: "Installing updates is not supported in development." },
  "update.install-not-ready": { zh: "尚未下载可安装的更新。", en: "No downloaded update is ready to install." },
  "update.installing": { zh: "正在重启并安装更新。", en: "Restarting to install the update." },

  // —— 更新弹窗（dialog.showMessageBox）——
  "update.dialog.available.title": { zh: "发现新版本", en: "Update available" },
  "update.dialog.available.message": { zh: "ImagoTune {version} 已可更新", en: "ImagoTune {version} is available" },
  "update.dialog.available.detail": { zh: "是否现在下载？下载完成后仍由你选择是否重启安装。", en: "Download now? You'll still choose whether to restart and install." },
  "update.dialog.available.later": { zh: "稍后再说", en: "Later" },
  "update.dialog.available.download": { zh: "下载更新", en: "Download update" },
  "update.dialog.downloaded.title": { zh: "更新已下载", en: "Update downloaded" },
  "update.dialog.downloaded.message": { zh: "ImagoTune {version} 已准备好", en: "ImagoTune {version} is ready" },
  "update.dialog.downloaded.detail": { zh: "是否现在重启并安装？你也可以稍后在“设置”中执行安装。", en: "Restart and install now? You can also install later from Settings." },
  "update.dialog.downloaded.later": { zh: "稍后安装", en: "Install later" },
  "update.dialog.downloaded.install": { zh: "重启并安装", en: "Restart and install" },

  // —— 原生保存对话框过滤器 ——
  "filter.png": { zh: "PNG 图片", en: "PNG image" },
  "filter.zip": { zh: "ZIP 文件", en: "ZIP archive" },

  // —— 目录选择对话框标题 ——
  "dialog.chooseSaveDir": { zh: "选择 ImagoTune 保存位置", en: "Choose ImagoTune save location" },
  "dialog.chooseModelDir": { zh: "选择本地 AI 模型保存位置", en: "Choose local AI model location" },

  // —— 通用失败兜底 ——
  "common.failure": { zh: "操作失败", en: "Operation failed" },
};

/** 模块级 locale 单例；初始 zh，启动时由 main.ts 依配置/系统语言覆盖。 */
let mainLocale: MainLocale = "zh";

export function setMainLocale(locale: MainLocale): void {
  mainLocale = locale;
}

export function getMainLocale(): MainLocale {
  return mainLocale;
}

/**
 * 主进程文案查表。可选 `params` 做 `{name}` 插值（缺失参数保留占位符原文）。
 * 未注册 key：返回 key 本身并 console.warn，绝不抛错。
 */
export function mt(key: string, params?: Record<string, string | number>): string {
  const entry = DICTIONARY[key];
  if (!entry) {
    console.warn(`[i18n] 缺少主进程词条：${key}`);
    return key;
  }
  return interpolate(entry[mainLocale], params);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
