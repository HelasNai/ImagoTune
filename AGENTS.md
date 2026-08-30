# AI Image Studio — PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-30
**Commit:** 4ad073a
**Branch:** main

## OVERVIEW
Windows 桌面端 AI 图片创作工作台（Electron + React + TypeScript）：连接 OpenAI 兼容 API 出图，并提供完全本地的高清放大 / 抠图 / 人脸优化工具箱（WebGPU/WASM）。

## STRUCTURE
```
image-studio/
├── electron/    # 主进程：窗口、IPC、本地存储、OpenAI 兼容 API、本地 AI 模型管理（CommonJS→dist-electron）
├── src/         # React 渲染进程：UI 组件、纯逻辑 lib、WebGPU 推理 Worker（Vite→dist-renderer）
├── tests/       # Vitest 纯逻辑单元测试（tests/*.test.ts，无 DOM/UI 测试）
├── tools/       # electron-builder 打包钩子 + asar 完整性校验 + 图标生成
└── docs/        # 文档：releases/*.md（版本发布说明）+ review/*.md（架构/UI 复盘分析，如 ui-layout-analysis.md）
```

## WHERE TO LOOK
| 任务 | 位置 | 说明 |
|------|------|------|
| 启动 / 窗口 / IPC 生命周期 | `electron/main.ts` | 约 55 个 `ipcMain.handle` 集中在此 + `webContents.send` 推送 |
| preload 桥 | `electron/preload.ts` | `contextBridge` 暴露 `window.imageStudio` |
| IPC 类型契约 | `src/global.d.ts` | `window.imageStudio` 单一来源 + 共享类型 |
| 图库/队列持久化 | `electron/{gallery,queue}-store.ts` | 原子写入、损坏恢复 |
| 本地 AI 模型管理 | `electron/local-ai-model-manager.ts` | 下载 / SHA-256 校验 / 断点续传 |
| React UI | `src/main.tsx` + `src/components/*` | main.tsx 为 1662 行巨型单文件 |
| WebGPU 推理 | `src/workers/local-ai.worker.ts` | Worker 内 WebGPU→WASM 回退 |
| 纯函数逻辑 | `src/lib/*.ts` | creative / outpaint / local-ai / tutorial |
| 纯逻辑测试 | `tests/*.test.ts` | 与 electron/、src/lib 一一对应 |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `electron/main.ts` | entry | 主进程 | 窗口创建、IPC 注册、app 生命周期、自动更新 |
| `electron/preload.ts` | bridge | 预加载 | contextBridge 暴露 `window.imageStudio` |
| `src/main.tsx` | entry | 渲染进程 | App 根组件（巨型，全 UI 状态/模式路由） |
| `src/global.d.ts` | types | 渲染进程 | IPC 契约 + 共享类型 |
| `window.imageStudio` | API | 渲染进程 | 访问主进程能力的唯一通道 |

## CONVENTIONS（非标准约定）
- 无 ESLint / Prettier / .editorconfig——风格靠自觉：双引号、相对导入（无 `@/` 别名）、分号结尾
- 双 tsconfig 分离：`tsconfig.json`（渲染，ESNext/Bundler/noEmit）+ `tsconfig.electron.json`（主进程，CommonJS→dist-electron）
- 构建产物三分：`dist-renderer`（vite）/ `dist-electron`（tsc）/ `dist`（electron-builder）——勿合并（v1.3.2 空白窗修复）
- 安全基线：`contextIsolation(true)`/`nodeIntegration(false)`；API 密钥仅经 `keytar` 存 Windows 凭据库，绝不落盘源码/渲染层
- IPC 全部返回 `{ ok: boolean; error?: string }`
- 测试是纯逻辑，无 DOM/UI/electron 运行时测试；React 组件与 main.ts/preload.ts 无测试

## ANTI-PATTERNS（行为边界，源自代码而非注释）
- 队列任务失败绝不允许代码自动重试（避免重复计费），只能用户手动触发 `queue:retry`
- 任何图片请求不得把 Bearer 密钥附加到非 baseUrl 同源的 URL（防密钥泄漏第三方图床）
- API 密钥只允许经 keytar 入 Windows 凭据库，禁止写入源码/项目配置/渲染进程可读持久层
- 文件写入必须临时文件 + `rename` 原子替换；禁止原地写
- 本地处理结果禁止覆盖原图，必须作为新图归档
- 禁止把打包产物目录合并（dist-renderer/dist-electron/dist 必须分离）

## COMMANDS
```bash
npm run dev          # Vite dev(127.0.0.1:5173) + electron . --dev
npm run typecheck    # 双 tsconfig --noEmit
npm test             # vitest run（纯 Node 逻辑）
npm run build        # tsc(渲染) && vite build && tsc(主进程)
npm run package:win  # build && electron-builder NSIS x64 && package:verify
```
（Windows 下用 `npm.cmd`，Node.js 18+）

## NOTES
- 无 CI，发布纯手动；每个 GitHub Release 必须上传 exe + `.exe.blockmap` + `latest.yml` 三者
- 安装包未签名，Windows SmartScreen 会提醒（README 已说明）
- `win.signAndEditExecutable: false` + `afterPack: tools/after-pack.cjs`（rcedit 写版本资源）是刻意设计，勿改回默认
- `npmRebuild: false`：原生模块 keytar 依赖预编译二进制，改 Electron/Node 版本需手动验证
- `electron/main.ts` 存在硬编码 `LEGACY_SAVE_DIR = "D:\\codexproject\\生图\\保存图片"`（行 27），仅靠 try/catch 降级
- 工作区有 `Open-Opencode.exe`（gitignore 不提交）与 `500行源码)`（未跟踪的目录统计文本，非目录）
- 请求超时：生成 300s / 提示词增强 60s / 图反推 90s（AbortController）
