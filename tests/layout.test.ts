import { describe, expect, it } from "vitest";
import {
  applySharedLayout,
  clearPlacement,
  createEmptySnapshot,
  decodeLayoutCode,
  effectivePlacement,
  encodeLayoutCode,
  ensureModePlacements,
  findFreeSlot,
  GRID_PX,
  isHidden,
  isSharedModule,
  LAYOUT_COLS,
  LAYOUT_MODULES,
  moduleDef,
  occupiedInMode,
  rectsOverlap,
  resolveAllConflicts,
  resolveVerticalLayout,
  setHidden,
  setPlacement,
  sizeFlags,
  snapToGrid,
  visibleModuleIds,
} from "../src/lib/layout";

describe("layout module registry", () => {
  it("13 个模块、id 唯一", () => {
    expect(LAYOUT_MODULES.length).toBe(13);
    expect(new Set(LAYOUT_MODULES.map((item) => item.id)).size).toBe(13);
  });

  it("通用模块恰好 8 个（三模式全可见），专属模块 5 个", () => {
    const shared = LAYOUT_MODULES.filter((item) => isSharedModule(item.id));
    expect(shared.map((item) => item.id).sort()).toEqual([
      "controls",
      "negative-prompt",
      "presets",
      "project-strip",
      "prompt",
      "prompt-assistant",
      "prompt-tools",
      "reverse-prompt",
    ]);
  });

  it("visibleModuleIds 按出现模式过滤（含跨两模式的专属模块）", () => {
    expect(visibleModuleIds("outpaint")).toContain("outpaint-panel");
    expect(visibleModuleIds("outpaint")).not.toContain("mask");
    expect(visibleModuleIds("edit")).toEqual(expect.arrayContaining(["mask", "upload", "references", "custom-size"]));
    expect(visibleModuleIds("generate")).not.toContain("upload");
    expect(visibleModuleIds("generate")).toContain("references");
  });

  it("moduleDef 未知 id 抛出中文错误", () => {
    expect(() => moduleDef("nope" as never)).toThrow(/未知布局模块/);
  });
});

describe("layout snapshot layers", () => {
  it("通用模块写入 shared、专属模块写入 modes[mode]（读同一入口解析）", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "generate", "prompt", { x: 1, y: 2, w: 3, h: 4 });
    snapshot = setPlacement(snapshot, "generate", "references", { x: 5, y: 6, w: 7, h: 8 });
    // 通用模块：任一模式读到同一份
    expect(effectivePlacement(snapshot, "generate", "prompt")).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(effectivePlacement(snapshot, "outpaint", "prompt")).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(snapshot.shared.prompt).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(snapshot.modes.generate.prompt).toBeUndefined();
    // 专属模块：只落在本模式的层里
    expect(effectivePlacement(snapshot, "generate", "references")).toEqual({ x: 5, y: 6, w: 7, h: 8 });
    expect(effectivePlacement(snapshot, "edit", "references")).toBeUndefined();
    expect(snapshot.modes.generate.references).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });

  it("专属模块可跨模式各存一份（upload 在 edit 与 outpaint 互不影响）", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "edit", "upload", { x: 0, y: 0, w: 10, h: 2 });
    snapshot = setPlacement(snapshot, "outpaint", "upload", { x: 4, y: 4, w: 12, h: 3 });
    expect(effectivePlacement(snapshot, "edit", "upload")).toEqual({ x: 0, y: 0, w: 10, h: 2 });
    expect(effectivePlacement(snapshot, "outpaint", "upload")).toEqual({ x: 4, y: 4, w: 12, h: 3 });
  });

  it("clearPlacement 从正确的层移除坐标（不可变更新）", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "edit", "prompt", { x: 0, y: 0, w: 1, h: 1 });
    snapshot = setPlacement(snapshot, "edit", "mask", { x: 0, y: 0, w: 1, h: 1 });
    const cleared = clearPlacement(snapshot, "edit", "prompt");
    expect(cleared.shared.prompt).toBeUndefined();
    expect(cleared.modes.edit.mask).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // 原快照不被修改
    expect(snapshot.shared.prompt).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("layout hidden semantics", () => {
  it("通用模块隐藏三模式同步；专属模块只影响本模式", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setHidden(snapshot, "generate", "reverse-prompt", true);
    snapshot = setHidden(snapshot, "edit", "mask", true);
    expect(isHidden(snapshot, "generate", "reverse-prompt")).toBe(true);
    expect(isHidden(snapshot, "outpaint", "reverse-prompt")).toBe(true);
    expect(isHidden(snapshot, "edit", "mask")).toBe(true);
    expect(isHidden(snapshot, "outpaint", "mask")).toBe(false);
  });

  it("重复隐藏不产生重复项；取消隐藏后恢复可见", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setHidden(snapshot, "edit", "presets", true);
    snapshot = setHidden(snapshot, "edit", "presets", true);
    expect(snapshot.hidden.shared.filter((id) => id === "presets").length).toBe(1);
    snapshot = setHidden(snapshot, "edit", "presets", false);
    expect(isHidden(snapshot, "edit", "presets")).toBe(false);
  });

  it("occupiedInMode 排除隐藏项与自身", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "edit", "prompt", { x: 0, y: 0, w: 10, h: 2 });
    snapshot = setPlacement(snapshot, "edit", "negative-prompt", { x: 0, y: 2, w: 10, h: 2 });
    snapshot = setPlacement(snapshot, "edit", "mask", { x: 0, y: 4, w: 10, h: 4 });
    snapshot = setHidden(snapshot, "edit", "mask", true);
    const occupied = occupiedInMode(snapshot, "edit", "prompt");
    expect(occupied).toEqual([{ x: 0, y: 2, w: 10, h: 2 }]);
  });
});

describe("layout snapping and collision", () => {
  it("snapToGrid 四舍五入到 16px 网格线", () => {
    expect(GRID_PX).toBe(16);
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(7)).toBe(0);
    expect(snapToGrid(9)).toBe(16);
    expect(snapToGrid(24)).toBe(32);
    expect(snapToGrid(103)).toBe(96);
  });

  it("rectsOverlap：相交为真，边界相接不算重叠", () => {
    const base = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(base, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap(base, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap(base, { x: 0, y: 10, w: 10, h: 10 })).toBe(false);
    expect(rectsOverlap(base, { x: 20, y: 1, w: 1, h: 1 })).toBe(false);
  });

  it("findFreeSlot：无冲突时原样返回并 clamp 进容器", () => {
    expect(findFreeSlot({ x: 2, y: 3, w: 10, h: 4 }, [])).toEqual({ x: 2, y: 3, w: 10, h: 4 });
    expect(findFreeSlot({ x: 55, y: 0, w: 10, h: 4 }, [])).toEqual({ x: LAYOUT_COLS - 10, y: 0, w: 10, h: 4 });
    expect(findFreeSlot({ x: -5, y: -5, w: 10, h: 4 }, [])).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });

  it("findFreeSlot：宽度超出容器时收缩到容器宽", () => {
    expect(findFreeSlot({ x: 0, y: 0, w: 90, h: 4 }, []).w).toBe(LAYOUT_COLS);
  });

  it("findFreeSlot：冲突时找最近空位且不与任何已占矩形重叠", () => {
    const occupied = [
      { x: 0, y: 0, w: 20, h: 4 },
      { x: 0, y: 4, w: 20, h: 4 },
    ];
    const slot = findFreeSlot({ x: 0, y: 0, w: 20, h: 4 }, occupied);
    expect(rectsOverlap(slot, occupied[0])).toBe(false);
    expect(rectsOverlap(slot, occupied[1])).toBe(false);
    // 最近空位在右侧相邻处（dx=20）或下方（dy=8）；应不会跑远
    expect(Math.abs(slot.x - 0) + Math.abs(slot.y - 0)).toBeLessThanOrEqual(20);
  });

  it("findFreeSlot：被完全包围时仍能找到空位（向下推挤）", () => {
    const occupied = [
      { x: 0, y: 0, w: 60, h: 4 },
      { x: 0, y: 4, w: 20, h: 4 },
      { x: 40, y: 4, w: 20, h: 4 },
    ];
    const slot = findFreeSlot({ x: 0, y: 4, w: 20, h: 4 }, occupied);
    expect(rectsOverlap(slot, occupied[0])).toBe(false);
    expect(rectsOverlap(slot, occupied[1])).toBe(false);
    expect(rectsOverlap(slot, occupied[2])).toBe(false);
  });
});

describe("layout vertical resolve (push-down)", () => {
  it("无重叠时保持意图 y", () => {
    const tops = resolveVerticalLayout([
      { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 10 } },
      { id: "controls", placement: { x: 0, y: 10, w: 40, h: 6 } },
    ]);
    expect(tops.prompt).toBe(0);
    expect(tops.controls).toBe(10);
  });

  it("纵向重叠时下推到上者底边之下", () => {
    const tops = resolveVerticalLayout([
      { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 10 } },
      { id: "controls", placement: { x: 0, y: 5, w: 40, h: 6 } },
    ]);
    expect(tops.controls).toBe(10);
  });

  it("横向不重叠的模块互不影响（并排）", () => {
    const tops = resolveVerticalLayout([
      { id: "prompt", placement: { x: 0, y: 0, w: 20, h: 10 } },
      { id: "controls", placement: { x: 20, y: 5, w: 20, h: 6 } },
    ]);
    expect(tops.controls).toBe(5);
  });

  it("链式推挤：被推者继续把更下方者推走", () => {
    const tops = resolveVerticalLayout([
      { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 10 } },
      { id: "controls", placement: { x: 0, y: 5, w: 40, h: 6 } },
      { id: "presets", placement: { x: 0, y: 12, w: 40, h: 4 } },
    ]);
    expect(tops.controls).toBe(10);
    expect(tops.presets).toBe(16);
  });

  it("实测高度大于快照 h 时按实测推挤", () => {
    const tops = resolveVerticalLayout([
      { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 5 }, measuredH: 10 },
      { id: "controls", placement: { x: 0, y: 6, w: 40, h: 4 } },
    ]);
    expect(tops.controls).toBe(10);
  });
});

describe("layout ensure placements", () => {
  it("空快照按模式补齐所有可见模块（全宽、纵向递增）", () => {
    const next = ensureModePlacements(createEmptySnapshot(), "edit");
    const ids = visibleModuleIds("edit");
    for (const id of ids) expect(effectivePlacement(next, "edit", id)).toBeTruthy();
    const tops = ids.map((id) => effectivePlacement(next, "edit", id)!.y);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(effectivePlacement(next, "edit", "mask")!.w).toBe(LAYOUT_COLS);
  });

  it("补位高度为 px → 行等价换算（mask minH 240px → 15 行，而非 240 行）", () => {
    const next = ensureModePlacements(createEmptySnapshot(), "edit");
    expect(effectivePlacement(next, "edit", "mask")!.h).toBe(Math.ceil(240 / GRID_PX));
    expect(Math.ceil(240 / GRID_PX)).toBe(15);
    // 非整除 px 也向上取整（references 120px → 8 行）
    const gen = ensureModePlacements(createEmptySnapshot(), "generate");
    expect(effectivePlacement(gen, "generate", "references")!.h).toBe(Math.ceil(120 / GRID_PX));
  });

  it("已有坐标的模块不被改动，只补缺失", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "generate", "prompt", { x: 2, y: 3, w: 40, h: 8 });
    const next = ensureModePlacements(snapshot, "generate");
    expect(effectivePlacement(next, "generate", "prompt")).toEqual({ x: 2, y: 3, w: 40, h: 8 });
    // 其余 generate 可见模块全部有了坐标
    for (const id of visibleModuleIds("generate")) {
      expect(effectivePlacement(next, "generate", id)).toBeTruthy();
    }
  });

  it("通用模块的补位写入 shared（三模式共享）", () => {
    const next = ensureModePlacements(createEmptySnapshot(), "generate");
    expect(next.shared.prompt).toBeTruthy();
    expect(effectivePlacement(next, "outpaint", "prompt")).toEqual(next.shared.prompt);
  });
});

describe("layout share code", () => {
  it("编码只含通用模块（专属不进码），解码完整还原坐标与隐藏", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "generate", "prompt", { x: 2, y: 3, w: 40, h: 8 });
    snapshot = setPlacement(snapshot, "generate", "controls", { x: 0, y: 12, w: 40, h: 4 });
    snapshot = setPlacement(snapshot, "edit", "mask", { x: 1, y: 1, w: 20, h: 10 });
    snapshot = setHidden(snapshot, "generate", "reverse-prompt", true);
    const code = encodeLayoutCode(snapshot);
    expect(code.startsWith("ITL1:")).toBe(true);
    const decoded = decodeLayoutCode(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.shared.prompt).toEqual({ x: 2, y: 3, w: 40, h: 8 });
    expect(decoded!.shared.controls).toEqual({ x: 0, y: 12, w: 40, h: 4 });
    expect(decoded!.shared.mask).toBeUndefined();
    expect(decoded!.hidden).toEqual(["reverse-prompt"]);
  });

  it("拒绝无前缀 / 坏 base64 / 坏 JSON / 错误版本", () => {
    expect(decodeLayoutCode("hello")).toBeNull();
    expect(decodeLayoutCode("ITL1:!!!not-base64!!!")).toBeNull();
    expect(decodeLayoutCode("ITL1:" + btoa("not json"))).toBeNull();
    expect(decodeLayoutCode("ITL1:" + btoa(JSON.stringify({ v: 2, m: {} })))).toBeNull();
  });

  it("忽略非法模块、非通用模块与越界数值；全无有效坐标视为无效", () => {
    const payload = { v: 1, m: { nope: [0, 0, 1, 1], mask: [0, 0, 1, 1], prompt: [0, 0, -5, 4], controls: [-1, 0, 4, 4], presets: [0, 0, 4, 4] }, h: ["nope", "mask", "presets"] };
    const decoded = decodeLayoutCode("ITL1:" + btoa(JSON.stringify(payload)));
    expect(decoded).not.toBeNull();
    expect(decoded!.shared.prompt).toBeUndefined();
    expect(decoded!.shared.controls).toBeUndefined();
    expect(decoded!.shared.presets).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(decoded!.hidden).toEqual(["presets"]);
    expect(decodeLayoutCode("ITL1:" + btoa(JSON.stringify({ v: 1, m: { mask: [0, 0, 1, 1] }, h: [] })))).toBeNull();
  });
});

describe("layout import application", () => {
  it("只替换通用池，专属层原样保留", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "edit", "mask", { x: 1, y: 1, w: 20, h: 10 });
    snapshot = setPlacement(snapshot, "generate", "prompt", { x: 9, y: 9, w: 9, h: 9 });
    const next = applySharedLayout(snapshot, { prompt: { x: 1, y: 2, w: 30, h: 6 }, controls: { x: 0, y: 9, w: 30, h: 4 } }, ["presets"]);
    expect(next.shared.prompt).toEqual({ x: 1, y: 2, w: 30, h: 6 });
    expect(next.shared.controls).toEqual({ x: 0, y: 9, w: 30, h: 4 });
    expect(next.modes.edit.mask).toEqual({ x: 1, y: 1, w: 20, h: 10 });
    expect(next.hidden.shared).toEqual(["presets"]);
  });

  it("码中缺失的通用模块坐标被清除（交由补位处理）", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "generate", "prompt", { x: 1, y: 1, w: 10, h: 4 });
    snapshot = setPlacement(snapshot, "generate", "controls", { x: 1, y: 6, w: 10, h: 4 });
    const next = applySharedLayout(snapshot, { prompt: { x: 2, y: 2, w: 10, h: 4 } }, []);
    expect(next.shared.prompt).toEqual({ x: 2, y: 2, w: 10, h: 4 });
    expect(next.shared.controls).toBeUndefined();
  });

  it("resolveAllConflicts：专属模块与新通用位置冲突时让位（通用优先、不重叠）", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "edit", "mask", { x: 0, y: 0, w: 30, h: 10 });
    snapshot = applySharedLayout(snapshot, { prompt: { x: 0, y: 0, w: 30, h: 8 } }, []);
    const next = resolveAllConflicts(snapshot, "edit");
    const prompt = effectivePlacement(next, "edit", "prompt")!;
    const mask = effectivePlacement(next, "edit", "mask")!;
    expect(prompt).toEqual({ x: 0, y: 0, w: 30, h: 8 });
    expect(rectsOverlap(prompt, mask)).toBe(false);
    expect(mask).not.toEqual({ x: 0, y: 0, w: 30, h: 10 });
  });

  it("resolveAllConflicts：通用模块之间重叠也会被消解（导入方窗口更窄的场景）", () => {
    let snapshot = createEmptySnapshot();
    snapshot = applySharedLayout(snapshot, { prompt: { x: 0, y: 0, w: 60, h: 8 }, controls: { x: 0, y: 2, w: 60, h: 4 } }, []);
    const next = resolveAllConflicts(snapshot, "generate");
    const prompt = effectivePlacement(next, "generate", "prompt")!;
    const controls = effectivePlacement(next, "generate", "controls")!;
    expect(rectsOverlap(prompt, controls)).toBe(false);
  });
});

describe("layout size flags (width tiers)", () => {
  it("阈值边界：等于阈值不触发，阈值 -1 触发", () => {
    // controls：compact 680 / narrow 560
    expect(sizeFlags("controls", 680)).toEqual({ compact: false, narrow: false });
    expect(sizeFlags("controls", 679)).toEqual({ compact: true, narrow: false });
    expect(sizeFlags("controls", 560)).toEqual({ compact: true, narrow: false });
    expect(sizeFlags("controls", 559)).toEqual({ compact: true, narrow: true });
  });

  it("双档模块：窄于 narrow 时两档同时为真", () => {
    // project-strip：compact 700 / narrow 480
    expect(sizeFlags("project-strip", 700)).toEqual({ compact: false, narrow: false });
    expect(sizeFlags("project-strip", 699)).toEqual({ compact: true, narrow: false });
    expect(sizeFlags("project-strip", 479)).toEqual({ compact: true, narrow: true });
  });

  it("widthPx <= 0（尚未测量）不触发任何档位", () => {
    expect(sizeFlags("controls", 0)).toEqual({ compact: false, narrow: false });
    expect(sizeFlags("controls", -100)).toEqual({ compact: false, narrow: false });
  });

  it("无档位模块（prompt / mask / presets）恒为 false/false", () => {
    for (const id of ["prompt", "mask", "presets"] as const) {
      expect(sizeFlags(id, 100)).toEqual({ compact: false, narrow: false });
      expect(sizeFlags(id, 1)).toEqual({ compact: false, narrow: false });
    }
  });

  it("未登记的 id 返回全 false 且不抛错", () => {
    expect(() => sizeFlags("nope" as never, 300)).not.toThrow();
    expect(sizeFlags("nope" as never, 300)).toEqual({ compact: false, narrow: false });
  });

  it("单档模块按表生效（negative-prompt 仅 compact 636；prompt-assistant 仅 narrow 440）", () => {
    expect(sizeFlags("negative-prompt", 636)).toEqual({ compact: false, narrow: false });
    expect(sizeFlags("negative-prompt", 635)).toEqual({ compact: true, narrow: false });
    expect(sizeFlags("prompt-assistant", 440)).toEqual({ compact: false, narrow: false });
    expect(sizeFlags("prompt-assistant", 439)).toEqual({ compact: false, narrow: true });
  });
});
