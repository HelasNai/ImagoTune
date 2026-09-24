# AGENTS.md — src（渲染进程）

## OVERVIEW
React 渲染进程：App 组件 + 全部 UI 状态 + `window.imageStudio` IPC 调用，Vite 构建至 `dist-renderer`。

## STRUCTURE
| 路径 | 作用 |
|------|------|
| `main.tsx` | 入口，约 1678 行巨型单文件：App 根组件、全部 UI 状态、模式路由（generate/edit/outpaint/gallery/local-ai/queue/settings）、所有 `window.imageStudio` 调用逻辑 |
| `global.d.ts` | `window.imageStudio` 类型声明（IPC 契约）+ 共享类型（ImageRecipeV1/QueueJob/GalleryItem/UpdateStatus） |
| `styles.css` | 版本分区/布局注释（v1.1/v1.2/v1.5.1/v1.6 折叠头部、v2.0 滚动条、reduced-motion 回退）；`:root` 含 `--header-h` / `--header-h-current` / `--layout-offset` 等布局 token |
| `assets/` | 2 张 PNG 标题图 |
| `components/` | GalleryWorkspace / LocalAIToolbox / MaskPainter / TutorialExperience / `icons.tsx`（`NavIcon`：内联 Lucide 侧栏图标，无第三方依赖） |
| `lib/` | 可测试纯函数：creative / local-ai / outpaint / tutorial |
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
| 折叠头部（滚动浓缩到侧栏上方） | `styles.css` v1.6 分区；`main.tsx` 的 `headerCondensed` / `headerSpacerRef` |
| 整页滚动条外观与横向稳定 | `styles.css` v2.0 分区（`scrollbar-gutter` + `::-webkit-scrollbar`） |

## KEY RULES
- 所有 IPC 走 `window.imageStudio`（contextBridge），绝不直接访问 electron。
- 需要测试的纯逻辑移入 `src/lib/*.ts`（供 Vitest 覆盖）；React 组件与 `main.tsx` 无测试。
- `window.imageStudio` 类型单一来源为 `src/global.d.ts`，新共享类型加在那里。
- API 密钥输入：`type="password"`、placeholder `"已保存，输入新值可覆盖"`、保存后 `setApiKey("")`；绝不回显已存密钥。
- `TutorialExperience.tsx` 第 173 行注释：effect 依赖刻意跟随教程状态，勿"修正"为剔除 tutorial state。
- `lib/tutorial.ts` 的 localStorage 只存教程状态，绝不写 API 密钥/提示词/图片。
- 折叠头部：`header` 为 `position:fixed` + 88px `.header-spacer` 占位，IntersectionObserver 观察 spacer 驱动 `.app[data-condensed]`；高度区分 `--header-h`（静态，用于 spacer / `.layout` min-height）与 `--header-h-current`（实时，驱动 header 高度与 aside 的 `top`/`padding`/`min-height`——三者同 duration 过渡做反向补偿，使侧栏顶部紧贴 header 且内容与底部恒定）；动画只过渡 `left/width/height/padding`，禁止给 header 或祖先加 `transform/filter/contain`（会制造 fixed 包含块）。
- 整页滚动保持 window 级：勿把滚动移入 `.layout`/`main`，否则破坏折叠头部对 `.header-spacer` 的 IntersectionObserver 机制。
- 滚动条：`html{scrollbar-gutter:stable}` 恒定 viewport 宽度（消除页面切换横向抖动），外观由 `::-webkit-scrollbar` 定制（宽 `--scrollbar-w`；常态 6px、悬停加粗到 10px、颜色不变）。Electron 44 的 overlay 滚动条（electron#53350）不可用，勿再尝试。
- `scrollbar-gutter` 槽位与透明轨道会透出 **BrowserWindow 底色**（渲染层画不到槽位）——故 `electron/main.ts` 的 `backgroundColor` 取页面/header 右缘近似浅粉白；改页面底色时须同步该值，否则右上角出现色差带。
- 页面底色放 `html`（`background-image` 渐变），`body` 不设 `background`；`header` 背景用 `:root` 的 `--header-bg`（单一来源）。
- 图标统一：全部图标（侧栏、教程主题、空状态、关闭/删除/重命名/进度等操作）一律走 `components/icons.tsx` 的 `NavIcon`（内联 Lucide，`stroke=currentColor`，无第三方依赖）。`icons.tsx` 是**已用 + 备用图标池**（共 44 个，`paths` 与 `NavIconName` 一一对应，tsc 通过 `Record` 强制完整）。图标名类型 `TutorialIconName`（教程主题）定义在 `lib/tutorial.ts`，`NavIconName` 在其上扩展。新增/复用图标只在此登记，禁止再嵌入字符图标或用 CSS `content:` 生成图标。
- 无 DOM/UI 测试工具链，此目录不写 UI 测试。
- 容器光晕渐变禁用「默认 `farthest-corner` + 百分比透明终点」：宽而矮的盒子会让 alpha 在盒边界未归零，出现生硬分界线。改用 `circle closest-side at …`（或按最小边算出的显式 px 半径），保证在盒内完全淡出。
