# AI Image Studio

AI Image Studio v1.3.2 是一款面向 Windows 的本地 AI 图片创作工作台。应用使用 Electron + React，可连接符合当前请求格式的 OpenAI 兼容服务，覆盖图片生成、图片编辑、智能扩图、项目图库、任务队列和成品交付。

## v1.3.2 修复

- 修复 GitHub 安装包启动时提示 `Cannot find module 'archiver-utils'` 的主进程崩溃。
- 分离网页构建目录与安装包输出目录，修复打包后页面资源丢失导致的空白窗口。
- 新增安装包完整性校验：解开 `app.asar`，验证页面资源链，并实际加载 ZIP 模块创建测试压缩包。

## v1.3.1 更新

- 使用新的浅色蓝粉相机视觉作为桌面、开始菜单、应用窗口和安装包图标。
- 图标包含 16–256 px 多级 Windows ICO 尺寸，在不同显示缩放下保持清晰。

## v1.3.0 更新

- 移除单一服务商的品牌、默认地址和固定平台说明，应用改为中立的 `AI Image Studio`。
- API Base URL、API 密钥、图片模型和聊天模型均可在设置中配置。
- 新安装不预填服务地址，避免误导为只能使用某个平台。
- 旧版密钥、连接设置、图库、模板、队列和 PNG 配方会自动兼容，不需要重新迁移素材。
- 安装包、快捷方式、导出图片、ZIP 和临时图片统一使用通用名称。

## 兼容接口要求

应用支持的是符合当前调用格式的 OpenAI 兼容接口，不代表任意 API 平台都能直接使用。一个 Base URL 至少需要按所用功能提供以下端点：

```text
GET  /models
POST /images/generations
POST /images/edits
POST /chat/completions
```

其中：

- 文生图使用 `/images/generations`。
- 图片编辑与扩图使用 `/images/edits`。
- AI 提示词增强和图反推使用 `/chat/completions`，需要聊天模型支持对应文本或图片输入。
- “测试连接”使用 `/models`。某个平台即使能生图，但没有实现 `/models`，测试连接仍可能失败。
- 不同服务商对 `quality`、尺寸、流式返回、图片编辑和多模态消息的支持可能不同，以平台文档和实际响应为准。

当前版本保存一套正在使用的连接配置。更换平台时，在“设置”中修改 Base URL、密钥和模型名称后保存即可。

## 主要功能

- 文生图与图生图，支持常用画面比例、1K / 2K / 4K 档位和安全自定义尺寸。
- 正面与负面提示词、提示词模板、本地提示词助手和可选的在线 AI 增强。
- 可视化蒙版画笔、最多 3 张参考图、本地参考画板和上传预处理。
- 智能扩图，支持四向扩展、目标分辨率和常用横竖版转换。
- 图反推中英文提示词，可复制、替换或追加到创作框。
- 持久化顺序任务队列，一次只发送一个请求；失败任务由用户手动重试，避免重复计费。
- 项目图库、收件箱、收藏、标签、搜索、缩略图懒加载、批量移动、删除、ZIP 导出和最多 4 张图片对比。
- PNG 配方元数据、复制图片/提示词/完整参数和社交平台画布导出。
- 启动时可选检查 GitHub Release 更新，由用户决定是否下载和安装。

## 安装

普通用户无需安装 Node.js，可从公开 Release 下载 Windows 安装包：

https://github.com/zztnbnb/image-studio/releases/latest

安装程序支持选择安装目录，并创建桌面和开始菜单快捷方式。当前安装包未进行代码签名，Windows SmartScreen 可能显示提醒，请核对发布仓库和文件名后继续。

## API 配置

首次启动后进入“设置”，填写：

```text
API Base URL: 例如 https://api.example.com/v1
API 密钥: 当前平台提供的密钥
图片模型: 当前平台提供的图片模型名称
聊天模型: 用于提示词增强和图反推的模型名称
```

API 密钥由 Electron 主进程写入 Windows 凭据库，不写入源码、项目配置或渲染进程。应用会记住已配置状态，后续启动无需重复输入；界面不会回显已保存密钥的原文。

图片、项目、模板、队列、缩略图和索引均保存在本机。只有用户主动执行生成、编辑、在线提示词增强或图反推时，相关内容才会发送到当前配置的服务。

## 本地数据

手动保存目录：

```text
旧版目录存在时：继续使用原目录，避免图库丢失
新安装设备：系统“图片”文件夹\AI Image Studio
```

自动图库位于手动保存目录下的“图库”子目录：

```text
<手动保存目录>\图库
```

图库包含 PNG 原图、版本化 `index.json`、`.thumbs` 缩略图缓存和配方元数据。升级不会移动或重新编码旧图片。

## 开发与测试

需要 Windows 10 或更高版本、Node.js 18+。

```powershell
npm.cmd install
npm.cmd run dev
```

完整检查与 Windows 安装包构建：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run package:win
```

安装包输出示例：

```text
dist\AI-Image-Studio-Setup-1.3.2.exe
```

## 项目结构

```text
electron/    Electron 主进程、IPC、图库、队列、错误分类和 PNG 元数据
src/         React 创作界面、图库、蒙版画笔、扩图与提示词工具
tests/       Vitest 纯逻辑测试
```

## 发布与自动更新

公开仓库：https://github.com/zztnbnb/image-studio

每个 GitHub Release 需要同时上传：

- `AI-Image-Studio-Setup-版本号.exe`
- `AI-Image-Studio-Setup-版本号.exe.blockmap`
- `latest.yml`

`latest.yml` 包含更新地址和校验信息；缺少它时，已安装用户无法收到新版本提醒。
