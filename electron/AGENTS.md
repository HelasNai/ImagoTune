# electron/ — 主进程目录

## OVERVIEW
Electron 主进程：窗口、IPC、本地存储、OpenAI 兼容 API、本地 AI 模型管理；tsc(CommonJS) 编译到 dist-electron。

## STRUCTURE
| 文件 | 职责 |
|------|------|
| `main.ts` | 入口(854 行)：系统原生 WCO 窗口(1180x820、`titleBarStyle:'hidden'` + 透明 `titleBarOverlay`)、`local-ai-model://` 协议、已移除应用菜单(`Menu.setApplicationMenu(null)`)、窗口控制 IPC(`window:*` 6 个 handler + `window:maximized-changed` 推送)、electron-updater 双偏好(更新通道 stable/beta + 自动更新)、全部 63 个 `ipcMain.handle`（通道名引用 `channels.ts`） |
| `channels.ts` | IPC 通道名常量单一来源（`main.ts` / `preload.ts` 共用；字符串即对外契约，不得改） |
| `constants.ts` | 默认模型 `DEFAULT_IMAGE_MODEL`/`DEFAULT_CHAT_MODEL` + `INBOX_PROJECT_ID`（纯模块，与 `src/lib/constants` 一致性测试） |
| `fs-utils.ts` | `ensureDir`/`atomicWriteJson`/`readJsonWithLegacy`/`replaceWithRetry`（原子写 + 重试） |
| `net-utils.ts` | `joinBase`/`withTimeout`/`errorMessage`（网络请求共享助手） |
| `directory-manager.ts` | 目录选择/打开/恢复默认的共享实现（依赖 `dialog`/keytar，不计入纯逻辑测试） |
| `preload.ts` | `contextBridge` 暴露 `window.imageStudio`(~15 组方法 + 事件订阅) |
| `gallery-store.ts` | 图库持久化：原子写(tmp+rename)、损坏项隔离恢复 |
| `queue-store.ts` | 持久串行队列(上限 100)、legacy 迁移、附件存 `.bin`；禁止自动重试 |
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
| 改 IPC 通道名 | `channels.ts`（`main.ts` / `preload.ts` 引用处同步） |
| 加渲染进程桥方法 | `preload.ts`(同步改 `src/global.d.ts` 的 `imageStudio` 声明) |
| 改跨进程共享类型 | `../shared/types`（唯一定义处；本目录仅 `import type` + `export type` re-export） |
| 原子写 / 网络 / 目录选择助手 | `fs-utils.ts` / `net-utils.ts` / `directory-manager.ts` |
| 图库 / 队列持久化 | `{gallery,queue}-store.ts` |
| 报错分类 / 计费安全 | `generation-error.ts` |
| 本地模型下载 / 校验 | `local-ai-model-manager.ts` + `local-ai-models.ts` |
| PNG 元数据 / 反推 | `png-metadata.ts` / `reverse-prompt.ts` |
| 更新通道 / 自动更新偏好 | `main.ts` 的 `updateChannelPref` / `autoUpdatePref` / `applyUpdatePreferences`(keytar) + `updates:*` IPC |

## KEY RULES
- IPC handler 一律返回 `{ ok: boolean; ...; error?: string }`
- Bearer 只挂在 `target.origin === new URL(baseUrl).origin` 的请求上(防密钥外泄)
- 文件写必走临时文件 + `fs.rename`，EPERM/EACCES/EBUSY 重试 3 次
- 模型安装必须先校验 SHA-256 再原子落地；队列任务失败绝不自动重试
- 更新双偏好经 keytar 存 `${ACCOUNT}:updateChannel`(stable|beta|alpha，默认 stable) 与 `${ACCOUNT}:autoUpdate`(true|false，默认 true；兼容旧键 `checkUpdatesAtStartup`，仅 "false" 视为关闭)。`applyUpdatePreferences()` 将通道映射为 electron-updater `channel`(stable→latest / beta→beta / alpha→alpha)、`allowPrerelease`(非 stable 即 true)，并强制 `allowDowngrade=false` 防 beta→stable 静默降级；`autoDownload` 跟随自动更新开关。`configureAutoUpdater()` 先置 `autoDownload=false` 作安全默认，再由 `applyUpdatePreferences()` 按持久偏好开启——偏好读取失败也绝不会未经同意自动下载。`updates:setChannel` / `updates:setAutoUpdate` 失败时返回 `{ ok:false, error }`（IPC 不 reject，渲染层可回滚）。
- 隐藏的第三个更新渠道 `alpha`（内测，无公开入口）：解锁标志存 keytar `${ACCOUNT}:alphaChannelUnlocked`("true"|"false"，仅主进程读写，渲染层只知结果不知键名)。渲染层经设置页「当前版本：v…」5 连击手势（相邻间隔 ≤1.5s）调用 `updates:setAlphaUnlocked(true)` 解锁，随后渠道网格出现第三按钮「Alpha 测试版」与「退出内测」按钮。`updates:setChannel` 在 `next === "alpha"` 且未解锁时拒绝并返回 `{ ok:false, error:"Alpha 测试渠道尚未解锁" }`。`updates:get` 额外返回 `alphaUnlocked`（解锁标志或当前渠道已是 alpha 均为 true，保持状态一致）。退出内测（`updates:setAlphaUnlocked(false)`）：清除标志；若当前渠道为 alpha 则回写 `updateChannel=stable`、调用 `applyUpdatePreferences()`，并在自动更新开启且已打包时立即重查更新。electron-updater GitHubProvider 渠道序 stable(latest) < alpha < beta 单向升级，无需改 feed。
- 启动检查仅在 `app.isPackaged && autoUpdatePref()` 时触发(延迟 5s)；自动更新开启时后台自动下载(`update-available` 不弹框)，关闭时 `update-available` 才弹下载确认。`autoInstallOnAppQuit=false` 始终保留——安装前必须由用户确认，禁止改为 true。切换通道后若开启自动更新且已打包，立即重查更新。
- GitHub provider 无 `beta.yml` 时 beta 通道会 404 并回落到 `latest.yml`；beta 通道依赖 `allowPrerelease=true`。
- Dev 走 `http://127.0.0.1:5173`(`--dev` + VITE_DEV_SERVER_URL)，prod 走 `../dist-renderer/index.html`；`electron .` 加载 `dist-electron/main.js` 编译产物——`npm run dev` 已内置 `tsc -p tsconfig.electron.json` 前置编译，改 `electron/*.ts` 后必须重跑 dev（主进程不热重载，否则跑的是旧产物）。
- `main.ts` 硬编码 `LEGACY_SAVE_DIR`(行 58)，仅 try/catch 降级
- 跨进程共享类型唯一来源 `../shared/types`（`shared/types.d.ts`）：本目录一律 `import type`，需对外导出时用 `export type { X } from "../shared/types"`（本仓 `isolatedModules`；异名映射如 `ImageResponse`↔`ApiImage`、`BinaryPayload`↔`BinaryInput`）。
- IPC 通道名字符串唯一来源 `channels.ts`：`main.ts` 的 `ipcMain.handle` / `webContents.send` 与 `preload.ts` 的 `ipcRenderer.invoke/on` 均引用常量；字符串本身是对外契约，不得改动。
- 主进程可测纯模块（`constants`/`channels`/`outpaint-limits`/`local-ai-limits`/`data-url`）不得含 IPC/副作用，供 vitest 直接导入；原子写/重试/超时/目录选择等重复已收敛至 `fs-utils`/`net-utils`/`directory-manager`。
- `BrowserWindow.backgroundColor`（`#fdf5f9`）现仅兜底窗口首帧底色（页面加载前防白闪）：`scrollbar-gutter` 槽位与透明滚动条轨道由渲染层 `.app` 自身背景绘制（见 `src/styles.css` v2.1 四层背景），不再依赖此值配色；保留它用于启动过渡。（Electron 44 的 overlay 滚动条 electron#53350 不可用，勿再走该方案）
- 窗口为系统原生 WCO 模型（`titleBarStyle:'hidden'` + `titleBarOverlay` 对象，见 `createWindow()`）：禁止 `transparent:true`/`hasShadow:false`/`thickFrame:false`（会丢阴影与边缘 resize 能力），保留 `backgroundColor:"#fdf5f9"`；拖拽由渲染层 `header` 承担，其右上角原生按钮条以 `env(titlebar-area-*)` + `header::after` 从拖拽区挖除。
- 应用菜单已移除（`Menu.setApplicationMenu(null)`）：编辑类快捷键依赖输入框内 Chromium 原生行为；dev 快捷键（F12 / Ctrl+Shift+I / Ctrl+R / Ctrl+Shift+R / F5）经 `win.webContents.on("before-input-event")` 保留，且仅在 `--dev` 下注册，不用 `globalShortcut`（避免全局生效）。
- 窗口控制走 `window:*` 通道（`minimize`/`toggleMaximize`/`close`/`isMaximized`/`getZoom`/`setZoom`，均以 `BrowserWindow.fromWebContents(event.sender)` 判空后操作），并在 `maximize`/`unmaximize` 时向渲染层 `send("window:maximized-changed", boolean)`；渲染层自绘窗口按钮已移除、改用系统原生 WCO 按钮，`window:*` IPC 与桥方法保持不变。
