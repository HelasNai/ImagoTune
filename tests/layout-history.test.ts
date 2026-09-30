import { describe, expect, it } from "vitest";
import {
  createHistory,
  LAYOUT_HISTORY_LIMIT,
  pushHistory,
  redoHistory,
  undoHistory,
} from "../src/lib/layout-history";
import { createEmptySnapshot, setPlacement, type LayoutSnapshot } from "../src/lib/layout";

/** 构造带标记的快照：用通用模块 prompt 的 x 值作为序号，便于断言回退/前进的目标。 */
function snap(marker: number): LayoutSnapshot {
  return setPlacement(createEmptySnapshot(), "generate", "prompt", { x: marker, y: 0, w: 10, h: 4 });
}

/** 读取标记（snap 写入的 x）。 */
function markerOf(snapshot: LayoutSnapshot): number | undefined {
  return snapshot.shared.prompt?.x;
}

describe("layout history", () => {
  it("createHistory 返回空双栈", () => {
    expect(createHistory()).toEqual({ past: [], future: [] });
  });

  it("pushHistory 把旧快照压入 past 并清空 future", () => {
    let history = createHistory();
    history = pushHistory(history, snap(1));
    history = pushHistory(history, snap(2));
    expect(history.past.map(markerOf)).toEqual([1, 2]);
    expect(history.future).toEqual([]);
  });

  it("pushHistory 超过上限 50 时丢弃最旧记录", () => {
    let history = createHistory();
    for (let i = 0; i < LAYOUT_HISTORY_LIMIT + 10; i += 1) {
      history = pushHistory(history, snap(i));
    }
    expect(history.past).toHaveLength(LAYOUT_HISTORY_LIMIT);
    expect(markerOf(history.past[0])).toBe(10);
    expect(markerOf(history.past[history.past.length - 1])).toBe(LAYOUT_HISTORY_LIMIT + 9);
  });

  it("undo 把当前快照移到 future 并返回旧快照", () => {
    const history = pushHistory(createHistory(), snap(1));
    const step = undoHistory(history, snap(2));
    expect(step).not.toBeNull();
    expect(markerOf(step!.snapshot)).toBe(1);
    expect(step!.history.past).toEqual([]);
    expect(step!.history.future.map(markerOf)).toEqual([2]);
  });

  it("redo 把当前快照移回 past 并返回重做快照（undo→redo 往返）", () => {
    const history = pushHistory(createHistory(), snap(1));
    const undone = undoHistory(history, snap(2))!;
    const redone = redoHistory(undone.history, undone.snapshot)!;
    expect(markerOf(redone.snapshot)).toBe(2);
    expect(redone.history.future).toEqual([]);
    expect(redone.history.past.map(markerOf)).toEqual([1]);
  });

  it("redo 后再 undo 可继续回退（连续往返）", () => {
    let history = createHistory();
    history = pushHistory(history, snap(1));
    history = pushHistory(history, snap(2));
    // 当前快照为 snap(3)：undo → 2、undo → 1、redo → 2、redo → 3
    let current = snap(3);
    const u1 = undoHistory(history, current)!;
    expect(markerOf(u1.snapshot)).toBe(2);
    const u2 = undoHistory(u1.history, u1.snapshot)!;
    expect(markerOf(u2.snapshot)).toBe(1);
    const r1 = redoHistory(u2.history, u2.snapshot)!;
    expect(markerOf(r1.snapshot)).toBe(2);
    const r2 = redoHistory(r1.history, r1.snapshot)!;
    expect(markerOf(r2.snapshot)).toBe(3);
    expect(r2.history.future).toEqual([]);
  });

  it("新的 push 清空 future（重做分支失效）", () => {
    const history = pushHistory(createHistory(), snap(1));
    const undone = undoHistory(history, snap(2))!;
    expect(undone.history.future).toHaveLength(1);
    const afterNewPush = pushHistory(undone.history, snap(3));
    expect(afterNewPush.future).toEqual([]);
    expect(afterNewPush.past.map(markerOf)).toEqual([3]);
  });

  it("空历史时 undo / redo 返回 null（no-op）", () => {
    expect(undoHistory(createHistory(), snap(1))).toBeNull();
    expect(redoHistory(createHistory(), snap(1))).toBeNull();
  });

  it("只读不改：push / undo / redo 均不修改入参历史", () => {
    const history = pushHistory(createHistory(), snap(1));
    const snapshotBefore = { past: [...history.past], future: [...history.future] };
    pushHistory(history, snap(2));
    undoHistory(history, snap(3));
    redoHistory(history, snap(3));
    expect(history.past).toEqual(snapshotBefore.past);
    expect(history.future).toEqual(snapshotBefore.future);
  });
});
