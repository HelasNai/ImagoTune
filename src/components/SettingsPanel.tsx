import React, { useEffect, useState } from "react";
import { useStudio } from "./StudioContext";

export function SettingsPanel({
  onSaveDirChanged,
  onOpenTutorial,
}: {
  onSaveDirChanged: () => Promise<void>;
  onOpenTutorial: () => void;
}) {
  const { setError, setNotice, configured, setConfigured, imageModel, setImageModel, chatModel, setChatModel, autoArchive, setAutoArchive } = useStudio();

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ phase: "idle", message: "尚未检查更新" });
  const [zoomFactor, setZoomFactor] = useState(1);

  useEffect(() => {
    void window.imageStudio.settings.get().then((value) => {
      setBaseUrl(value.baseUrl);
      setSaveDir(value.saveDir || "");
    });
    void window.imageStudio.updates.get().then((value) => {
      setUpdateChannel(value.channel);
      setAutoUpdate(value.autoUpdate);
      setAppVersion(value.appVersion);
      setUpdateStatus(value.status);
    });
    void window.imageStudio.windowControls.getZoom().then((r) => {
      if (r.ok && typeof r.factor === "number") setZoomFactor(r.factor);
    });
    return window.imageStudio.onUpdateStatus((value) => setUpdateStatus(value));
  }, []);

  const applyZoom = (next: number) => {
    void window.imageStudio.windowControls.setZoom(next).then((r) => {
      if (r.ok && typeof r.factor === "number") setZoomFactor(r.factor);
    });
  };

  const saveSettings = async () => {
    if (!baseUrl.trim()) {
      setError("请输入 API Base URL");
      return;
    }
    try { new URL(baseUrl.trim()); } catch { setError("API Base URL 格式无效"); return; }
    if (!apiKey.trim() && !configured) {
      setError("请输入 API 密钥");
      return;
    }
    if (!imageModel.trim()) {
      setError("请输入图片模型名称");
      return;
    }
    if (!chatModel.trim()) {
      setError("请输入聊天模型名称");
      return;
    }
    await window.imageStudio.settings.save({ apiKey, baseUrl, imageModel, chatModel, autoArchive });
    setConfigured(true);
    setApiKey("");
    setNotice("设置已保存，密钥不会显示在界面中");
  };

  const chooseSaveDirectory = async () => {
    const result = await window.imageStudio.settings.chooseSaveDir();
    if (!result.ok) {
      setError(result.error || "无法修改保存位置");
      return;
    }
    if (result.canceled || !result.saveDir) return;
    setSaveDir(result.saveDir);
    await onSaveDirChanged();
    setNotice("保存位置已切换；原目录文件不会移动或删除");
  };

  const resetSaveDirectory = async () => {
    const result = await window.imageStudio.settings.resetSaveDir();
    if (!result.ok || !result.saveDir) {
      setError(result.error || "无法恢复系统默认保存位置");
      return;
    }
    setSaveDir(result.saveDir);
    await onSaveDirChanged();
    setNotice("已恢复系统“图片”文件夹中的默认保存位置");
  };

  const openSaveDirectory = async () => {
    const result = await window.imageStudio.settings.openSaveDir();
    if (!result.ok) setError(result.error || "无法打开保存位置");
  };

  const testSettings = async () => {
    setTestMessage("测试中…");
    const result = await window.imageStudio.settings.test();
    setTestMessage(result.message);
  };

  const setUpdateChannelPreference = async (channel: UpdateChannel) => {
    const previous = updateChannel;
    setUpdateChannel(channel);
    const result = await window.imageStudio.updates.setChannel(channel);
    if (!result.ok) {
      setUpdateChannel(previous);
      setError("无法保存更新渠道设置");
    }
  };

  const setAutoUpdatePreference = async (enabled: boolean) => {
    setAutoUpdate(enabled);
    const result = await window.imageStudio.updates.setAutoUpdate(enabled);
    if (!result.ok) {
      setAutoUpdate(!enabled);
      setError("无法保存自动更新设置");
    }
  };

  const checkUpdates = async () => {
    setUpdateStatus((current) => ({ ...current, phase: "checking", message: "正在检查更新…" }));
    const result = await window.imageStudio.updates.check();
    if (!result.ok) setUpdateStatus((current) => ({ ...current, phase: "error", message: result.message }));
  };

  const downloadUpdate = async () => {
    const result = await window.imageStudio.updates.download();
    if (!result.ok) setError(result.message);
  };

  const installUpdate = async () => {
    const result = await window.imageStudio.updates.install();
    if (!result.ok) setError(result.message);
  };

  return (
    <section className="card settings" data-tutorial="connection-settings">
      <span className="eyebrow">CONNECTION & STORAGE</span>
      <h2>连接设置</h2>
      <p className="muted">
        支持符合当前请求格式的 OpenAI 兼容接口。API 密钥仅保存到 Windows 凭据库，不会显示原文或写入项目文件。
      </p>
      <label>API Base URL<input placeholder="例如：https://api.example.com/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label>API 密钥
        <input
          type="password"
          placeholder={configured ? "已保存，输入新值可覆盖" : "粘贴当前平台提供的 API 密钥"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <div className="settings-models">
        <label>图片模型<input placeholder="平台提供的图片模型名称" value={imageModel} onChange={(event) => setImageModel(event.target.value)} /></label>
        <label>聊天模型<input placeholder="用于提示词增强和图反推" value={chatModel} onChange={(event) => setChatModel(event.target.value)} /></label>
      </div>
      <label className="archive-toggle">
        <input type="checkbox" checked={autoArchive} onChange={(event) => setAutoArchive(event.target.checked)} />
        自动归档生成图片到本地图库与收件箱
      </label>
      {saveDir && <div className="storage-path">
        <div className="storage-head">
          <strong>本地保存位置</strong>
          <div className="storage-actions">
            <button type="button" onClick={() => void chooseSaveDirectory()}>选择文件夹</button>
            <button type="button" onClick={() => void openSaveDirectory()}>打开目录</button>
            <button type="button" onClick={() => void resetSaveDirectory()}>恢复默认</button>
          </div>
        </div>
        <code>{saveDir}</code>
        <small>新图片、自动图库和导出文件将使用此位置；切换目录不会移动或删除原目录中的文件。</small>
      </div>}
      <section className="update-settings">
        <div>
          <span className="eyebrow">APPLICATION UPDATE</span>
          <h3>软件更新</h3>
          <p>当前版本：v{appVersion || "—"}。开启自动更新后会在后台检查并下载新版本，安装前仍会询问，不会强制重启；关闭后仅在你手动检查时提示下载。</p>
        </div>
        <div className="update-channel">
          <span className="update-channel-label">更新渠道</span>
          <div className="update-channel-options">
            <button type="button" className={updateChannel === "stable" ? "active" : ""} onClick={() => void setUpdateChannelPreference("stable")}>正式版</button>
            <button type="button" className={updateChannel === "beta" ? "active" : ""} onClick={() => void setUpdateChannelPreference("beta")}>测试版 Beta</button>
          </div>
        </div>
        <label className="archive-toggle">
          <input type="checkbox" checked={autoUpdate} onChange={(event) => void setAutoUpdatePreference(event.target.checked)} />
          自动检查并在后台下载更新（安装前询问）
        </label>
        <div className="update-actions">
          <button className="secondary" onClick={() => void checkUpdates()} disabled={updateStatus.phase === "checking"}>
            {updateStatus.phase === "checking" ? "检查中…" : "检查更新"}
          </button>
          {updateStatus.phase === "available" && <button className="primary" onClick={() => void downloadUpdate()}>下载 v{updateStatus.version}</button>}
          {updateStatus.phase === "downloading" && <span className="update-progress">下载中 {updateStatus.progress || 0}%</span>}
          {updateStatus.phase === "downloaded" && <button className="primary" onClick={() => void installUpdate()}>重启并安装 v{updateStatus.version}</button>}
        </div>
        <p className={updateStatus.phase === "error" ? "update-status error-text" : "update-status"}>{updateStatus.message}</p>
      </section>
      <section className="update-settings">
        <div>
          <span className="eyebrow">INTERFACE ZOOM</span>
          <h3>界面缩放</h3>
          <p>调整整个界面的缩放比例，当前缩放：{Math.round(zoomFactor * 100)}%。范围为 50%–200%。</p>
        </div>
        <div className="update-actions">
          <button type="button" className="secondary" onClick={() => applyZoom(Math.max(0.5, Number((zoomFactor - 0.1).toFixed(2))))}>缩小</button>
          <button type="button" className="secondary" onClick={() => applyZoom(1)}>重置</button>
          <button type="button" className="secondary" onClick={() => applyZoom(Math.min(2, Number((zoomFactor + 0.1).toFixed(2))))}>放大</button>
        </div>
      </section>
      <section className="update-settings">
        <div>
          <span className="eyebrow">ABOUT & HELP</span>
          <h3>关于与帮助</h3>
          <p>本地 OpenAI 兼容图片创作工具，支持自定义基础地址、模型、文生图、图片编辑和常用输出尺寸。</p>
          <p>Copyright (C) 2026 zztnbnb。本项目以 GNU Affero General Public License v3.0 only 发布，不提供任何担保。</p>
        </div>
        <div className="update-actions">
          <button type="button" className="secondary" onClick={onOpenTutorial}>打开新手教程</button>
          <a href="https://github.com/zztnbnb/image-studio/blob/main/LICENSE" target="_blank" rel="noreferrer" className="secondary">查看许可证与源代码</a>
        </div>
      </section>
      <div className="actions">
        <button className="primary" onClick={() => void saveSettings()}>保存设置</button>
        <button className="secondary" onClick={() => void testSettings()}>测试连接</button>
      </div>
      {testMessage && <p className="hint">{testMessage}</p>}
    </section>
  );
}
