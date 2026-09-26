# ImagoTune — PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-30
**Commit:** 15bd76d
**Branch:** alpha
**同步日期:** 2026-09-26（preload 白屏修复：沙箱化 preload 不能 `require` 本地模块，`preload.ts` 回退为内联通道字符串——T8 的 `import "./channels"` 曾致 `window.imageStudio` 不暴露、窗口白屏；新增 `tests/preload-channels.test.ts` 锁定两端一致。测试 18 文件 / 106 it。前次同步：redundancy-refactor 去重改造：跨层类型单源化 `shared/types.d.ts`、主进程/渲染层共享 helper 提取、需反馈的 IPC 结果统一走 `components/ipc.ts`；main.tsx 487 行）

## OVERVIEW
Windows 桌面端 AI 图片创作工作台（Electron + React + TypeScript）：连接 OpenAI 兼容 API 出图，并提供完全本地的高清放大 / 抠图 / 人脸优化工具箱（WebGPU/WASM）。

## STRUCTURE
```
image-studio/
├── electron/    # 主进程：窗口、IPC、本地存储、OpenAI 兼容 API、本地 AI 模型管理（CommonJS→dist-electron）
├── src/         # React 渲染进程：UI 组件、纯逻辑 lib、WebGPU 推理 Worker（Vite→dist-renderer）
├── shared/      # 跨进程共享类型唯一来源（shared/types.d.ts，electron/ 与 src/ 均 import type；不参与 tsconfig include，靠 import 按需加载）
├── tests/       # Vitest 纯逻辑单元测试（tests/*.test.ts，无 DOM/UI 测试）
├── tools/       # electron-builder 打包钩子 + asar 完整性校验 + 图标生成
└── docs/        # 文档：releases/*.md（版本发布说明）+ review/*.md（架构/UI 复盘分析，如 ui-layout-analysis.md）
```

## WHERE TO LOOK
| 任务 | 位置 | 说明 |
|------|------|------|
| 启动 / 窗口 / IPC 生命周期 | `electron/main.ts` | 63 个 `ipcMain.handle` 集中在此 + `webContents.send` 推送；通道名常量单一来源 `electron/channels.ts` |
| preload 桥 | `electron/preload.ts` | `contextBridge` 暴露 `window.imageStudio` |
| IPC 类型契约 | `shared/types.d.ts` | 跨进程共享类型唯一定义处；`src/global.d.ts` 仅保留 `window.imageStudio` 声明 + 全局别名 |
| 主进程共享助手 | `electron/{fs-utils,net-utils,directory-manager}.ts` | 原子写 JSON / 超时 / joinBase / 目录选择（IPC 内联重复已清零） |
| 主进程共享常量 | `electron/{constants,channels,outpaint-limits,local-ai-limits,data-url}.ts` | 默认模型 / 通道名 / 画布与本地 AI 上限 / dataURL 去前缀（纯模块，可被 vitest 导入） |
| 图库/队列持久化 | `electron/{gallery,queue}-store.ts` | 原子写入、损坏恢复 |
| 本地 AI 模型管理 | `electron/local-ai-model-manager.ts` | 下载 / SHA-256 校验 / 断点续传 |
| React UI | `src/main.tsx` + `src/components/*` | main.tsx 为 **487 行 shell**（同步日期 2026-09-26）；创作/结果/队列/设置面板与 useComposer 已拆入 `src/components/*` |
| IPC 调用助手 | `src/components/ipc.ts` | `callIpc` / `useIpcAction` 统一 `{ok:false}`/reject 上报；渲染层需反馈的调用均经此路由 |
| WebGPU 推理 | `src/workers/local-ai.worker.ts` | Worker 内 WebGPU→WASM 回退 |
| 纯函数逻辑 | `src/lib/*.ts` | creative / outpaint / local-ai / tutorial / format / media / constants |
| 纯逻辑测试 | `tests/*.test.ts` | 18 文件 / 106 it，与 electron/、src/lib 一一对应（含跨层一致性测试） |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `electron/main.ts` | entry | 主进程 | 窗口创建、IPC 注册、app 生命周期、自动更新 |
| `electron/preload.ts` | bridge | 预加载 | contextBridge 暴露 `window.imageStudio` |
| `src/main.tsx` | entry | 渲染进程 | App 根组件（487 行 shell：模式路由/导航/StudioProvider/订阅/灯箱；业务逻辑在 components/*） |
| `shared/types.d.ts` | types | 跨进程 | 全部共享 IPC 类型唯一定义处（以 electron 侧为超集） |
| `src/global.d.ts` | types | 渲染进程 | `window.imageStudio` 声明 + `shared/types` 全局别名 |
| `src/components/ipc.ts` | helper | 渲染进程 | `callIpc`/`useIpcAction`：需反馈的 IPC 失败统一上报 |
| `electron/fs-utils.ts` | helper | 主进程 | `ensureDir`/`atomicWriteJson`/`readJsonWithLegacy`/`replaceWithRetry` |
| `window.imageStudio` | API | 渲染进程 | 访问主进程能力的唯一通道 |

## CONVENTIONS（非标准约定）
- 无 ESLint / Prettier / .editorconfig——风格靠自觉：双引号、相对导入（无 `@/` 别名）、分号结尾
- 双 tsconfig 分离：`tsconfig.json`（渲染，ESNext/Bundler/noEmit）+ `tsconfig.electron.json`（主进程，CommonJS→dist-electron）
- 构建产物三分：`dist-renderer`（vite）/ `dist-electron`（tsc）/ `dist`（electron-builder）——勿合并（v1.3.2 空白窗修复）
- 安全基线：`contextIsolation(true)`/`nodeIntegration(false)`；API 密钥仅经 `keytar` 存 Windows 凭据库，绝不落盘源码/渲染层
- IPC 全部返回 `{ ok: boolean; error?: string }`
- 窗口为系统原生 WCO 模型（`titleBarStyle:'hidden'` + 全透明 `titleBarOverlay` 对象）：Windows 原生绘制最小化/最大化/关闭按钮并叠加在页面上、页面渐变透出（支持 Win11 Snap Layouts）；原生应用菜单已移除（`Menu.setApplicationMenu(null)`），其「使用说明 / 开源许可证 / 新手教程 / 界面缩放」入口迁至设置页；拖拽区按元素「布局矩形」收集且不受 `overflow:hidden` 裁剪——header 内伪元素/子元素的布局矩形必须落在 header 盒内，越界会把 header 下方页面区域误判为拖拽/标题栏区（v2.5 修复 `header::before` 光晕圆盒溢出）
- 跨进程共享类型唯一来源 `shared/types.d.ts`：electron 侧 `import type` 后必须 `export type` re-export（本仓开启 `isolatedModules`），renderer 经 `src/global.d.ts` 全局别名引用，不得重复声明
- IPC 通道名字符串唯一来源 `electron/channels.ts`：`main.ts` 引用常量；`preload.ts` **刻意内联字符串**（沙箱化 preload 不能 `require` 本地模块，import 会在运行时报 "Unable to load preload script"），两端一致性由 `tests/preload-channels.test.ts` 双向锁定；字符串本身是对外契约，不得改动
- 需要用户反馈的 IPC 结果统一走 `src/components/ipc.ts` 的 `callIpc` / `useIpcAction`；best-effort 调用（`on*` 事件订阅、`windowControls.*`、`clipboard.copyText/copyImage`）保持直连白名单
- 需测试的纯逻辑优先移入 `src/lib/*.ts`；主进程可测纯模块（`electron/constants`/`channels`/`*-limits`/`data-url`）不得含 IPC/副作用，供 vitest 直接导入
- 测试是纯逻辑，无 DOM/UI/electron 运行时测试；React 组件与 main.ts 无测试，preload.ts 仅由 `tests/preload-channels.test.ts` 做源码文本一致性检查（非运行时）（现 18 文件 / 106 it）

## ANTI-PATTERNS（行为边界，源自代码而非注释）
- 队列任务失败绝不允许代码自动重试（避免重复计费），只能用户手动触发 `queue:retry`
- 任何图片请求不得把 Bearer 密钥附加到非 baseUrl 同源的 URL（防密钥泄漏第三方图床）
- API 密钥只允许经 keytar 入 Windows 凭据库，禁止写入源码/项目配置/渲染进程可读持久层
- 文件写入必须临时文件 + `rename` 原子替换；禁止原地写
- 本地处理结果禁止覆盖原图，必须作为新图归档
- 禁止把打包产物目录合并（dist-renderer/dist-electron/dist 必须分离）
- 渲染层禁止原生 `window.prompt/confirm/alert`：Electron 不支持 prompt（同步抛 `Error: prompt() is not supported.`），原生 confirm 在 Windows 会丢焦点（electron#31917）；输入/确认统一走 `src/components/Dialogs.tsx` 的 `useDialog()`
- 禁止在 electron/ 或 src/ 重复声明跨进程类型；IPC 通道字符串唯一来源 `electron/channels.ts`，唯一例外是 `preload.ts` 出于沙箱限制刻意内联（一致性由 `tests/preload-channels.test.ts` 锁定）
- 需用户反馈的 IPC 失败提示禁止逐字复制 `if (!result.ok) …` 模式，必须经 `src/components/ipc.ts` 的 `callIpc`/`useIpcAction`（best-effort 白名单见该文件头注释）
- 媒体读取 / 对象 URL / 画布助手单点在 `src/lib/media.ts`（`components/media-utils.ts` 仅为 re-export 兼容层）；`new FileReader` 全仓仅 `src/lib/media.ts` 一处

## COMMANDS
```bash
npm run dev          # tsc(主进程→dist-electron) + Vite dev(127.0.0.1:5173) + electron . --dev
npm run typecheck    # 双 tsconfig --noEmit
npm test             # vitest run（纯 Node 逻辑）
npm run build        # tsc(渲染) && vite build && tsc(主进程)
npm run package:win  # build && electron-builder NSIS x64 && package:verify
```
（Windows 下用 `npm.cmd`，Node.js 18+）

## NOTES
- 无 CI，发布纯手动；每个 GitHub Release 必须上传 exe + `.exe.blockmap` + `latest.yml` 三者
- 安装包未签名，Windows SmartScreen 会提醒（README 已说明）
- `win.signAndEditExecutable: false` + `afterPack: tools/after-pack.cjs`（rcedit 写版本资源）是刻意设计，勿改回默认；版本资源与安装注册表的发布者（CompanyName/Publisher）单一来源 = `package.json` 的 `author`（NSIS 与 `appInfo.companyName` 均读取它），换发布者名字只需改 `author`
- 安装器/卸载器自定义行为（`tools/installer.nsh`，经 `build.nsis.include` 接入；改动前先读该文件头注释）：①卸载欢迎页询问「是否删除用户数据」（默认保留；用户数据 = `%APPDATA%\imagotune`）；②真卸载保留安装根空目录并把路径记入 `HKCU\Software\ImagoTune\LastInstallDir`，重装时回填并**写回 InstallLocation 键**（`HKCU/HKLM\Software\{APP_GUID}`——安装模式页 leave 会执行 `setInstallModePerUser/AllUsers` 重读该键并重置 `$INSTDIR`，不写回则回填被覆盖）；升级（`--updated`）与静默卸载（`/S`）绝不触发删除。NSIS 警告被 electron-builder 视为错误：自定义脚本须在两轮编译（安装器/卸载器）均零警告——函数体必须放在宏内延迟到 MUI2 就绪后展开，仅卸载器使用的变量用 `!ifdef BUILD_UNINSTALLER` 保护
- `npmRebuild: false`：原生模块 keytar 依赖预编译二进制，改 Electron/Node 版本需手动验证
- `electron/main.ts` 存在硬编码 `LEGACY_SAVE_DIR = "D:\\codexproject\\生图\\保存图片"`（行 58），仅靠 try/catch 降级
- 工作区有 `Open-Opencode.exe`（gitignore 不提交）与 `500行源码)`（未跟踪的目录统计文本，非目录）
- 请求超时：生成 300s / 提示词增强 60s / 图反推 90s（AbortController）
