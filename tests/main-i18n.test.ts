import { afterEach, describe, expect, it, vi } from "vitest";
import { getMainLocale, mt, setMainLocale } from "../electron/i18n";

// 模块级 locale 单例在测试间共享：每个用例结束复位为默认中文，避免相互污染。
afterEach(() => {
  setMainLocale("zh");
  vi.restoreAllMocks();
});

describe("electron/i18n mt", () => {
  it("默认 locale 为 zh，mt 返回当前中文原文", () => {
    expect(getMainLocale()).toBe("zh");
    expect(mt("update.idle")).toBe("尚未检查更新");
    expect(mt("update.checking")).toBe("正在检查更新…");
  });

  it("setMainLocale 切换单例：en 返回英文，可切回 zh", () => {
    setMainLocale("en");
    expect(getMainLocale()).toBe("en");
    expect(mt("update.idle")).toBe("No update check yet");
    expect(mt("update.checking")).toBe("Checking for updates…");

    setMainLocale("zh");
    expect(getMainLocale()).toBe("zh");
    expect(mt("update.idle")).toBe("尚未检查更新");
  });

  it("updater 状态 key 中英对照（spot coverage）", () => {
    const cases: Array<[string, string, string]> = [
      ["update.check-done", "已完成更新检查。", "Update check complete."],
      ["update.check-failed", "检查更新失败", "Update check failed"],
      ["update.not-available", "当前已是最新版本。", "You're on the latest version."],
      ["update.downloading", "正在下载更新…", "Downloading update…"],
      ["update.download-done", "更新下载完成。", "Update downloaded."],
      ["update.download-failed", "更新下载失败", "Update download failed"],
      ["update.install-dev-mode", "开发模式不支持安装更新。", "Installing updates is not supported in development."],
      ["update.install-not-ready", "尚未下载可安装的更新。", "No downloaded update is ready to install."],
      ["update.installing", "正在重启并安装更新。", "Restarting to install the update."],
    ];
    setMainLocale("zh");
    for (const [key, zh] of cases) expect(mt(key)).toBe(zh);
    setMainLocale("en");
    for (const [key, , en] of cases) expect(mt(key)).toBe(en);
  });

  it("updater 弹窗标题 / 按钮 key 双语", () => {
    setMainLocale("zh");
    expect(mt("update.dialog.available.title")).toBe("发现新版本");
    expect(mt("update.dialog.available.later")).toBe("稍后再说");
    expect(mt("update.dialog.available.download")).toBe("下载更新");
    expect(mt("update.dialog.downloaded.title")).toBe("更新已下载");
    expect(mt("update.dialog.downloaded.install")).toBe("重启并安装");

    setMainLocale("en");
    expect(mt("update.dialog.available.title")).toBe("Update available");
    expect(mt("update.dialog.available.later")).toBe("Later");
    expect(mt("update.dialog.available.download")).toBe("Download update");
    expect(mt("update.dialog.downloaded.title")).toBe("Update downloaded");
    expect(mt("update.dialog.downloaded.install")).toBe("Restart and install");
  });

  it("保存过滤器与目录对话框标题 key 双语", () => {
    setMainLocale("zh");
    expect(mt("filter.png")).toBe("PNG 图片");
    expect(mt("filter.zip")).toBe("ZIP 文件");
    expect(mt("dialog.chooseSaveDir")).toBe("选择 ImagoTune 保存位置");
    expect(mt("dialog.chooseModelDir")).toBe("选择本地 AI 模型保存位置");

    setMainLocale("en");
    expect(mt("filter.png")).toBe("PNG image");
    expect(mt("filter.zip")).toBe("ZIP archive");
    expect(mt("dialog.chooseSaveDir")).toBe("Choose ImagoTune save location");
    expect(mt("dialog.chooseModelDir")).toBe("Choose local AI model location");
  });

  it("params 插值：zh 与 en 都完成 {version}/{percent} 替换", () => {
    expect(mt("update.available", { version: "1.2.3" })).toBe("发现新版本 v1.2.3");
    expect(mt("update.downloading-progress", { percent: 42 })).toBe("正在下载更新：42%");

    setMainLocale("en");
    expect(mt("update.available", { version: "1.2.3" })).toBe("New version v1.2.3 available");
    expect(mt("update.downloaded", { version: "1.2.3" })).toBe("v1.2.3 downloaded, ready to install.");
    expect(mt("update.downloading-progress", { percent: 42 })).toBe("Downloading update: 42%");
  });

  it("缺失参数：保留占位符原文，绝不出现 undefined", () => {
    const text = mt("update.available");
    expect(text).toBe("发现新版本 v{version}");
    expect(text).not.toContain("undefined");
  });

  it("未注册 key：返回 key 本身 + warn，绝不抛错", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => mt("does.not.exist")).not.toThrow();
    expect(mt("does.not.exist")).toBe("does.not.exist");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does.not.exist"));
  });
});
