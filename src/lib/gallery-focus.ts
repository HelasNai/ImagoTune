// 图库跨页聚焦定位（渲染层纯逻辑，与持久层解耦）。
// 给定「全量（未分页）图库条目 + 目标图片 id」，解析目标所属项目与所在页码；
// 排序与分页语义必须与 electron/gallery-store.ts 的 searchGallery 保持一致。
// 本模块只做定位计算，不涉及 IPC / React。

/** 聚焦定位结果：目标图片所属项目与其在该项目列表中的页码（1 基）。 */
export interface GalleryFocusLocation {
  projectId: string;
  /**
   * 1 基页码（第 1 页 = 1）。
   * 注意：gallery.search 的 page 参数是 0 基，消费方落地时需 -1（见 GalleryWorkspace 的 pendingFocus）。
   */
  page: number;
}

/**
 * 计算目标图片的聚焦位置。
 *
 * - 目标不在 items 中 → 返回 null（调用方按「图片不存在或已被删除」降级）。
 * - 页码按目标在「所属项目自身过滤列表」中的位置计算（ceil(index / pageSize)），
 *   而非全局列表——图库分页本来就是「按项目过滤后」的列表。
 * - 排序比较器与 electron/gallery-store.ts `searchGallery` 完全一致：
 *   oldest = createdAt 升序，newest = createdAt 降序。
 */
export function resolveFocusLocation(
  items: GalleryItem[],
  targetId: string,
  pageSize: number,
  sort: "newest" | "oldest",
): GalleryFocusLocation | null {
  const target = items.find((item) => item.id === targetId);
  if (!target) return null;
  const projectItems = items.filter((item) => item.recipe.projectId === target.recipe.projectId);
  projectItems.sort((a, b) => sort === "oldest"
    ? a.createdAt.localeCompare(b.createdAt)
    : b.createdAt.localeCompare(a.createdAt));
  const index = projectItems.findIndex((item) => item.id === targetId);
  const size = Math.max(1, Math.floor(pageSize) || 1);
  return { projectId: target.recipe.projectId, page: Math.floor(index / size) + 1 };
}
