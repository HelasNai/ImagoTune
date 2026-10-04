// settings 分片：设置页与 settings:test 返回码（test.* 前缀归本域）。
// key = 中文文案（重复串加 `|语境` 后缀消歧）；value = 英文（复数用 `one|other` 分段）。
// 「自定义|设置」刻意带语境后缀：`自定义` 的裸 key 由 T30（en/composer.ts，模板分类）预留，避免跨分片重复。
export const settings = {
  // --- 既有：角色标签 / 保存按钮（T8 建立，供 role-options 复用） ---
  保存设置: "Save settings",
  生图: "Image generation",
  图反推: "Reverse prompt",
  提示词增强: "Prompt enhance",
  "⚠ 已删除的供应商": "⚠ Deleted provider",
  "⚠ 未标注": "⚠ Not annotated",

  // --- 区块标题 ---
  "连接设置": "Connection settings",
  "供应商": "Providers",
  "模型分配": "Model assignment",
  "语言 / Language": "Language",
  "软件更新": "Software updates",
  "界面缩放": "Interface zoom",
  "关于与帮助": "About & help",

  // --- 连接设置说明 ---
  "支持添加多个符合当前请求格式的 OpenAI 兼容服务，并可为生图、图反推与提示词增强分别绑定模型。API 密钥仅保存到 Windows 凭据库，不会显示原文或写入项目文件。":
    "Add multiple OpenAI-compatible services that match the current request format, and bind a model to image generation, reverse prompt, and prompt enhance separately. API keys are stored only in the Windows Credential Manager; they are never displayed or written to project files.",

  // --- 供应商：添加卡片 ---
  "+ 添加供应商": "+ Add provider",
  "添加方式": "Add method",
  "预设平台": "Preset platform",
  "自定义|设置": "Custom",
  "平台": "Platform",
  "选择平台": "Select a platform",
  "API 密钥": "API key",
  "粘贴 API 密钥（可留空，稍后填写）": "Paste the API key (optional; you can add it later)",
  "粘贴当前平台提供的 API 密钥": "Paste the API key provided by the current platform",
  "例如：主力平台": "e.g. Main platform",
  "例如：https://api.example.com/v1": "e.g. https://api.example.com/v1",
  "名称": "Name",
  "添加": "Add",
  "尚未添加供应商。": "No providers added yet.",

  // --- 供应商卡片 ---
  "已保存密钥": "Key saved",
  "缺少密钥": "No key",
  "编辑": "Edit",
  "测试连接": "Test connection",
  "测试连接与刷新模型不会保存任何数据：未保存的新密钥只用于当次请求，不写入凭据库。":
    "Testing the connection and refreshing models saves no data: an unsaved new key is used only for that one request and is not written to the credential manager.",
  "刷新模型": "Refresh models",
  "模型": "Models",
  "删除|供应商": "Delete",
  "{n} 个模型": "{n} model|{n} models",
  "{n} 个模型 · 更新于 {time}": "{n} model · Updated {time}|{n} models · Updated {time}",

  // --- 模型角色面板 ---
  "搜索模型": "Search models",
  "自定义模型": "Custom model",
  "批量（作用于搜索结果）：": "Bulk (applies to current search results):",
  "设为 {role}": "Set as {role}",
  "清除 {role}": "Clear {role}",
  "无匹配模型": "No matching models",
  "已下线": "Unavailable",
  "完成": "Done",
  "已保存，输入新值可覆盖": "Saved; enter a new value to overwrite",

  // --- 模型分配 ---
  "为生图、图反推、提示词增强分别选择供应商与模型；只显示已标注该角色的模型。":
    "Choose a provider and model for image generation, reverse prompt, and prompt enhance separately; only models annotated with that role are shown.",
  "{role}供应商": "{role} provider",
  "{role}模型": "{role} model",
  "未分配": "Unassigned",
  "选择模型": "Select a model",
  "清除": "Clear",

  // --- 归档与保存位置 ---
  "自动归档生成图片到本地图库与收件箱": "Auto-archive generated images to the local gallery and inbox",
  "本地保存位置": "Local save location",
  "新图片、自动图库和导出文件将使用此位置；切换目录不会移动或删除原目录中的文件。":
    "New images, the auto gallery, and exports use this location; switching folders does not move or delete files in the original folder.",
  "选择文件夹": "Choose folder",
  "打开目录": "Open folder",
  "恢复默认": "Restore default",

  // --- 软件更新 ---
  "尚未检查更新": "No update check yet",
  "当前版本：v{version}。": "Current version: v{version}.",
  "更新渠道": "Update channel",
  "正式版": "Stable",
  "测试版 Beta": "Beta",
  "Alpha 测试版": "Alpha",
  "退出内测": "Leave test channel",
  "开启自动更新后会在后台检查并下载新版本，安装前仍会询问，不会强制重启；关闭后仅在你手动检查时提示下载。":
    "When auto-update is on, new versions are checked and downloaded in the background; you are still asked before installing and nothing restarts automatically. When off, downloads are only offered when you check manually.",
  "自动检查并在后台下载更新（安装前询问）": "Check and download updates in the background (asks before installing)",
  "正在检查更新…": "Checking for updates…",
  "检查中…": "Checking…",
  "检查更新": "Check for updates",
  "检查更新失败": "Update check failed",
  "下载 v{version}": "Download v{version}",
  "下载中 {progress}%": "Downloading {progress}%",
  "重启并安装 v{version}": "Restart and install v{version}",

  // --- 界面缩放 ---
  "当前缩放：{n}%。": "Zoom: {n}%.",
  "调整整个界面的缩放比例，范围为 50%–200%。": "Adjust the zoom level of the whole interface, from 50% to 200%.",
  "缩小": "Zoom out",
  "重置": "Reset",
  "放大": "Zoom in",

  // --- 关于与帮助 ---
  "本地 OpenAI 兼容图片创作工具，支持自定义基础地址、模型、文生图、图片编辑和常用输出尺寸。":
    "A local OpenAI-compatible image creation tool with custom base URL, models, text-to-image, image editing, and common output sizes.",
  "Copyright (C) 2026 zztnbnb。本项目以 GNU Affero General Public License v3.0 only 发布，不提供任何担保。":
    "Copyright (C) 2026 zztnbnb. This project is released under the GNU Affero General Public License v3.0 only, without any warranty.",
  "打开新手教程": "Open tutorial",
  "查看许可证与源代码": "View license and source code",

  // --- 保存底栏 ---
  "保存中…": "Saving…",
  "正在保存…": "Saving…",
  "有未保存的更改": "Unsaved changes",
  "所有更改已保存": "All changes saved",

  // --- 校验错误 / 通知 / 对话框（逻辑层） ---
  "无法读取更新状态": "Could not read the update status",
  "请输入供应商名称": "Enter a provider name",
  "请输入 API Base URL": "Enter the API Base URL",
  "请选择预设平台": "Select a preset platform",
  "请先输入 API 密钥": "Enter the API key first",
  "测试中…": "Testing…",
  "刷新中…": "Refreshing…",
  "测试连接失败": "Connection test failed",
  "刷新模型失败": "Failed to refresh models",
  "已同步 {n} 个模型": "Synced {n} model|Synced {n} models",
  "输入模型名称；自定义模型在刷新后不会消失": "Enter a model name; custom models are kept after a refresh",
  "例如：my-model-v1": "e.g. my-model-v1",
  "模型已存在": "The model already exists",
  "删除自定义模型": "Delete custom model",
  "删除「{name}」？（不会影响已保存的绑定，失效绑定会在分配区标出）":
    "Delete “{name}”? (Saved bindings are unaffected; invalid bindings are flagged in the assignment section)",
  "删除供应商": "Delete provider",
  "删除「{name}」？保存后其密钥将从凭据库移除。":
    "Delete “{name}”? Its key will be removed from the credential manager after saving.",
  "请为「生图/图反推/提示词增强」选择模型": "Choose a model for Image generation / Reverse prompt / Prompt enhance",
  "设置保存失败": "Failed to save settings",
  "设置已保存，密钥不会显示在界面中": "Settings saved; keys are never shown in the interface",
  "无法修改保存位置": "Could not change the save location",
  "保存位置已切换；原目录文件不会移动或删除":
    "Save location changed; files in the original folder are not moved or deleted",
  "无法恢复系统默认保存位置": "Could not restore the system default save location",
  "已恢复系统“图片”文件夹中的默认保存位置": "Restored the default save location in the system Pictures folder",
  "无法打开保存位置": "Could not open the save location",
  "语言切换失败：{message}": "Failed to switch language: {message}",
  "请重试": "Please try again",
  "无法保存更新渠道设置": "Could not save the update channel setting",
  "无法保存自动更新设置": "Could not save the auto-update setting",
  "下载更新失败": "Failed to download the update",
  "安装更新失败": "Failed to install the update",
  "无法解锁 Alpha 测试渠道": "Could not unlock the Alpha test channel",
  "已解锁 Alpha 测试渠道": "Alpha test channel unlocked",
  "无法退出内测渠道": "Could not leave the test channel",
  "已退出内测渠道": "Left the test channel",

  // --- settings:test 语义码（T3；renderTestMessage 经 tCode("test", <裸码>) 消费） ---
  "test.ok": "Connection successful",
  "test.noProvider": "Provider not found",
  "test.notConfigured": "Not configured",
  "test.noKey": "No API key configured",
  "test.badBaseUrl": "Invalid API Base URL",
  "test.scheme": "API Base URL only supports http/https",
  "test.http": "Endpoint returned {status}",
  "test.network": "Connection failed",

  // --- ipc.settings.* — 主进程设置 IPC 失败码（T25；zh 走 handler 中文 error 回退） ---
  "ipc.settings.invalidPayload": "Invalid save parameters",
  "ipc.settings.providerBusy": "A provider has unfinished tasks",
  "ipc.settings.saveFailed": "Failed to save settings",
  "ipc.settings.unsupportedLocale": "Unsupported language",
  "ipc.settings.localeSaveFailed": "Failed to save the language setting",
  "ipc.settings.providerIdRequired": "Provider id cannot be empty",
  "ipc.settings.providerIdDuplicate": "Duplicate provider id",
  "ipc.settings.providerNameRequired": "Provider name cannot be empty",
  "ipc.settings.providerApiInvalid": "Invalid provider API style",
  "ipc.settings.providerIdReserved": "A reserved id cannot be used as a new provider id",
  "ipc.settings.providerIdFormat": "A new provider id must be a UUID",
  "ipc.settings.bindingProviderMissing": "The provider bound to a role does not exist",
  "ipc.settings.bindingModelRequired": "Model name cannot be empty",
  "ipc.settings.credentialFailed": "Could not write to the Windows Credential Manager",
  "ipc.settings.configWriteFailed": "Failed to write the configuration",
} as const;
