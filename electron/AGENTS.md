# electron/ — 主进程目录

## OVERVIEW
Electron 主进程：窗口、IPC、本地存储、OpenAI 兼容 API、本地 AI 模型管理；tsc(CommonJS) 编译到 dist-electron。

## STRUCTURE
| 文件 | 职责 |
|------|------|
| `main.ts` | 入口(~864 行)：无边框窗口(1180x820、`frame:false`)、`local-ai-model://` 协议、已移除应用菜单(`Menu.setApplicationMenu(null)`)、窗口控制 IPC(`window:*` 6 个 handler + `window:maximized-changed` 推送)、electron-updater 双偏好(更新通道 stable/beta + 自动更新)、全部 62 个 `ipcMain.handle` |
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

## WHERE TO LOOK
| 任务 | 文件 |
|------|------|
| 改 IPC 处理 / 窗口行为 | `main.ts` |
| 加渲染进程桥方法 | `preload.ts`(同步改 `src/global.d.ts`) |
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
- 更新双偏好经 keytar 存 `${ACCOUNT}:updateChannel`(stable|beta，默认 stable) 与 `${ACCOUNT}:autoUpdate`(true|false，默认 true；兼容旧键 `checkUpdatesAtStartup`，仅 "false" 视为关闭)。`applyUpdatePreferences()` 将通道映射为 electron-updater `channel`(beta→beta / stable→latest)、`allowPrerelease`(beta 才 true)，并强制 `allowDowngrade=false` 防 beta→stable 静默降级；`autoDownload` 跟随自动更新开关。`configureAutoUpdater()` 先置 `autoDownload=false` 作安全默认，再由 `applyUpdatePreferences()` 按持久偏好开启——偏好读取失败也绝不会未经同意自动下载。`updates:setChannel` / `updates:setAutoUpdate` 失败时返回 `{ ok:false, error }`（IPC 不 reject，渲染层可回滚）。
- 启动检查仅在 `app.isPackaged && autoUpdatePref()` 时触发(延迟 5s)；自动更新开启时后台自动下载(`update-available` 不弹框)，关闭时 `update-available` 才弹下载确认。`autoInstallOnAppQuit=false` 始终保留——安装前必须由用户确认，禁止改为 true。切换通道后若开启自动更新且已打包，立即重查更新。
- GitHub provider 无 `beta.yml` 时 beta 通道会 404 并回落到 `latest.yml`；beta 通道依赖 `allowPrerelease=true`。
- Dev 走 `http://127.0.0.1:5173`(`--dev` + VITE_DEV_SERVER_URL)，prod 走 `../dist-renderer/index.html`
- `main.ts` 硬编码 `LEGACY_SAVE_DIR`(行 27)，仅 try/catch 降级
- `BrowserWindow.backgroundColor` 取页面右缘近似浅粉白（`#fdf5f9`）：`scrollbar-gutter` 槽位与滚动条透明轨道透出此色，须与渲染层页面底色协调，否则右上角出现色差带。（Electron 44 的 overlay 滚动条 electron#53350 不可用，勿再走该方案）
- 本应用为无边框窗口（`frame:false`）：禁止 `transparent:true`/`hasShadow:false`/`thickFrame:false`（会丢阴影与边缘 resize 能力），保留 `backgroundColor:"#fdf5f9"`；窗口拖拽由渲染层 `header` 的 `app-region: drag` 承担。
- 应用菜单已移除（`Menu.setApplicationMenu(null)`）：编辑类快捷键依赖输入框内 Chromium 原生行为；dev 快捷键（F12 / Ctrl+Shift+I / Ctrl+R / Ctrl+Shift+R / F5）经 `win.webContents.on("before-input-event")` 保留，且仅在 `--dev` 下注册，不用 `globalShortcut`（避免全局生效）。
- 窗口控制走 `window:*` 通道（`minimize`/`toggleMaximize`/`close`/`isMaximized`/`getZoom`/`setZoom`，均以 `BrowserWindow.fromWebContents(event.sender)` 判空后操作），并在 `maximize`/`unmaximize` 时向渲染层 `send("window:maximized-changed", boolean)`。
