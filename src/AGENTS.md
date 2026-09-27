# AGENTS.md — src（渲染进程）

## OVERVIEW
React 渲染进程：App 组件 + 全部 UI 状态 + `window.imageStudio` IPC 调用，Vite 构建至 `dist-renderer`。

## STRUCTURE
| 路径 | 作用 |
|------|------|
| `main.tsx` | 入口，**499 行 shell**（同步日期 2026-09-28）：App 根组件仅保留模式路由（generate/edit/outpaint/gallery/local-ai/queue/settings）、header/aside 导航、StudioProvider 包裹、useEffect B-G 订阅（含队列 4 订阅 G）与通知自动关闭计时（v2.7）、灯箱预览、gallery/local-ai 接线回调与 TutorialExperience 挂载；业务状态与逻辑已抽入 `components/`（useComposer/ComposerPanel/ResultPanel/QueuePanel/SettingsPanel 等） |
| `global.d.ts` | `window.imageStudio` 类型声明（IPC 契约）+ `shared/types` 全局别名（`import type * as Shared` + `type X = Shared.X`，共 39 个别名）；跨进程类型唯一定义处为 `shared/types.d.ts` |
| `styles.css` | 版本分区/布局注释（v1.1/v1.2/v1.5.1、v2.0 滚动条、v2.1 滚动容器、v2.2 固定底栏对齐与吞入、v2.3 侧栏贴底、v2.4 侧栏钉左+主区内容右半区居中、v2.5 头部光晕伪元素收敛/拖拽区不外溢、v2.7 通知弹窗移出 header 拖拽区、v2.8 应用内全局对话框）；`:root` 含 `--header-h` / `--aside-width` / `--layout-max-width` / `--dock-bleed` / `--page-bg`（页面底色渐变，html 与 .app 共用）等布局 token |
| `assets/` | 2 张 PNG 标题图 |
| `components/` | 面板：`ComposerPanel`(360) / `ResultPanel`(183，导出弹层经 `createPortal` 挂到 `.app`) / `QueuePanel`(86，重试可选原供应商/当前绑定) / `SettingsPanel`(651，供应商管理 + 模型角色标注 + 三角色分配 + 隐藏 Alpha 内测渠道解锁手势)；创作域 hook：`useComposer.ts`(662)；对话框：`Dialogs.tsx`(142，`DialogProvider`/`useDialog`：应用内全局输入/确认框，替代原生 prompt/confirm)；IPC 助手：`ipc.ts`(99，`callIpc`/`useIpcAction`：需反馈的 IPC 失败统一上报) / `useKeyboard.ts`(23，`useGlobalKeyDown`/`useEscapeKey`) / `useCopy.ts`(56，文本/图片复制统一反馈) / `useSaveImage.ts`(29) / `useObjectUrl.ts`(22，blob 对象 URL 自动 revoke) / `ImageDropInput.tsx`(87，拖放/粘贴图片输入)；`Combobox.tsx`(215，可搜索下拉：受控输入 + 过滤、IME/Escape 不误选、portal 防裁剪)；共享：`StudioContext.tsx`(`StudioProvider`/`useStudio`/`StudioNotify`；提供 `providers`/`roles`/`refreshSettings`，`imageModel`(生图)/`chatModel`(提示词增强) 为派生值、无 setter) / `types.ts`(`Mode`/`Output`) / `media-utils.ts`(15，仅 re-export `lib/media`) / `queue-utils.ts`(26，recipeFromQueueInput/recipeModeLabel)；既有：GalleryWorkspace(405) / LocalAIToolbox(389) / MaskPainter(57) / TutorialExperience(272) / `icons.tsx`(320，`NavIcon`：内联 Lucide 侧栏图标，无第三方依赖）（行数为同步日期 2026-09-28 实测） |
| `lib/` | 可测试纯函数：creative / local-ai / outpaint / tutorial / format（clamp/roundUp16/parsePixelSize/formatBytes/formatDateTime/modeLabel/formatTags/uniqueBy/compositeFileKey 等）/ media（readImage/canvasToBlob/fileToDataUrl/b64ToDataUrl/b64FromDataUrl，另含 `dataUrlFor`/`b64ToFile`/`drawContain`；`new FileReader` 全仓单点）/ constants（INBOX_PROJECT_ID/默认模型，与 electron 侧一致性测试锁定） |
| `workers/local-ai.worker.ts` | 首行 `/// <reference lib="webworker" />`，WebGPU→WASM 回退推理 |

## WHERE TO LOOK
| 任务 | 位置 |
|------|------|
| UI 状态、模式路由、IPC 调用 | `main.tsx`（壳：路由/导航/Provider/订阅/灯箱）；创作域状态与动作在 `components/useComposer.ts`，面板在 `components/*Panel.tsx` |
| 新增 IPC/共享类型 | 类型定义加在 `shared/types.d.ts`（唯一来源）；渲染层全局别名加在 `src/global.d.ts`，方法签名加在该文件的 `imageStudio` 声明 |
| 需反馈的 IPC 调用 / 失败上报 | `components/ipc.ts`（`callIpc`/`useIpcAction`；best-effort 直连白名单见文件头注释） |
| 多供应商配置 / 三角色模型分配 | `components/SettingsPanel.tsx`（供应商区块 + 模型角色标注 + 模型分配；保存经 `settings.save`）；状态经 `StudioContext` 的 `providers`/`roles`/`refreshSettings` |
| 可搜索下拉（供应商/模型选择） | `components/Combobox.tsx` |
| 画布尺寸校验（16 倍数、单边 ≤3840、总像素） | `lib/creative.ts` |
| 图像算法纯函数（tile/mask/affine） | `lib/local-ai.ts` |
| 外扩几何 | `lib/outpaint.ts` |
| 教程状态机（localStorage key `imagotune:tutorial-state`） | `lib/tutorial.ts` |
| 格式化 / 尺寸解析 / 标签 / 去重助手 | `lib/format.ts` |
| 媒体读取 / 对象 URL / 画布助手（FileReader 单点） | `lib/media.ts`（`components/media-utils.ts` 仅 re-export 兼容层） |
| 默认模型 / inbox 常量（与 electron 一致性测试） | `lib/constants.ts` |
| 复制 / 保存图片 / 按键 / 对象 URL hooks | `components/{useCopy,useSaveImage,useKeyboard,useObjectUrl}.ts` |
| 图库 / 本地 AI / 蒙版 / 教程 UI | `components/` 对应文件 |
| WebGPU 推理 Worker | `workers/local-ai.worker.ts` |
| 系统原生窗口按钮（WCO）/ 无边框拖拽区 | `electron/main.ts` 的 `titleBarStyle:'hidden'` + 透明 `titleBarOverlay`；`styles.css` v1.8 分区（`header` 的 `app-region: drag` + `env(titlebar-area-*)` 预留 + `header::after` no-drag 挖除） |
| 页面滚动容器 / 滚动条外观与横向稳定 | `styles.css` v2.0/v2.1 分区（`.app` 滚动容器 + `scrollbar-gutter` + `::-webkit-scrollbar` + `.app` 四层背景） |
| 固定底栏（加入生成队列）/ 两侧对齐 / 滚动吞入 | `styles.css` v2.2 分区（`.run-row` 中心 = `50% - --scrollbar-w/2 + --aside-width/2`，即 [侧栏, 可用宽] 区间中点、与 `.composer` 卡片同轴；宽 = 卡片宽 + 2×`--dock-bleed`；`main:has(.composer)` 缩底部留白使滚到底时卡片尾部沉入底栏） |

## KEY RULES
- 所有 IPC 走 `window.imageStudio`（contextBridge），绝不直接访问 electron。
- 渲染层禁止使用原生 `window.prompt/confirm/alert`：Electron 不支持 prompt（同步抛 `Error: prompt() is not supported.`，重命名/编辑会静默失败），原生 confirm 在 Windows 有焦点丢失 bug（electron#31917，表现为窗口假死）。需要输入/确认一律走 `components/Dialogs.tsx` 的 `useDialog()`（`requestText`→`Promise<string|null>`、`requestConfirm`→`Promise<boolean>`；取消语义：文本返回 `null`、确认返回 `false`）。`useComposer.ts` 在 `DialogProvider` 之外调用，两个函数必须以参数注入，不能内部 `useDialog()`。
- 新增全屏弹层（`.xxx-modal`）必须同步登记到 `styles.css` 的四处集中列表，否则视觉/动效不一致：①基础遮罩照抄 `.dialog-modal`——`position:fixed; z-index; inset:0; background:var(--overlay-bg); backdrop-filter:blur(var(--overlay-blur))`，**全弹层（`.lightbox`/`.compare-modal`/`.export-modal`/`.dialog-modal`/`.tutorial-modal`）共用 `:root` 的这两个 token 作为单一来源，勿写死数值**（v2.8：用户反馈 10px 模糊度过高，统一为轻量毛玻璃）；②700px 窄屏的 padding `2vh 2vw`/卡片 `15px`+`16px` 圆角收缩；③入场动画：**遮罩元素进 `overlay-in`（纯淡入）、卡片元素进 `modal-pop`（缩放上浮）**，切勿把遮罩登记进 `modal-pop`——两条规则同特异性时后定义的 `modal-pop` 会覆盖 `overlay-in`，导致整个遮罩层连带背景一起缩放弹出（v2.8 修复：`.tutorial-center-modal` 名字像卡片、实为遮罩容器（DOM 上是 `.tutorial-modal tutorial-center-modal`，卡片是内层 `.tutorial-center` section），曾被误登记进 modal-pop，表现为点击「新手教程」时遮罩整体弹出）；④`prefers-reduced-motion` 的 `animation: none !important` 组。`.tutorial-shade`（教程聚光灯挖洞遮罩）语义不同，故意不引用 overlay token。
- 需要测试的纯逻辑移入 `src/lib/*.ts`（供 Vitest 覆盖）；React 组件与 `main.tsx` 无测试。
- 模型状态经 `StudioContext` 的 `providers`/`roles` 快照提供，`imageModel`(生图) / `chatModel`(提示词增强) 是派生值（绑定缺失时回退默认），**无 setter**；改动或切换绑定后调用 `refreshSettings()` 重新拉取 `settings:get`。`SettingsPanel` 是唯一写设置处（`settings.save`：providers 全量 + `removedProviderIds` + roles + autoArchive）。
- 跨进程共享类型唯一定义处为 `shared/types.d.ts`；`src/global.d.ts` 仅保留 `window.imageStudio` 声明与 `Shared.*` 全局别名（新共享类型加在 `shared/types.d.ts`，勿在本目录重复声明，否则 TS2300）。
- 需用户反馈的 IPC 调用统一走 `components/ipc.ts` 的 `callIpc`/`useIpcAction`（成功路径不变；`{ok:false}` / reject 统一上报）；best-effort 调用保持直连（`on*` 订阅、`windowControls.*`、`clipboard.copyText/copyImage`，白名单见该文件头注释）。
- 媒体助手单点在 `lib/media.ts`；`components/media-utils.ts` 仅为 re-export 兼容层，勿再新增读取/画布实现（`new FileReader` 全仓仅 `lib/media.ts` 一处）。
- API 密钥输入：`type="password"`、placeholder `"已保存，输入新值可覆盖"`、保存后 `setApiKey("")`；绝不回显已存密钥。
- `TutorialExperience.tsx` 第 173 行注释：effect 依赖刻意跟随教程状态，勿"修正"为剔除 tutorial state。
- `lib/tutorial.ts` 的 localStorage 只存教程状态，绝不写 API 密钥/提示词/图片。
- 固定头部：header 为 position:fixed、width:100%（覆盖到窗口右缘）；页面滚动由 .app 承担（margin-top:--header-h、height:calc(100vh - --header-h)、overflow-y:auto）——滚动条（含 gutter 槽位）只在 header 下方出现。header 同时是 WCO 窗口的拖拽区（app-region: drag；padding-right 与 header::after 按 env(titlebar-area-*) 为系统原生按钮条让位），其内所有可交互元素（button/input/select/textarea/a/[role=button]）必须 no-drag，否则拖拽会吞掉点击；禁止给 header 或祖先加 transform/filter/contain（会制造 fixed 包含块，破坏 header 的视口定位）。
- 窗口控制（WCO）：Windows 原生最小化/最大化/关闭按钮由系统叠加在页面上、页面渐变透出；`header` 仍是拖拽区，右上角原生按钮条用 `env(titlebar-area-width)` / `env(titlebar-area-height)` 从拖拽区与 `padding-right` 中挖除（`header::after` 置 `no-drag`；回退值 138px / 32px，预留 padding 回退 158px）。原生按钮条区域禁止放任何可交互元素（会被系统按钮吞掉点击）。**拖拽区按元素「布局矩形」收集且不受 `overflow:hidden` 裁剪——header 内伪元素/子元素的布局矩形必须落在 header 盒内**：v2.5 修复，`header::before` 的 530×530 光晕圆盒（right:-145/top:-230）曾让 header 下方、窗口右侧一大块（至 y≈300px）被误判为拖拽/标题栏区（拖动=拖窗口、双击=最大化）；现改为 `inset:0` + 显式半径径向渐变 + `clip-path` 圆复刻视觉，`tools/verify-window-chrome.cjs` 已加对应断言防回归。通知弹窗（`.feedback-toast`）是 header 的**兄弟节点而非后代，无法挖除 header 的拖拽矩形**——必须整体移出 header 盒（v2.7：`top: calc(var(--header-h) + 12px)`，≤700px 为 +10px）并显式 `app-region: no-drag` 兜底；原 `top:16px` 既在拖拽盒内、又压住右上原生按钮条（点击会被系统按钮吞掉）。内部布局：`.feedback-toast > div` 必须 `flex:1`（否则关闭按钮紧随文本、不贴右上角），其 `button` 必须 `padding:0`（UA 默认 `1px 6px` 会让 16px 叉号在 24px 圆内水平偏心约 2px）。`tools/verify-window-chrome.cjs` 的 TOAST 段已断言（位置/拖拽/no-drag/贴角/同心）。
- 页面滚动由 .app 承担（唯一页面级滚动容器，勿移回 window、勿再嵌套）：window 自身不滚动（模式切换重置滚动走 appRef.scrollTo）；.app 顶部让出 --header-h，滚动条与槽位只出现在 header 下方。
- 左侧栏 `aside`：`position: sticky; top: 0`（贴 .app 滚动端口顶部）+ `min-height: calc(100vh - var(--header-h))`（**必须与 .app 滚动端口等高**，v2.3 修复：旧值额外 -70px 会让侧栏底边悬在窗口底上方、露出页面背景=「侧栏未到底」；改 `--header-h` 或 .app 高度时须同步复核）。内容高于视口时靠 sticky 保持贴顶、滚到 .layout 底时才随之上移。≤700px 的横条布局由媒体查询覆盖为 `min-height: 0`。
- 滚动条：scrollbar-gutter:stable 设在 .app（槽位常驻、页面切换无横向抖动），外观由 ::-webkit-scrollbar 定制（宽 --scrollbar-w；常态 6px、悬停加粗到 10px、颜色不变）；滚动条范围 = .app（header 下方到窗口底），不进入 header 区域。Electron 44 的 overlay 滚动条（electron#53350）不可用，勿再尝试。
- 固定底栏（`.run-row`「加入生成队列」）：`position:fixed` 于视口底部，**中心 = `calc(50% - var(--scrollbar-w)/2 + var(--aside-width)/2)`**（= [侧栏, 窗口可用宽] 区间中点；主区内容在该区间内居中，卡片中心恒等于它、与卡片是否达到宽度上限无关，故底栏用同一式即同轴），宽 = `.composer` 卡片宽 + 两侧各 `--dock-bleed`（10px，对称外扩）；创作模式经 `main:has(.composer)` 的 23px 底部留白，使滚到底时末尾卡片尾部沉入底栏覆盖区（吞入/拉出感，且不露出底栏下缘）。改动底栏高度/`bottom`/`--scrollbar-w`/`--aside-width`/`--main-pad-x` 时须回归核对两侧对齐与吞入深度。
- 主布局（v2.4）：`.layout` **全宽**（`max-width: none` + `margin: 0`；禁止再加宽度上限或 `margin: auto` 居中）——旧版 `.layout` 限宽居中会让侧栏随窗口拉宽持续右漂、与 header 品牌左缘错位（"拉宽后侧栏移动"）。内容宽度上限与水平居中改由 `main > .page-transition` 承担：`max-width: calc(--layout-max-width - --aside-width - 2×--main-pad-x)` + `margin-inline: auto`，即**侧栏钉左不动、主区内容在 [侧栏, 窗口可用宽] 区间内居中**；窗口未达上限时内容占满 main 内容盒（窄窗口行为与旧版逐像素一致）。`.page-transition` 只加宽度/外边距，禁止加 transform（v1.5.2：会成为 .run-row 等 fixed 后代的包含块）。改动 `--layout-max-width` / `--aside-width` / `--main-pad-x` 时须同步复核 `.run-row` 的 left/width（同式绑定）。
- 滚动条槽位与透明轨道只绘制 `.app` 自身背景（不绘制 html canvas 背景与子元素的合成）——页面视觉的全部叠加层必须收拢到 `.app` 背景（v2.1 四层：main 冷白 / .layout 白纱 / 顶部白雾 / `--page-bg` fixed），否则槽位与页面右缘出现竖直色差带。`.layout` / `main` 禁止再加背景：提亮层已上移，加回会在宽窗口（> `--layout-max-width`）下于 .layout 左右缘硬切出竖直边界（v2.1 修复的原始 bug）。`electron/main.ts` 的 `backgroundColor` 现仅兜底首帧底色，不再承担槽位配色。
- 页面底色放 `html`（`background-image: var(--page-bg)` 渐变，fixed 视口对齐），`body` 不设 `background`；`.app` 以同一变量自绘一份（槽位绘制所需）；`header` 背景用 `:root` 的 `--header-bg`（单一来源）。
- 图标统一：全部图标（侧栏、教程主题、空状态、关闭/删除/重命名/进度等操作）一律走 `components/icons.tsx` 的 `NavIcon`（内联 Lucide，`stroke=currentColor`，无第三方依赖）。`icons.tsx` 是**已用 + 备用图标池**（共 45 个，`paths` 与 `NavIconName` 一一对应，tsc 通过 `Record` 强制完整）。图标名类型 `TutorialIconName`（教程主题）定义在 `lib/tutorial.ts`，`NavIconName` 在其上扩展。新增/复用图标只在此登记，禁止再嵌入字符图标或用 CSS `content:` 生成图标。
- 通知（`.feedback-toast`）生命周期（v2.7，时长常量 `NOTICE_TOAST_MS`/`ERROR_TOAST_MS` 在 `main.tsx` 顶部）：成功/信息 5s、错误/需处理 12s 自动关闭（新通知重置计时，手动关闭立即清空）；**不随模式切换清空**（切换侧栏只重置滚动与右键菜单）；新 notice 出现时清掉旧错误，避免成功提示被更高优先级的旧错误遮挡。
- 无 DOM/UI 测试工具链，此目录不写 UI 测试。
- 容器光晕渐变禁用「默认 `farthest-corner` + 百分比透明终点」：宽而矮的盒子会让 alpha 在盒边界未归零，出现生硬分界线。改用 `circle closest-side at …`（或按最小边算出的显式 px 半径），保证在盒内完全淡出。
