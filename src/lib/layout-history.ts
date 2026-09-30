// 渲染层布局历史纯逻辑：编辑会话内的撤销 / 重做栈（仅记录用户对布局的真实改动）。
// 设计约定：
// - 快照不可变（`setPlacement` / `setHidden` 均返回新对象），故栈内直接存引用，无需深拷贝；
// - `past` 存「被替换掉的旧快照」（撤销时回退），`future` 存「撤销出去的快照」（重做时前进）；
// - 任何一次新的 push 都会清空 `future`（用户改动后原重做分支失效）；
// - `past` 上限 LAYOUT_HISTORY_LIMIT，超出丢弃最旧的记录。
// 本文件不 import React / DOM / electron / 第三方包（可被 vitest 直接导入）。

import type { LayoutSnapshot } from "./layout";

/** 撤销栈容量上限（超出后丢弃最旧记录）。 */
export const LAYOUT_HISTORY_LIMIT = 50;

/** 编辑会话内的布局历史（撤销 / 重做双栈）。 */
export type LayoutHistory = {
  past: LayoutSnapshot[];
  future: LayoutSnapshot[];
};

/** 一次撤销 / 重做操作的结果：新历史 + 需要应用的快照（不可用时为 null）。 */
export type LayoutHistoryStep = { history: LayoutHistory; snapshot: LayoutSnapshot } | null;

/** 空历史（进入编辑会话时使用）。 */
export function createHistory(): LayoutHistory {
  return { past: [], future: [] };
}

/**
 * 提交一次改动前调用：把「将被替换的旧快照」压入 `past`，并按上限裁剪、清空 `future`。
 * 返回新历史（不修改入参）。
 */
export function pushHistory(history: LayoutHistory, snapshot: LayoutSnapshot): LayoutHistory {
  const past = [...history.past, snapshot];
  if (past.length > LAYOUT_HISTORY_LIMIT) past.splice(0, past.length - LAYOUT_HISTORY_LIMIT);
  return { past, future: [] };
}

/**
 * 撤销：从 `past` 弹出最近一次旧快照作为要应用的快照，同时把当前快照压入 `future`。
 * 历史为空（无旧快照）时返回 null。
 */
export function undoHistory(history: LayoutHistory, current: LayoutSnapshot): LayoutHistoryStep {
  if (!history.past.length) return null;
  const past = [...history.past];
  const snapshot = past.pop()!;
  return { history: { past, future: [current, ...history.future] }, snapshot };
}

/**
 * 重做：从 `future` 取出队首快照作为要应用的快照，同时把当前快照压回 `past`（同样受上限约束）。
 * 历史为空（无重做分支）时返回 null。
 */
export function redoHistory(history: LayoutHistory, current: LayoutSnapshot): LayoutHistoryStep {
  if (!history.future.length) return null;
  const future = [...history.future];
  const snapshot = future.shift()!;
  const past = [...history.past, current];
  if (past.length > LAYOUT_HISTORY_LIMIT) past.splice(0, past.length - LAYOUT_HISTORY_LIMIT);
  return { history: { past, future }, snapshot };
}
