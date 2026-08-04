# PinAI Image Studio

Windows 本地图片创作工作台，基于 Electron + React，调用 PinAI OpenAI 兼容接口的 `gpt-image-2` 图片模型。

## 功能

- 文生图：根据自然语言提示词生成图片。
- 图生图：上传原图，可选上传蒙版并继续编辑。
- 清晰度选择：自动、1K、2K、4K。
- 画面比例：1:1、4:3、3:4、3:2、2:3、16:9、9:16、4:5、5:4、21:9。
- 生成数量：支持一次生成 1–4 张图片。
- 提示词模板：内置海报、封面、产品图、社交媒体配图模板，也支持自定义模板的保存、编辑和删除。
- 本地图库：自动归档、关键词搜索、收藏筛选、时间排序、大图预览和删除确认。
- 图片迭代：结果支持一键再生成、复用参数和继续编辑。
- API 密钥：通过 Windows 凭据库保存，不写入源码或项目配置。
- 浅色蓝粉渐变界面，支持宽屏、窗口化和小窗口自适应布局。

## 环境要求

- Windows 10 或更高版本。
- Node.js 18 或更高版本。
- 可用的 PinAI API 密钥。

## 安装与启动

在项目目录执行：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

开发模式：

```powershell
npm.cmd install
npm.cmd run dev
```

也可以直接双击：

- `启动 PinAI Image Studio.bat`
- `启动 PinAI Image Studio.vbs`

## API 配置

首次启动后进入“设置”，填写：

```text
API Base URL: https://api.pinaic.com/v1
模型: gpt-image-2
```

输入 API 密钥并保存。密钥由 Electron 主进程写入 Windows 凭据库，渲染页面不会直接读取密钥。

## 图片与图库位置

手动保存图片时，默认打开：

```text
D:\codexproject\生图\保存图片
```

自动归档的图库位置为：

```text
D:\codexproject\生图\保存图片\图库
```

图库会保存 PNG 原图和 `index.json` 元数据索引，记录提示词、模型、比例、像素尺寸、清晰度、创建时间和收藏状态。

## 参数说明

画面比例用于决定生成画布的宽高比例，程序会根据所选清晰度自动换算像素尺寸，并在提示词中明确要求模型原生按目标比例构图，避免生成后再裁剪。

“自动”清晰度不会发送 `quality` 参数；选择其他清晰度时会发送对应质量值。如果接口明确返回不支持 `quality`，程序会提示切换到“自动”，不会自动重复请求。

## 项目结构

```text
electron/                 Electron 主进程和受限 IPC
src/                      React 渲染界面
tools/                    图标等辅助脚本
启动 PinAI Image Studio.*  Windows 启动脚本
```

聊天工具位于本地的独立目录 `chat-tool`，不会随本图片软件仓库提交。

## 检查与构建

```powershell
npm.cmd run typecheck
npm.cmd run build
```

## 许可证

本项目用于个人本地创作和 PinAI API 调用。图片内容、API 使用费用及模型输出版权请以 PinAI 账户和相关服务条款为准。
