# PinAI Image Studio

PinAI Image Studio v1.1 是一个 Windows 本地创作工作台，使用 Electron + React 调用 PinAI OpenAI 兼容接口中的 gpt-image-2，同时提供提示词助手、项目图库、局部编辑、任务队列和批量交付。

## v1.1 功能

- 文生图与图生图：1K / 2K / 4K 清晰度，1:1、4:3、3:4、3:2、2:3、16:9、9:16、4:5、5:4、21:9 比例。
- 自定义尺寸：提交前校验 16 倍数、边长、像素和比例风险。
- 本地提示词助手：精炼主体、强化细节、海报化、社媒化、写实化和高级感，不产生额外 API 调用。
- 可选 AI 增强：用户主动点击时，通过 PinAI /chat/completions 固定调用 gpt-4o。
- 提示词模板：内置海报、封面、产品图、社交媒体模板，也可保存和删除自定义模板。
- 图片编辑：原图上传、可视化蒙版画笔、最多 3 张参考图。参考图会在本地合成为带区域标识的参考画板。
- 上传预处理：超大图片按最长边 2048 px 等比压缩，透明图保留 PNG，其他图片使用高质量 JPEG。
- 顺序任务队列：一次只发送一个请求，支持查看、取消待执行任务、重试失败任务；应用重启后执行中的任务标记为“已中断”。
- 项目图库：项目 CRUD、收件箱、标题/标签/收藏、搜索筛选、懒加载缩略图、批量移动/收藏/删除/ZIP 导出。
- 图片工作流：点击大图预览、复用参数、继续编辑、创建变体、复制图片/提示词/完整参数、最多 4 张对比。
- 社交画布导出：1:1、4:5、16:9、9:16，可选择浅色留白或模糊延展背景。
- 软件更新：安装版可在启动时检查 GitHub Release；发现新版本后由用户选择下载，并在下载完成后选择是否重启安装。

## 安装

普通用户无需安装 Node.js，直接从公开 Release 下载 Windows 安装包：

https://github.com/zztnbnb/image-studio/releases/latest

安装程序支持选择安装目录，并创建桌面和开始菜单快捷方式。

## 开发与构建

要求 Windows 10 或更高版本、Node.js 18+。

    npm.cmd install
    npm.cmd run dev

检查、测试和生产构建：

    npm.cmd run typecheck
    npm.cmd test
    npm.cmd run build
    npm.cmd run package:win

安装包输出在 dist/PinAI-Image-Studio-Setup-1.1.4.exe。

## API 配置

首次启动后进入“设置”，填入：

    API Base URL: https://api.pinaic.com/v1
    图片模型: gpt-image-2

API 密钥由 Electron 主进程写入 Windows 凭据库，不写入源码、项目配置或渲染进程。应用会记住已配置状态，后续启动无需重复填写；界面不会显示已保存的密钥。

## 本地数据

默认手动保存目录：

    D:\codexproject\生图\保存图片

自动图库目录：

    D:\codexproject\生图\保存图片\图库

图库保存 PNG 原图、版本化 index.json、.thumbs 缩略图缓存和提示词/参数元数据。旧版数组索引首次读取时会自动备份为 index.v1.backup.json，并迁移到“收件箱”项目。

## 安全与隐私

- API 密钥只保存在 Windows 凭据库。
- 图片、项目、模板、队列和缩略图只保存在本机。
- 不会对提示词做客户端关键词过滤或改写；服务端响应仍以 PinAI 实际规则为准。
- 生图请求不会自动重试，避免重复计费；失败任务可由用户手动重试。

## 项目结构

    electron/                 Electron 主进程、IPC、图库与队列存储
    src/                      React 创作界面、图库、蒙版画笔和提示词助手
    tests/                    Vitest 纯逻辑测试
    chat-tool/                独立的 PinAI Chat 工具，不与图片应用合并

## 发布

当前版本：v1.1.4。公开 GitHub 仓库：

https://github.com/zztnbnb/image-studio

### 自动更新发布清单

从 v1.1.4 起，每次发布后续版本时，GitHub Release 必须同时包含以下三个构建产物：

- PinAI-Image-Studio-Setup-版本号.exe
- PinAI-Image-Studio-Setup-版本号.exe.blockmap
- latest.yml

其中 latest.yml 会指向本次安装包并携带校验信息；缺少它时，已安装用户无法收到新版本提醒。
