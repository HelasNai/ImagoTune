// 组件间共享类型（main.tsx ↔ ComposerPanel ↔ ResultPanel）。
// 约束：仅类型、零运行时代码，避免组件间互相 import 造成循环依赖。
// 注：ImageRecipeV1 等 IPC 契约类型仍由 src/global.d.ts 提供（此处直接引用全局声明）。

export type Mode = "generate" | "edit" | "outpaint" | "gallery" | "local-ai" | "queue" | "settings";

export type Output = {
  id: string;
  b64: string;
  createdAt: number;
  galleryId?: string;
  recipe: ImageRecipeV1;
};
