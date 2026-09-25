# AGENTS.md — src（渲染进程）

## OVERVIEW
React 渲染进程：App 组件 + 全部 UI 状态 + `window.imageStudio` IPC 调用，Vite 构建至 `dist-renderer`。

## STRUCTURE
| 路径 | 作用 |
|------|------|
| `main.tsx` | 入口，约 1739 行巨型单文件：App 根组件、全部 UI 状态、模式路由（generate/edit/outpaint/gallery/local-ai/queue/settings）、所有 `window.imageStudio` 调用逻辑 |
| `global.d.ts` | `window.imageStudio` 类型声明（IPC 契约）+ 共享类型（ImageRecipeV1/QueueJob/GalleryItem/UpdateStatus） |
| `styles.css` | 版本分区/布局注释（v1.1/v1.2/v1.5.1、v2.0 滚动条、v2.1 滚动容器、v2.2 固定底栏对齐与吞入、v2.3 侧栏贴底、v2.4 侧栏钉左+主区内容右半区居中）；`:root` 含 `--header-h` / `--aside-width` / `--layout-max-width` / `--dock-bleed` / `--page-bg`（页面底色渐变，html 与 .app 共用）等布局 token |
| `assets/` | 2 张 PNG 标题图 |
| `components/` | GalleryWorkspace / LocalAIToolbox / MaskPainter / TutorialExperience / WindowControls / `icons.tsx`（`NavIcon`：内联 Lucide 侧栏图标，无第三方依赖） |
| `lib/` | 可测试纯函数：creative / local-ai / outpaint / tutorial / window-controls |
| `workers/local-ai.worker.ts` | 首行 `/// <reference lib="webworker" />`，WebGPU→WASM 回退推理 |

## WHERE TO LOOK
| 任务 | 位置 |
|------|------|
| UI 状态、模式路由、IPC 调用 | `main.tsx` |
| 新增 IPC/共享类型 | `global.d.ts` |
| 画布尺寸校验（16 倍数、单边 ≤3840、总像素） | `lib/creative.ts` |
| 图像算法纯函数（tile/mask/affine） | `lib/local-ai.ts` |
| 外扩几何 | `lib/outpaint.ts` |
| 教程状态机（localStorage key `imagotune:tutorial-state`） | `lib/tutorial.ts` |
| 图库 / 本地 AI / 蒙版 / 教程 UI | `components/` 对应文件 |
| WebGPU 推理 Worker | `workers/local-ai.worker.ts` |
| 窗口控制按钮 / 无边框拖拽区 | `components/WindowControls.tsx`（挂载于 `main.tsx` 的 `.app` 直接子级）+ `styles.css` v1.7 分区（`header` 的 `app-region: drag` 与 `.window-controls` 固定定位） |
| 窗口控制按钮图标名 / aria-label（纯函数） | `lib/window-controls.ts`（`maximizeIconName` / `maximizeAriaLabel`） |
| 页面滚动容器 / 滚动条外观与横向稳定 | `styles.css` v2.0/v2.1 分区（`.app` 滚动容器 + `scrollbar-gutter` + `::-webkit-scrollbar` + `.app` 四层背景） |
| 固定底栏（加入生成队列）/ 两侧对齐 / 滚动吞入 | `styles.css` v2.2 分区（`.run-row` 中心 = `50% - --scrollbar-w/2 + --aside-width/2`，即 [侧栏, 可用宽] 区间中点、与 `.composer` 卡片同轴；宽 = 卡片宽 + 2×`--dock-bleed`；`main:has(.composer)` 缩底部留白使滚到底时卡片尾部沉入底栏） |

## KEY RULES
- 所有 IPC 走 `window.imageStudio`（contextBridge），绝不直接访问 electron。
- 需要测试的纯逻辑移入 `src/lib/*.ts`（供 Vitest 覆盖）；React 组件与 `main.tsx` 无测试。
- `window.imageStudio` 类型单一来源为 `src/global.d.ts`，新共享类型加在那里。
- API 密钥输入：`type="password"`、placeholder `"已保存，输入新值可覆盖"`、保存后 `setApiKey("")`；绝不回显已存密钥。
- `TutorialExperience.tsx` 第 173 行注释：effect 依赖刻意跟随教程状态，勿"修正"为剔除 tutorial state。
- `lib/tutorial.ts` 的 localStorage 只存教程状态，绝不写 API 密钥/提示词/图片。
- 固定头部：header 为 position:fixed、width:100%（覆盖到窗口右缘）；页面滚动由 .app 承担（margin-top:--header-h、height:calc(100vh - --header-h)、overflow-y:auto）——滚动条（含 gutter 槽位）只在 header 下方出现。header 同时是无边框窗口的拖拽区（app-region: drag，padding-right: 158px 为右上角 3×46px 控件留白），其内所有可交互元素（button/input/select/textarea/a/[role=button]）必须 no-drag，否则拖拽会吞掉点击；禁止给 header 或祖先加 transform/filter/contain（会制造 fixed 包含块，破坏 header 的视口定位）。
- 窗口控制：`.window-controls` 为 `.app` 直接子级（**非** `header` 子级），`position: fixed`、`top: 0`、`right: 0`（窗口右上角已无滚动条槽位）、`z-index: 41`（高于 header 的 40、低于页面浮层）；**禁止放进 `header`**——header 是 `isolation:isolate` + `overflow:hidden` 的拖拽区，控件放进去会被限制层叠并可能被裁剪，须保持独立 `fixed` 视口定位。`WindowControls` 的 3 个按钮均 `no-drag`（`type="button"` + 动态 `aria-label`），关闭钮 hover 变红。
- 页面滚动由 .app 承担（唯一页面级滚动容器，勿移回 window、勿再嵌套）：window 自身不滚动（模式切换重置滚动走 appRef.scrollTo）；.app 顶部让出 --header-h，滚动条与槽位只出现在 header 下方。
- 左侧栏 `aside`：`position: sticky; top: 0`（贴 .app 滚动端口顶部）+ `min-height: calc(100vh - var(--header-h))`（**必须与 .app 滚动端口等高**，v2.3 修复：旧值额外 -70px 会让侧栏底边悬在窗口底上方、露出页面背景=「侧栏未到底」；改 `--header-h` 或 .app 高度时须同步复核）。内容高于视口时靠 sticky 保持贴顶、滚到 .layout 底时才随之上移。≤700px 的横条布局由媒体查询覆盖为 `min-height: 0`。
- 滚动条：scrollbar-gutter:stable 设在 .app（槽位常驻、页面切换无横向抖动），外观由 ::-webkit-scrollbar 定制（宽 --scrollbar-w；常态 6px、悬停加粗到 10px、颜色不变）；滚动条范围 = .app（header 下方到窗口底），不进入 header 区域。Electron 44 的 overlay 滚动条（electron#53350）不可用，勿再尝试。
- 固定底栏（`.run-row`「加入生成队列」）：`position:fixed` 于视口底部，**中心 = `calc(50% - var(--scrollbar-w)/2 + var(--aside-width)/2)`**（= [侧栏, 窗口可用宽] 区间中点；主区内容在该区间内居中，卡片中心恒等于它、与卡片是否达到宽度上限无关，故底栏用同一式即同轴），宽 = `.composer` 卡片宽 + 两侧各 `--dock-bleed`（10px，对称外扩）；创作模式经 `main:has(.composer)` 的 23px 底部留白，使滚到底时末尾卡片尾部沉入底栏覆盖区（吞入/拉出感，且不露出底栏下缘）。改动底栏高度/`bottom`/`--scrollbar-w`/`--aside-width`/`--main-pad-x` 时须回归核对两侧对齐与吞入深度。
- 主布局（v2.4）：`.layout` **全宽**（`max-width: none` + `margin: 0`；禁止再加宽度上限或 `margin: auto` 居中）——旧版 `.layout` 限宽居中会让侧栏随窗口拉宽持续右漂、与 header 品牌左缘错位（"拉宽后侧栏移动"）。内容宽度上限与水平居中改由 `main > .page-transition` 承担：`max-width: calc(--layout-max-width - --aside-width - 2×--main-pad-x)` + `margin-inline: auto`，即**侧栏钉左不动、主区内容在 [侧栏, 窗口可用宽] 区间内居中**；窗口未达上限时内容占满 main 内容盒（窄窗口行为与旧版逐像素一致）。`.page-transition` 只加宽度/外边距，禁止加 transform（v1.5.2：会成为 .run-row 等 fixed 后代的包含块）。改动 `--layout-max-width` / `--aside-width` / `--main-pad-x` 时须同步复核 `.run-row` 的 left/width（同式绑定）。
- 滚动条槽位与透明轨道只绘制 `.app` 自身背景（不绘制 html canvas 背景与子元素的合成）——页面视觉的全部叠加层必须收拢到 `.app` 背景（v2.1 四层：main 冷白 / .layout 白纱 / 顶部白雾 / `--page-bg` fixed），否则槽位与页面右缘出现竖直色差带。`.layout` / `main` 禁止再加背景：提亮层已上移，加回会在宽窗口（> `--layout-max-width`）下于 .layout 左右缘硬切出竖直边界（v2.1 修复的原始 bug）。`electron/main.ts` 的 `backgroundColor` 现仅兜底首帧底色，不再承担槽位配色。
- 页面底色放 `html`（`background-image: var(--page-bg)` 渐变，fixed 视口对齐），`body` 不设 `background`；`.app` 以同一变量自绘一份（槽位绘制所需）；`header` 背景用 `:root` 的 `--header-bg`（单一来源）。
- 图标统一：全部图标（侧栏、教程主题、空状态、关闭/删除/重命名/进度等操作）一律走 `components/icons.tsx` 的 `NavIcon`（内联 Lucide，`stroke=currentColor`，无第三方依赖）。`icons.tsx` 是**已用 + 备用图标池**（共 45 个，`paths` 与 `NavIconName` 一一对应，tsc 通过 `Record` 强制完整）。图标名类型 `TutorialIconName`（教程主题）定义在 `lib/tutorial.ts`，`NavIconName` 在其上扩展。新增/复用图标只在此登记，禁止再嵌入字符图标或用 CSS `content:` 生成图标。
- 无 DOM/UI 测试工具链，此目录不写 UI 测试。
- 容器光晕渐变禁用「默认 `farthest-corner` + 百分比透明终点」：宽而矮的盒子会让 alpha 在盒边界未归零，出现生硬分界线。改用 `circle closest-side at …`（或按最小边算出的显式 px 半径），保证在盒内完全淡出。
