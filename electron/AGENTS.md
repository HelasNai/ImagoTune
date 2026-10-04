# electron/ — 主进程目录

## OVERVIEW
Electron 主进程：窗口、IPC、本地存储、OpenAI 兼容 API、本地 AI 模型管理；tsc(CommonJS) 编译到 dist-electron。

## STRUCTURE
| 文件 | 职责 |
|------|------|
| `main.ts` | 入口(1368 行)：系统原生 WCO 窗口(1180x820、`titleBarStyle:'hidden'` + 透明 `titleBarOverlay`) + v3.14 启动页窗口时序(`show:false` / `ready-to-show` 显示 / 4s 兜底)——窗口一出场即 React 首帧(`SplashScreen`)、`local-ai-model://` 协议、启动早期 `force_high_performance_gpu` 开关（Windows 双显卡强制独显，见 KEY RULES）、已移除应用菜单(`Menu.setApplicationMenu(null)`)、窗口控制 IPC(`window:*` 6 个 handler + `window:maximized-changed` 推送)、electron-updater 双偏好(更新通道 stable/beta + 自动更新)、多供应商配置持久层(启动迁移 `loadModelConfig`、五步保存 `saveModelConfig`、`providerCredential`/`resolveProvider`/`resolveRole`/`providerHasKey` 解析 helper、队列快照与 fail-closed 执行)、全部 66 个 `ipcMain.handle`（通道名引用 `channels.ts`；含 `settings:setLocale`）、统一进度推送 `emitProgress`（含 `win.isDestroyed()` 守卫；增强/反推/导出三处接入） |
| `channels.ts` | IPC 通道名常量单一来源（共 75 个，含 `settings:setLocale` 与进度推送 `progress:update`；`main.ts` 引用；`preload.ts` 因沙箱无法 `require` 本地模块而**刻意内联**，一致性由 `tests/preload-channels.test.ts` 锁定；字符串即对外契约，不得改） |
| `constants.ts` | 默认模型 `DEFAULT_IMAGE_MODEL`/`DEFAULT_CHAT_MODEL` + `INBOX_PROJECT_ID`（纯模块，与 `src/lib/constants` 一致性测试） |
| `i18n.ts` | 主进程 locale 单例 + `mt()` 原生面小词典（`MainLocale`/`getMainLocale`/`setMainLocale`；32 条 `{zh;en}` + `{name}` 插值，缺失 key warn 返回 key 不抛错），纯模块可被 vitest 直接导入 |
| `model-config.ts` | 多供应商配置纯逻辑（`parseModelsResponse`/`mergeFetchedModels`/`buildLegacyModelConfig`/`validateSavePayload`/`resolveRoleBinding`/`resolveJobBinding`/`deriveConfigured`/`runSavePlan`/`findProvider`/`stripProviderSecrets`）——无 IPC/副作用，供 main.ts 与 vitest 共用 |
| `providers/` | 平台适配器层（纯逻辑无副作用）：`types.ts`（`ProviderAdapter`/`GenerateContext` 接口，只强制 `generate`）、`presets.ts`（`PROVIDER_PRESETS` 预设表 + `getAdapter`/`getPreset`，未知 api → `undefined`）、`hunyuan-image.ts`（腾讯混元生图适配器：专用端点 + messages 协议、单张限制、size 哨兵） |
| `fs-utils.ts` | `ensureDir`/`atomicWriteJson`/`readJsonWithLegacy`/`replaceWithRetry`（原子写 + 重试） |
| `net-utils.ts` | `joinBase`/`withTimeout`/`errorMessage`（网络请求共享助手） |
| `directory-manager.ts` | 目录选择/打开/恢复默认的共享实现（依赖 `dialog`/keytar，不计入纯逻辑测试） |
| `preload.ts` | `contextBridge` 暴露 `window.imageStudio`(~15 组方法 + 事件订阅，含统一进度订阅 `onProgressUpdate`) |
| `gallery-store.ts` | 图库持久化：原子写(tmp+rename)、损坏项隔离恢复；`openTarget(id)` 解析原图绝对路径供本地打开（`sourcePathOf` 与 `load`/`thumbnail` 共用 basename 防穿越） |
| `queue-store.ts` | 持久串行队列(上限 100)、legacy 迁移、附件存 `.bin`；禁止自动重试；`clear()` 仅清「非活跃」记录（completed/failed/cancelled/interrupted）并回收附件，queued/running 一律保留（防止误删在排队/花钱的任务），返回清除条数 |
| `image-recipe.ts` | PNG 配方元数据(提示词组装) |
| `image-response.ts` | 图片响应模型；JSDoc 注明"优先持久 Base64 而非瞬时 URL" |
| `generation-error.ts` | 错误分类(鉴权/余额/限流等)——"不自动重试防重复计费"的核心 |
| `png-metadata.ts` | PNG 元数据读写(UTF-8 中文) |
| `reverse-prompt.ts` | 图反推提示词 |
| `local-ai-models.ts` | 本地模型清单 + SHA-256 |
| `local-ai-model-manager.ts` | 模型下载 / SHA-256 校验 / 断点续传 / 原子安装 |
| `outpaint-limits.ts` | 画布常量 `CANVAS_MULTIPLE`/`CANVAS_MAX_EDGE`/`CANVAS_MAX_PIXELS`（与 `src/lib/creative` 一致性测试） |
| `local-ai-limits.ts` | 本地 AI 上限 `LOCAL_AI_MAX_EDGE`/`LOCAL_AI_MAX_PIXELS`（与 `src/lib/local-ai` 一致性测试） |
| `data-url.ts` | `stripDataUrlPrefix`：dataURL 去前缀超集正则 `/^data:image\/[^;]+;base64,/i`（与 `src/lib/media` 一致性测试） |

## WHERE TO LOOK
| 任务 | 文件 |
|------|------|
| 改 IPC 处理 / 窗口行为 | `main.ts` |
| 改 IPC 通道名 | `channels.ts` + `preload.ts` 内联处同步（`tests/preload-channels.test.ts` 校验两端一致） |
| 加渲染进程桥方法 | `preload.ts`(同步改 `src/global.d.ts` 的 `imageStudio` 声明) |
| 改跨进程共享类型 | `../shared/types`（唯一定义处；本目录仅 `import type` + `export type` re-export） |
| 原子写 / 网络 / 目录选择助手 | `fs-utils.ts` / `net-utils.ts` / `directory-manager.ts` |
| 图库 / 队列持久化 | `{gallery,queue}-store.ts` |
| 多供应商配置 / 角色解析 / 迁移 | `model-config.ts`（纯逻辑）+ `main.ts`（`loadModelConfig`/`saveModelConfig`/`providerCredential`/`resolveRole`/`SETTINGS_GET`/`SETTINGS_SAVE`/`SETTINGS_TEST`） |
| 平台适配器 / 预设表 | `providers/`（`types.ts` 接口、`presets.ts` 注册表 `getAdapter`/`getPreset`、`hunyuan-image.ts`；新增平台 = 一条预设 + 一个适配器模块，未知 api 走 openai 默认路径） |
| 报错分类 / 计费安全 | `generation-error.ts` |
| 本地模型下载 / 校验 | `local-ai-model-manager.ts` + `local-ai-models.ts` |
| PNG 元数据 / 反推 | `png-metadata.ts` / `reverse-prompt.ts` |
| 更新通道 / 自动更新偏好 | `main.ts` 的 `updateChannelPref` / `autoUpdatePref` / `applyUpdatePreferences`(keytar) + `updates:*` IPC |
| 窗口显示时序 / 启动页兜底 | `main.ts` 的 `createWindow()`（`show:false` + `ready-to-show` 显示 + 4s 兜底 timer；渲染层退场判定在 `../src/lib/splash.ts`） |

## KEY RULES
- IPC handler 一律返回 `{ ok: boolean; ...; error?: string }`
- 主进程 i18n（v3.12）：①**locale 单例**——`i18n.ts` 的 `getMainLocale`/`setMainLocale` 是原生面文案真相；`main.ts` 的 `applyMainLocale(locale)` 同时写 `currentLocale`（快照/保存真相）+ `setMainLocale`（覆盖启动 4 处赋值 + `SETTINGS_SET_LOCALE`）。②**原生面文案经 `mt(key, params?)`**——状态 message（`update.*`）、更新弹窗、目录对话框、文件过滤器；`UpdateStatus.code` 与 `mt` key 同名（如 `update.available`），`applyMainLocale` 切语言后按 `code` 重建 `updateStatus.message` 并 broadcast。③**目录对话框懒求值**——`DirectoryManagerOptions.dialogTitle` 支持 `string | (() => string)`，`choose()` 打开时求值（否则 module 顶层 `createDirectoryManager` 会在 locale 恢复前冻结为 zh）。④**locale 持久化**——`parseLocale` 仅 "zh"|"en"；`resolveLocale(config, fallback)`（缺省跟随 `app.getLocale()`）；`rebuildModelConfig(payload, locale)` 保存时并入 locale（`SettingsSavePayload` 无 locale 字段，防普通保存丢语言）；`SETTINGS_SET_LOCALE` 合法才写盘、非法 `{ok:false,error}` 不写。⑤**code 协议**——主进程 IPC 失败返回 `{ok:false,error,code?:IpcCode,params?}`；code 联合：`GenerationErrorCode`（生成）/`IpcCode`（IPC）/`LocalAIModelProgressCode`（模型下载）/`UpdateStatus.code`（更新）；新增 code = 改 `shared/types.d.ts` 联合 + 主进程分支 + en 分片三键；`shell.openPath` 的 OS 动态错误串刻意不造码。
- 统一进度推送：主进程发进度一律经 `emitProgress(win, event)`（`PROGRESS_UPDATE="progress:update"` 通道，`win` 为 null 或 `isDestroyed()` 时静默跳过）；事件形状为 `TaskProgressEvent`（`shared/types.d.ts`）。增强/反推/导出为**单例操作**，id 固定为 `prompt-enhance`/`prompt-reverse`/`gallery-export`，渲染层不传 requestId；真实百分比不可知时 `progress` 必须缺省（渲染层显示不定态斜纹 + 秒表），**禁止**用时间映射冒充完成度；既有 `image:progress`/`localAI:modelProgress`/`update:status` 三条推送保持原样不改。
- Bearer 只挂在 `target.origin === new URL(baseUrl).origin` 的请求上(防密钥外泄)
- 文件写必走临时文件 + `fs.rename`，EPERM/EACCES/EBUSY 重试 3 次
- 模型安装必须先校验 SHA-256 再原子落地；队列任务失败绝不自动重试
- 多供应商配置契约：①密钥仅经 keytar，账户名 `provider:<id>`，legacy 供应商沿用旧 `default` 账户；元数据 `userData/model-config.json` **永不含 `apiKey`**（`stripProviderSecrets` 强制剥离）；②保存固定五步序——D12 校验 → `runSavePlan` 写变更密钥（任一失败即中止、不写 JSON）→ 剥离密钥后 `atomicWriteJson` 写 JSON（`payload.providers` 为权威全量集合）→ best-effort 删 `removalProviderIds`（`legacy` 跳过）→ best-effort GC **仅** `provider:` 前缀且 ≠ `provider:legacy` 的孤儿密钥，绝不触碰 `default*`/saveDir/modelDir/更新偏好等账户；③首次启动 `loadModelConfig` 从旧 `default:*` 键合成 legacy「默认服务」供应商（含模型角色标注），旧键永不删除；JSON 损坏时按固定名 `model-config.corrupt.json` 幂等备份 + 内存恢复视图（不覆盖原文件、不写盘）
- 删除保护服务端强制（D9）：`removal=(当前 JSON 差集) ∪ payload.removedProviderIds`；被 **active**（queued/running）队列 job 的 `providerId` 引用时整单返回 `{ok:false,error:"供应商有未完成任务"}`（角色引用由 D12 校验，删除前必须同批改绑）
- 队列执行按 **入队快照** 解析（job 顶层 `providerId`/`model`，`resolveJobBinding` 纯配置、零 keytar 读）；原供应商/模型缺失时 fail-closed（"原供应商不可用" / "原任务缺少模型记录"），绝不回退当前绑定或自动重试；`queue:retry` 默认沿用原快照，可通过 `{useCurrentBinding:true}` 切换（当前未绑定则拒绝）
- 热路径每请求恰 1 次 keytar 读：`resolveRole` 只做配置解析（零读），凭据由 `callImages` 内部 `resolveProvider(id)` 单次现场解析；`providerHasKey` 的多次读取仅出现在设置页/刷新路径
- `settings:clear` 通道保留但渲染层无调用者（D8 已核实，仅 `channels.ts`/`preload.ts`/`global.d.ts` 暴露），语义保持原样，勿据其改契约
- 更新双偏好经 keytar 存 `${ACCOUNT}:updateChannel`(stable|beta|alpha，默认 stable) 与 `${ACCOUNT}:autoUpdate`(true|false，默认 true；兼容旧键 `checkUpdatesAtStartup`，仅 "false" 视为关闭)。`applyUpdatePreferences()` 将通道映射为 electron-updater `channel`(stable→latest / beta→beta / alpha→alpha)、`allowPrerelease`(非 stable 即 true)，并强制 `allowDowngrade=false` 防 beta→stable 静默降级；`autoDownload` 跟随自动更新开关。`configureAutoUpdater()` 先置 `autoDownload=false` 作安全默认，再由 `applyUpdatePreferences()` 按持久偏好开启——偏好读取失败也绝不会未经同意自动下载。`updates:setChannel` / `updates:setAutoUpdate` 失败时返回 `{ ok:false, error }`（IPC 不 reject，渲染层可回滚）。
- 隐藏的第三个更新渠道 `alpha`（内测，无公开入口）：解锁标志存 keytar `${ACCOUNT}:alphaChannelUnlocked`("true"|"false"，仅主进程读写，渲染层只知结果不知键名)。渲染层经设置页「当前版本：v…」5 连击手势（相邻间隔 ≤1.5s）调用 `updates:setAlphaUnlocked(true)` 解锁，随后渠道网格出现第三按钮「Alpha 测试版」与「退出内测」按钮。`updates:setChannel` 在 `next === "alpha"` 且未解锁时拒绝并返回 `{ ok:false, error:"Alpha 测试渠道尚未解锁" }`。`updates:get` 额外返回 `alphaUnlocked`（解锁标志或当前渠道已是 alpha 均为 true，保持状态一致）。退出内测（`updates:setAlphaUnlocked(false)`）：清除标志；若当前渠道为 alpha 则回写 `updateChannel=stable`、调用 `applyUpdatePreferences()`，并在自动更新开启且已打包时立即重查更新。electron-updater GitHubProvider 渠道序 stable(latest) < alpha < beta 单向升级，无需改 feed。
- 启动检查仅在 `app.isPackaged && autoUpdatePref()` 时触发(延迟 5s)；自动更新开启时后台自动下载(`update-available` 不弹框)，关闭时 `update-available` 才弹下载确认。`autoInstallOnAppQuit=false` 始终保留——安装前必须由用户确认，禁止改为 true。切换通道后若开启自动更新且已打包，立即重查更新。
- GitHub provider 无 `beta.yml` 时 beta 通道会 404 并回落到 `latest.yml`；beta 通道依赖 `allowPrerelease=true`。
- Dev 走 `http://127.0.0.1:5173`(`--dev` + VITE_DEV_SERVER_URL)，prod 走 `../dist-renderer/index.html`；`electron .` 加载 `dist-electron/main.js` 编译产物——`npm run dev` 已内置 `tsc -p tsconfig.electron.json` 前置编译，改 `electron/*.ts` 后必须重跑 dev（主进程不热重载，否则跑的是旧产物）。
- `main.ts` 硬编码 `LEGACY_SAVE_DIR`(行 59)，仅 try/catch 降级
- `main.ts` 启动早期（模块顶层、app ready 前）`app.commandLine.appendSwitch("force_high_performance_gpu")`（下划线形式；不得改连字符、不得移到 ready 之后）：Windows 双显卡下 Chromium WebGPU 忽略 powerPreference 且单适配器（crbug 369219127 / chromium:329211593），本地 AI 推理默认落核显——此开关为浏览器级强制（Chromium ≥145 在 Windows 生效、单显卡机器无影响）；原生后端备选（DirectML，未实施）评估见 `../docs/review/local-ai-gpu-backend-feasibility.md`。
- 跨进程共享类型唯一来源 `../shared/types`（`shared/types.d.ts`）：本目录一律 `import type`，需对外导出时用 `export type { X } from "../shared/types"`（本仓 `isolatedModules`；异名映射如 `ImageResponse`↔`ApiImage`、`BinaryPayload`↔`BinaryInput`）。
- IPC 通道名字符串唯一来源 `channels.ts`：`main.ts` 的 `ipcMain.handle` / `webContents.send` 引用常量；`preload.ts` 出于沙箱限制**刻意内联**字符串（sandboxed preload 不能 `require` 本地模块，否则 `dist-electron/preload.js` 的 `require("./channels")` 运行时失败 → `window.imageStudio` 不暴露 → 窗口白屏），两端一致性由 `tests/preload-channels.test.ts` 双向锁定；字符串本身是对外契约，不得改动。
- 主进程可测纯模块（`constants`/`channels`/`model-config`/`outpaint-limits`/`local-ai-limits`/`data-url`）不得含 IPC/副作用，供 vitest 直接导入；原子写/重试/超时/目录选择等重复已收敛至 `fs-utils`/`net-utils`/`directory-manager`。
- 平台适配器层 `providers/`：纯逻辑无副作用、可被 vitest 直接导入；`getAdapter(api)` 未命中注册表返回 `undefined` → 上层 `callImages` 走 openai 默认路径（零回归）；适配器只强制 `generate(ctx, fetcher?)`（`fetcher` 可注入供单测），`listModels` 可选；混元单次只出一张（`n>1` 抛 `parameters`）、`size` 直传前哨兵校验（宽高 [256,8192]、面积 ≤ 16777216，越界抛 `parameters`、绝不缩放）、HTTP 200 但 body 含 `error` 同样抛错（错误文本含「接口/模型不存在」时归类 `endpoint`，其余走 `classifyHttpError`）；预设与自定义共用 `ProviderConfig`（仅多一个可选 `api`）；预设数据只经 `settings:get` 快照下发，渲染层绝不 import 本目录。
- `BrowserWindow.backgroundColor`（`#fdf5f9`）现仅兜底窗口首帧底色（页面加载前防白闪）：`scrollbar-gutter` 槽位与透明滚动条轨道由渲染层 `.app` 自身背景绘制（见 `src/styles.css` v2.1 四层背景），不再依赖此值配色；保留它用于启动过渡。（Electron 44 的 overlay 滚动条 electron#53350 不可用，勿再走该方案）
- 窗口为系统原生 WCO 模型（`titleBarStyle:'hidden'` + `titleBarOverlay` 对象，见 `createWindow()`）：禁止 `transparent:true`/`hasShadow:false`/`thickFrame:false`（会丢阴影与边缘 resize 能力），保留 `backgroundColor:"#fdf5f9"`；拖拽由渲染层 `header` 承担，其右上角原生按钮条以 `env(titlebar-area-*)` + `header::after` 从拖拽区挖除。
- 启动页窗口时序（v3.14）：`createWindow` 必须保持 `show:false` + `win.once("ready-to-show", () => win.show())` + 4s 兜底 timer（`setTimeout` 内守卫 `isDestroyed`/`isVisible`）——窗口一出场即 React 首帧（启动页），消灭「先露 backgroundColor 纯色底再跳界面」的空窗；兜底防加载失败 / 极慢时窗口永不显示。不得移除 `show:false` 或兜底；渲染层退场判定见 `src/lib/splash.ts`（最短 1800ms / 上限 6s / reduced-motion 直通）。
- 应用菜单已移除（`Menu.setApplicationMenu(null)`）：编辑类快捷键依赖输入框内 Chromium 原生行为；dev 快捷键（F12 / Ctrl+Shift+I / Ctrl+R / Ctrl+Shift+R / F5）经 `win.webContents.on("before-input-event")` 保留，且仅在 `--dev` 下注册，不用 `globalShortcut`（避免全局生效）。
- 窗口控制走 `window:*` 通道（`minimize`/`toggleMaximize`/`close`/`isMaximized`/`getZoom`/`setZoom`，均以 `BrowserWindow.fromWebContents(event.sender)` 判空后操作），并在 `maximize`/`unmaximize` 时向渲染层 `send("window:maximized-changed", boolean)`；渲染层自绘窗口按钮已移除、改用系统原生 WCO 按钮，`window:*` IPC 与桥方法保持不变。
