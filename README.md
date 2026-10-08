# ImagoTune

[English](README.en.md) | **简体中文**

面向 Windows 的 AI 图片创作工作台：连接任意 OpenAI 兼容服务完成文生图、图片编辑与智能扩图，并内置完全本地运行的高清放大、智能抠图和人脸优化工具箱。

当前版本 **v2.0.0-beta.1** · [更新日志](CHANGELOG.md) · [下载最新版本](https://github.com/HelasNai/ImagoTune/releases/latest)

## 主要功能

- **文生图与图生图**：常用画面比例、1K / 2K / 4K 清晰度档位与安全自定义尺寸。
- **提示词工具**：正面与负面提示词、模板、本地提示词助手、可选的在线 AI 增强，以及图反推（中英文提示词，可复制、替换或追加到创作框）。
- **图片编辑与智能扩图**：可视化蒙版画笔、最多 3 张参考图、四向扩展与目标分辨率、常用横竖版转换。
- **多供应商管理**：同时保存多个 OpenAI 兼容平台，按「生图 / 图反推 / 提示词增强」三角色分配模型；内置 12 个平台预设（混元、智谱、火山方舟、阿里云百炼、硅基流动、xAI、OpenRouter 及五个国际站预设）。仍被队列任务引用的供应商不会被删除。
- **持久化任务队列**：一次只发送一个请求；失败任务由用户手动重试，避免重复计费；任务入队时记录所用供应商与模型，原供应商不可用时明确失败而非自动改换。
- **项目图库**：项目与收件箱、收藏、标签、搜索、缩略图懒加载、批量移动 / 删除、ZIP 导出、最多 4 张图片对比；支持复制图片 / 提示词 / 完整参数与社交平台画布导出。
- **布局编辑**：创作、图片编辑、智能扩图页支持自定义模块位置、大小与隐藏，并提供布局分享码、撤销重做和拖动推挤。
- **更新与界面**：正式版 / 测试版 Beta 双更新渠道与自动更新开关；中英双语界面即时切换，安装程序支持简体中文与英文。
- 全局悬浮提示；生成、增强、反推、导出、队列与本地 AI 统一进度反馈；侧栏项目树可展开预览最近图片，顶栏队列芯片显示运行进度，历史可一键清空。

## 安装

普通用户无需安装 Node.js，从 GitHub Releases 下载 Windows 安装包：

**https://github.com/HelasNai/ImagoTune/releases/latest**

- 安装程序支持选择安装目录，并创建桌面和开始菜单快捷方式。
- 从 v1.x 升级：设置、API 密钥、图库、模板、队列、保存目录和更新偏好会自动迁移；新版安装程序会自动检测、卸载并接管旧版安装（v1.0–v1.5.1，原名 AI Image Studio），用户数据保留。旧版本遗留的排队任务需要手动重试（刻意设计，避免重复计费）。
- 安装包未进行代码签名，Windows SmartScreen 可能显示提醒，请核对发布仓库和文件名后继续。

## 快速上手

首次启动后进入「设置」添加一个平台：可以直接选择一个平台预设（填入密钥即可），也可以自定义名称与 API Base URL（例如 `https://api.example.com/v1`）。

保存后，先在「模型角色配置」里为该供应商标注哪些模型可以承担生图、图反推、提示词增强（可用「刷新模型」拉取平台模型列表，也可以手动添加自定义模型），再到「模型分配」为三个角色各选择一个供应商与模型。可以添加多个供应商，让不同角色分别使用不同平台；创作页底栏提供当前生图模型的快捷切换。

应用支持符合当前调用格式的 OpenAI 兼容接口：

| 用途 | 端点 |
| --- | --- |
| 文生图 | `POST /images/generations` |
| 图片编辑与扩图 | `POST /images/edits` |
| 提示词增强、图反推 | `POST /chat/completions` |
| 测试连接 | `GET /models` |

「测试连接」使用 `/models`，某个平台即使能生图但没有实现该端点，测试连接仍可能失败。不同服务商对 `quality`、尺寸、流式返回、图片编辑和多模态消息的支持可能不同，以平台文档和实际响应为准。

首次启动还会询问是否开始 2–3 分钟的新手教程（只做讲解，不影响数据、不消耗 API 额度），之后可随时在设置页的「关于与帮助」中重新打开。

## 本地工具箱

完全在本机运行的高清放大、智能抠图与人脸优化，不读取 API 密钥，也不会把待处理图片上传到任何服务。

| 工具 | 用途 | 输出与限制 |
| --- | --- | --- |
| 高清放大 | 补足生成图、插画和产品图的纹理与边缘 | 原生 2×/4× PNG；最长边 8192 px，总像素不超过 7000 万 |
| 智能抠图 | 为人物、商品和视觉素材移除背景 | 透明 PNG；保留原始 RGB，仅替换 Alpha，可调 0–8 px 羽化 |
| 人脸优化 Beta | 修复模糊或轻微畸变的人脸 | 最多 10 张脸；侧脸、遮挡、过小人脸可能停止处理 |
| 一键优化 | 人脸优化 → 2× 超分 → 智能抠图 | 只保存最终成品，任一步失败即停止 |

推理优先使用 WebGPU，不可用或显存不足时自动回退 WASM/CPU；「秒出」仅是支持 WebGPU 时的小图体验目标，不保证所有设备和分辨率都达到相同性能。模型首次按需下载并校验 SHA-256，安装后可离线推理。本地处理结果作为新图片归档，原图永不覆盖。

模型来源与许可证：

- [Real-ESRGAN ONNX](https://huggingface.co/SceneWorks/real-esrgan-onnx)：BSD-3-Clause，固定 2×/4× ONNX 文件与校验值。
- [ISNet General Use（rembg 分发）](https://github.com/danielgatis/rembg)：rembg 为 MIT；模型来源和使用限制以对应发布说明为准。
- [OpenCV Zoo YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)：MIT。
- [GFPGAN](https://github.com/TencentARC/GFPGAN)：上游 Apache-2.0；应用使用第三方 ONNX 转换版本，因此该功能标记为 Beta，并在模型管理页显示具体来源。

模型下载需要网络并可能占用数百 MB 磁盘空间。应用不集成 CodeFormer。

## 数据与隐私

- **API 密钥**：由 Electron 主进程写入 Windows 凭据库，不写入源码、项目配置或渲染进程，界面不回显已保存密钥。供应商名称、地址、模型标注等元数据保存在本机的 `userData/model-config.json`（不含密钥）。
- **本地数据**：图片、项目、模板、队列、缩略图和索引均保存在本机；只有用户主动执行生成、编辑、在线提示词增强或图反推时，相关内容才会发送到当前配置的服务。
- **图库位置**：手动保存目录（旧版目录存在时继续使用；新安装为系统「图片」文件夹\ImagoTune）下的「图库」子目录，包含 PNG 原图、版本化 `index.json`、`.thumbs` 缩略图缓存和配方元数据；升级不会移动或重新编码旧图片。
- **模型位置**：默认在 Electron 的 `userData/models`，与安装目录和图库分离；模型管理页支持更换位置、打开目录和恢复默认。

## 开发与构建

需要 Windows 10 或更高版本、Node.js 22.12+。WebGPU 推理建议使用支持 DirectX 12 的较新显卡与驱动，不满足条件时自动使用 WASM/CPU。

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

生产安装包锁定 `package-lock.json` 中的确切依赖树，首次安装建议使用 `npm.cmd ci`。React、ONNX Runtime Web 等前端依赖由 Vite 打包进渲染层产物；安装包只包含 Electron 运行时、应用构建产物和主进程所需的最小运行时依赖，源代码、测试与开发工具不会进入安装包。

项目结构：

```text
electron/    Electron 主进程、IPC、图库、队列、错误分类和 PNG 元数据
src/         React 创作界面、图库、蒙版画笔、扩图与提示词工具
tests/       Vitest 纯逻辑测试
tools/       打包钩子、asar 完整性校验与 CDP 验收脚本
```

发布与自动更新流程（Beta 渠道、Release 资产清单）见 [docs/guides/release.md](docs/guides/release.md)。

## 许可证

Copyright (C) 2026 HelasNai。ImagoTune 以 [GNU Affero General Public License v3.0 only](LICENSE)（SPDX：`AGPL-3.0-only`）发布：你可以运行、研究、修改和收费分发本项目；分发原版或修改版（包括通过网络向用户提供服务）时，必须按 AGPL-3.0 保留许可证与版权声明并向接收者提供对应源代码。第三方依赖、模型与资源继续适用各自的许可证。完整条款以 [LICENSE](LICENSE) 为准。
