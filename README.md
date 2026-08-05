# PinAI Image Studio

PinAI Image Studio v1.2.1 是一款面向 Windows 的本地 AI 图片创作工作台。应用使用 Electron + React，通过 PinAI OpenAI 兼容接口调用 `gpt-image-2`，覆盖创作、编辑、扩图、项目图库、任务队列和成品交付。

本次补丁重点修复了小窗口操作、固定操作栏、错误反馈可见性、跨电脑保存目录、图库索引损坏恢复、队列容量保护和局部蒙版尺寸匹配问题。

## v1.2.0 新功能

- 负面提示词：正、负面提示词分开编辑，内置通用高质量、人像无畸变、写实去 AI 感和干净背景模板，也可保存自定义模板。由于图片接口未声明 `negative_prompt`，应用会将负面内容转换为明确的“避免出现……”约束并只组合一次。
- 智能扩图：支持上、下、左、右分别扩展，或直接输入目标分辨率；提供 1:1、4:5、16:9、9:16 快捷比例，不会隐式裁剪原图。
- 图反推提示词：用户主动点击后，用固定 `gpt-4o` 分析压缩后的图片，返回中、英文提示词，可复制、替换或追加到创作框。如果 PinAI 通道不支持图片输入，会保留原提示词并明确提示。
- 结构化失败提示：区分网络、鉴权、余额不足、参数超限、上传过大、内容合规、限流、超时和服务端异常，并提供修正建议与原始详情。
- PNG 配方元数据：自动归档、手动保存和社媒导出的 PNG 会嵌入 UTF-8 `iTXt` 配方，不重新编码原始像素。
- 图库 v3：统一保存正面提示词、负面提示词、模型、比例、尺寸、清晰度、来源关系、扩图参数与可选真实 Seed；新增清晰度、精确分辨率和真实 Seed 检索兼容。
- 统一配方结构：创作表单、任务队列、生成结果、图库记录、PNG 元数据和参数复用共用 `ImageRecipeV1`。

Seed 只在 PinAI 接口真实返回时显示、复制和检索。应用不会向图片接口发送未文档化的 `seed` 参数，也不会生成无法复现画面的本地假 Seed。

## 既有创作能力

- 文生图与图生图，支持 1K / 2K / 4K、常用横竖比例和安全自定义尺寸。
- 本地提示词助手与可选的 `gpt-4o` AI 增强。
- 可视化蒙版画笔、最多 3 张参考图、本地参考画板和上传预处理。
- 持久化顺序任务队列，一次只发送一个请求；支持取消待执行任务和手动重试失败任务，不自动重试生图，避免重复计费。
- 项目图库、收件箱、收藏、标签、搜索、缩略图懒加载、批量移动/删除/ZIP 导出和最多 4 张对比。
- 复制图片、提示词与完整参数，支持 1:1、4:5、16:9、9:16 社交画布导出。
- 安装版启动后检查 GitHub Release，发现新版本时由用户选择是否下载和安装。

## 安装

普通用户无需安装 Node.js，直接从公开 Release 下载 Windows 安装包：

https://github.com/zztnbnb/image-studio/releases/latest

安装程序支持选择安装目录，并创建桌面和开始菜单快捷方式。未签名安装包可能触发 Windows SmartScreen 提示，请核对发布者仓库和文件名后继续。

## API 配置

首次启动后进入“设置”，填写：

```text
API Base URL: https://api.pinaic.com/v1
图片模型: gpt-image-2
```

API 密钥由 Electron 主进程写入 Windows 凭据库，不写入源码、项目配置或渲染进程。应用会记住已配置状态，后续启动无需重复输入；界面不会显示已保存密钥的原文。

图反推提示词和 AI 提示词增强只会在用户主动点击时调用 PinAI。图片、项目、模板、队列、缩略图和索引均保存在本机。

## 本地数据

手动保存目录：

```text
旧版目录存在时：D:\codexproject\生图\保存图片
新安装设备：系统“图片”文件夹\PinAI Image Studio
```

自动图库位于手动保存目录下的“图库”子目录：

```text
<手动保存目录>\图库
```

应用会在“设置”中显示当前实际目录。这样把安装包复制到没有 D: 盘的电脑时，仍然可以正常启动、归档和保存图片。

图库包含 PNG 原图、版本化 `index.json`、`.thumbs` 缩略图缓存和配方元数据。首次读取 v2 索引时会先备份为 `index.v2.backup.json`，再迁移到 v3；不会移动或重新编码旧图片。

## 开发与测试

要求 Windows 10 或更高版本、Node.js 18+。

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

安装包输出到：

```text
dist\PinAI-Image-Studio-Setup-1.2.0.exe
```

## 项目结构

```text
electron/    Electron 主进程、IPC、图库、队列、配方、错误分类与 PNG 元数据
src/         React 创作界面、图库、蒙版画笔、智能扩图与提示词工具
tests/       Vitest 纯逻辑测试
chat-tool/   独立 PinAI Chat 工具，不与图片应用合并
```

## 发布与自动更新

公开仓库：https://github.com/zztnbnb/image-studio

每个版本的 GitHub Release 必须同时上传：

- `PinAI-Image-Studio-Setup-版本号.exe`
- `PinAI-Image-Studio-Setup-版本号.exe.blockmap`
- `latest.yml`

`latest.yml` 包含更新地址和校验信息；缺少它时，已安装用户无法收到新版本提醒。
