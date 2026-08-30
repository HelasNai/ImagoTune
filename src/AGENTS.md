# AGENTS.md — src（渲染进程）

## OVERVIEW
React 渲染进程：App 组件 + 全部 UI 状态 + `window.imageStudio` IPC 调用，Vite 构建至 `dist-renderer`。

## STRUCTURE
| 路径 | 作用 |
|------|------|
| `main.tsx` | 入口，约 1662 行巨型单文件：App 根组件、全部 UI 状态、模式路由（generate/edit/outpaint/gallery/local-ai/queue/settings）、所有 `window.imageStudio` 调用逻辑 |
| `global.d.ts` | `window.imageStudio` 类型声明（IPC 契约）+ 共享类型（ImageRecipeV1/QueueJob/GalleryItem/UpdateStatus） |
| `styles.css` | 9 段版本分区/布局注释（v1.1/v1.2/v1.5.1、reduced-motion 回退） |
| `assets/` | 2 张 PNG 标题图 |
| `components/` | GalleryWorkspace / LocalAIToolbox / MaskPainter / TutorialExperience |
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
| 教程状态机（localStorage key `ai-image-studio:tutorial-state`） | `lib/tutorial.ts` |
| 图库 / 本地 AI / 蒙版 / 教程 UI | `components/` 对应文件 |
| WebGPU 推理 Worker | `workers/local-ai.worker.ts` |

## KEY RULES
- 所有 IPC 走 `window.imageStudio`（contextBridge），绝不直接访问 electron。
- 需要测试的纯逻辑移入 `src/lib/*.ts`（供 Vitest 覆盖）；React 组件与 `main.tsx` 无测试。
- `window.imageStudio` 类型单一来源为 `src/global.d.ts`，新共享类型加在那里。
- API 密钥输入：`type="password"`、placeholder `"已保存，输入新值可覆盖"`、保存后 `setApiKey("")`；绝不回显已存密钥。
- `TutorialExperience.tsx` 第 173 行注释：effect 依赖刻意跟随教程状态，勿"修正"为剔除 tutorial state。
- `lib/tutorial.ts` 的 localStorage 只存教程状态，绝不写 API 密钥/提示词/图片。
- 无 DOM/UI 测试工具链，此目录不写 UI 测试。
