import { afterEach, describe, expect, it } from "vitest";
import {
  applySharedLayout,
  clearPlacement,
  compactCollapsedItems,
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
  minResizeHeightPx,
  moduleDef,
  moduleLabel,
  occupiedInMode,
  rectsOverlap,
  resolveAllConflicts,
  resolvePushLayout,
  resolveVerticalLayout,
  setHidden,
  setPlacement,
  sizeFlags,
  snapToGrid,
  visibleModuleIds,
} from "../src/lib/layout";
import { setLocale } from "../src/lib/i18n";

// i18n 模块级单例在测试间共享：每例结束复位中文。
afterEach(() => setLocale("zh"));

describe("layout module registry", () => {
  it("9 个模块、id 唯一", () => {
    expect(LAYOUT_MODULES.length).toBe(9);
    expect(new Set(LAYOUT_MODULES.map((item) => item.id)).size).toBe(9);
  });

  it("通用模块恰好 5 个（三模式全可见），专属模块 4 个", () => {
    const shared = LAYOUT_MODULES.filter((item) => isSharedModule(item.id));
    expect(shared.map((item) => item.id).sort()).toEqual([
      "controls",
      "negative-prompt",
      "project-strip",
      "prompt",
      "reverse-prompt",
    ]);
  });

  it("visibleModuleIds 按出现模式过滤（含跨两模式的专属模块）", () => {
    expect(visibleModuleIds("outpaint")).toContain("outpaint-panel");
    expect(visibleModuleIds("outpaint")).not.toContain("mask");
    expect(visibleModuleIds("edit")).toEqual(expect.arrayContaining(["mask", "upload", "references"]));
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
    snapshot = setHidden(snapshot, "edit", "negative-prompt", true);
    snapshot = setHidden(snapshot, "edit", "negative-prompt", true);
    expect(snapshot.hidden.shared.filter((id) => id === "negative-prompt").length).toBe(1);
    snapshot = setHidden(snapshot, "edit", "negative-prompt", false);
    expect(isHidden(snapshot, "edit", "negative-prompt")).toBe(false);
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

describe("vertical resize lower bound", () => {
  it("内容未顶破撑开高度：下限只用定义 minH，实测撑开值不参与（回归「只能拉高不能拉矮」）", () => {
    // 撑开高度 208px，实测同为 208px（minHeight 撑开、内容更矮）
    expect(minResizeHeightPx(96, 208, 208)).toBe(96);
    // 拖动中实测会随撑开高度一起涨（曾拉高到 400px）——绝不能成为下限，否则永远拉不回来
    expect(minResizeHeightPx(96, 400, 400)).toBe(96);
    // 未测量（0）与亚像素噪声（高于撑开高度 0.4px）同样不算顶破
    expect(minResizeHeightPx(96, 0, 208)).toBe(96);
    expect(minResizeHeightPx(96, 320.4, 320)).toBe(96);
  });

  it("内容顶破撑开高度：实测即内容自然高度，下限上取到 16px 行（缩到内容以下视觉无变化）", () => {
    expect(minResizeHeightPx(96, 500, 320)).toBe(512);
    expect(minResizeHeightPx(96, 320.6, 320)).toBe(336);
  });

  it("minH 高于内容时取 minH；下限至少 1 行（16px）", () => {
    expect(minResizeHeightPx(600, 400, 300)).toBe(608);
    expect(minResizeHeightPx(100, 100, 300)).toBe(112);
    expect(minResizeHeightPx(0, 0, 0)).toBe(16);
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
      { id: "negative-prompt", placement: { x: 0, y: 12, w: 40, h: 4 } },
    ]);
    expect(tops.controls).toBe(10);
    expect(tops["negative-prompt"]).toBe(16);
  });

  it("实测高度大于快照 h 时按实测推挤", () => {
    const tops = resolveVerticalLayout([
      { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 5 }, measuredH: 10 },
      { id: "controls", placement: { x: 0, y: 6, w: 40, h: 4 } },
    ]);
    expect(tops.controls).toBe(10);
  });
});

describe("layout compact collapsed (fold shrink)", () => {
  it("折叠模块收缩后，快照底边之下且横向重叠的模块上移差额行数", () => {
    const next = compactCollapsedItems(
      [
        { id: "reverse-prompt", placement: { x: 0, y: 35, w: 64, h: 7 } },
        { id: "references", placement: { x: 0, y: 42, w: 64, h: 8 } },
      ],
      { "reverse-prompt": 3 },
    );
    expect(next.find((item) => item.id === "reverse-prompt")!.placement.h).toBe(3);
    expect(next.find((item) => item.id === "references")!.placement.y).toBe(38);
  });

  it("横向不重叠的模块不受影响", () => {
    const next = compactCollapsedItems(
      [
        { id: "reverse-prompt", placement: { x: 0, y: 35, w: 30, h: 7 } },
        { id: "references", placement: { x: 40, y: 42, w: 24, h: 8 } },
      ],
      { "reverse-prompt": 3 },
    );
    expect(next.find((item) => item.id === "references")!.placement.y).toBe(42);
  });

  it("位于快照底边之上的模块不动（含悬挂重叠者）", () => {
    const next = compactCollapsedItems(
      [
        { id: "reverse-prompt", placement: { x: 0, y: 35, w: 64, h: 7 } },
        { id: "prompt", placement: { x: 0, y: 20, w: 64, h: 4 } },
        { id: "negative-prompt", placement: { x: 0, y: 41, w: 64, h: 3 } },
      ],
      { "reverse-prompt": 3 },
    );
    expect(next.find((item) => item.id === "prompt")!.placement.y).toBe(20);
    expect(next.find((item) => item.id === "negative-prompt")!.placement.y).toBe(41);
  });

  it("目标高度不小于快照 h 时不压缩（gap ≤ 0）", () => {
    const next = compactCollapsedItems(
      [
        { id: "reverse-prompt", placement: { x: 0, y: 35, w: 64, h: 7 } },
        { id: "references", placement: { x: 0, y: 42, w: 64, h: 8 } },
      ],
      { "reverse-prompt": 7 },
    );
    expect(next.find((item) => item.id === "reverse-prompt")!.placement.h).toBe(7);
    expect(next.find((item) => item.id === "references")!.placement.y).toBe(42);
  });

  it("空映射返回等值新数组，且不改动入参对象", () => {
    const items = [{ id: "prompt" as const, placement: { x: 0, y: 0, w: 64, h: 5 } }];
    const next = compactCollapsedItems(items, {});
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
    expect(next[0].placement).not.toBe(items[0].placement);
  });

  it("多个折叠模块按传入顺序逐一压缩（各自释放自己的差额）", () => {
    const next = compactCollapsedItems(
      [
        { id: "reverse-prompt", placement: { x: 0, y: 10, w: 64, h: 7 } },
        { id: "references", placement: { x: 0, y: 17, w: 64, h: 6 } },
        { id: "controls", placement: { x: 0, y: 23, w: 64, h: 5 } },
      ],
      { "reverse-prompt": 3, references: 4 },
    );
    expect(next.find((item) => item.id === "reverse-prompt")!.placement.h).toBe(3);
    expect(next.find((item) => item.id === "references")!.placement.y).toBe(13);
    expect(next.find((item) => item.id === "references")!.placement.h).toBe(4);
    expect(next.find((item) => item.id === "controls")!.placement.y).toBe(17);
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
  it("ITL2 往返：编码只含通用模块（专属不进码），解码完整还原坐标与隐藏（legacy=false）", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "generate", "prompt", { x: 2, y: 3, w: 40, h: 8 });
    snapshot = setPlacement(snapshot, "generate", "controls", { x: 0, y: 12, w: 40, h: 4 });
    snapshot = setPlacement(snapshot, "edit", "mask", { x: 1, y: 1, w: 20, h: 10 });
    snapshot = setHidden(snapshot, "generate", "reverse-prompt", true);
    const code = encodeLayoutCode(snapshot);
    expect(code.startsWith("ITL2:")).toBe(true);
    const decoded = decodeLayoutCode(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.legacy).toBe(false);
    expect(decoded!.shared.prompt).toEqual({ x: 2, y: 3, w: 40, h: 8 });
    expect(decoded!.shared.controls).toEqual({ x: 0, y: 12, w: 40, h: 4 });
    expect(decoded!.shared.mask).toBeUndefined();
    expect(decoded!.hidden).toEqual(["reverse-prompt"]);
  });

  it("拒绝无前缀 / 坏 base64 / 坏 JSON / 错误版本（ITL2 前缀配 v=1、ITL1 前缀配 v=2 均拒绝）", () => {
    expect(decodeLayoutCode("hello")).toBeNull();
    expect(decodeLayoutCode("ITL2:!!!not-base64!!!")).toBeNull();
    expect(decodeLayoutCode("ITL2:" + btoa("not json"))).toBeNull();
    expect(decodeLayoutCode("ITL2:" + btoa(JSON.stringify({ v: 1, m: { prompt: [0, 0, 4, 4] } })))).toBeNull();
    expect(decodeLayoutCode("ITL1:" + btoa(JSON.stringify({ v: 2, m: { prompt: [0, 0, 4, 4] } })), 16)).toBeNull();
  });

  it("忽略非法模块、非通用模块与越界数值；全无有效坐标视为无效", () => {
    const payload = { v: 2, m: { nope: [0, 0, 1, 1], mask: [0, 0, 1, 1], prompt: [0, 0, -5, 4], controls: [-1, 0, 4, 4], "negative-prompt": [0, 0, 4, 4] }, h: ["nope", "mask", "negative-prompt"] };
    const decoded = decodeLayoutCode("ITL2:" + btoa(JSON.stringify(payload)));
    expect(decoded).not.toBeNull();
    expect(decoded!.legacy).toBe(false);
    expect(decoded!.shared.prompt).toBeUndefined();
    expect(decoded!.shared.controls).toBeUndefined();
    expect(decoded!.shared["negative-prompt"]).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(decoded!.hidden).toEqual(["negative-prompt"]);
    expect(decodeLayoutCode("ITL2:" + btoa(JSON.stringify({ v: 2, m: { mask: [0, 0, 1, 1] }, h: [] })))).toBeNull();
  });

  it("数值护栏在取整后校验：y 上限 4000（行单位），超界条目被丢弃", () => {
    const ok = decodeLayoutCode("ITL2:" + btoa(JSON.stringify({ v: 2, m: { prompt: [0, 4000.4, 4, 400] } })));
    expect(ok).not.toBeNull();
    expect(ok!.shared.prompt).toEqual({ x: 0, y: 4000, w: 4, h: 400 });
    expect(decodeLayoutCode("ITL2:" + btoa(JSON.stringify({ v: 2, m: { prompt: [0, 4000.6, 4, 4] } })))).toBeNull();
  });

  it("ITL1 旧码换算：x/w 列值不变，y/h 按 colWidth/GRID_PX 换算为行（legacy=true）", () => {
    // colWidth=16 = GRID_PX：旧比例单位 y=2 → 2 行、h=4 → 4 行；x/w 原样保留
    const payload = { v: 1, m: { prompt: [10, 2, 40, 4] }, h: ["negative-prompt"] };
    const decoded = decodeLayoutCode("ITL1:" + btoa(JSON.stringify(payload)), 16);
    expect(decoded).not.toBeNull();
    expect(decoded!.legacy).toBe(true);
    expect(decoded!.shared.prompt).toEqual({ x: 10, y: 2, w: 40, h: 4 });
    expect(decoded!.hidden).toEqual(["negative-prompt"]);
  });

  it("ITL1 换算结果钳制：x 钳入列范围；换算后 h 超 400 行的条目被丢弃", () => {
    // controls：x=60 + w=10 → x' 钳到 64-10=54；y=1×16/16=1 行、h=2×16/16=2 行
    // prompt：h=1000 单位 × 16/16 = 1000 行 > 400 → 整条丢弃（旧码换算不得撑爆布局）
    const payload = { v: 1, m: { prompt: [0, 0, 4, 1000], controls: [60, 1, 10, 2] }, h: [] };
    const decoded = decodeLayoutCode("ITL1:" + btoa(JSON.stringify(payload)), 16);
    expect(decoded).not.toBeNull();
    expect(decoded!.shared.prompt).toBeUndefined();
    expect(decoded!.shared.controls).toEqual({ x: 54, y: 1, w: 10, h: 2 });
  });

  it("ITL1 缺少或非法 colWidth 时一律拒绝", () => {
    const code = "ITL1:" + btoa(JSON.stringify({ v: 1, m: { prompt: [0, 0, 4, 4] }, h: [] }));
    expect(decodeLayoutCode(code)).toBeNull();
    expect(decodeLayoutCode(code, 0)).toBeNull();
    expect(decodeLayoutCode(code, -1)).toBeNull();
    expect(decodeLayoutCode(code, Number.NaN)).toBeNull();
  });
});

describe("layout import application", () => {
  it("只替换通用池，专属层原样保留", () => {
    let snapshot = createEmptySnapshot();
    snapshot = setPlacement(snapshot, "edit", "mask", { x: 1, y: 1, w: 20, h: 10 });
    snapshot = setPlacement(snapshot, "generate", "prompt", { x: 9, y: 9, w: 9, h: 9 });
    const next = applySharedLayout(snapshot, { prompt: { x: 1, y: 2, w: 30, h: 6 }, controls: { x: 0, y: 9, w: 30, h: 4 } }, ["negative-prompt"]);
    expect(next.shared.prompt).toEqual({ x: 1, y: 2, w: 30, h: 6 });
    expect(next.shared.controls).toEqual({ x: 0, y: 9, w: 30, h: 4 });
    expect(next.modes.edit.mask).toEqual({ x: 1, y: 1, w: 20, h: 10 });
    expect(next.hidden.shared).toEqual(["negative-prompt"]);
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

  it("无档位模块（prompt / mask）恒为 false/false", () => {
    for (const id of ["prompt", "mask"] as const) {
      expect(sizeFlags(id, 100)).toEqual({ compact: false, narrow: false });
      expect(sizeFlags(id, 1)).toEqual({ compact: false, narrow: false });
    }
  });

  it("未登记的 id 返回全 false 且不抛错", () => {
    expect(() => sizeFlags("nope" as never, 300)).not.toThrow();
    expect(sizeFlags("nope" as never, 300)).toEqual({ compact: false, narrow: false });
  });

  it("单档模块按表生效（negative-prompt 仅 compact 636；upload 仅 narrow 440）", () => {
    expect(sizeFlags("negative-prompt", 636)).toEqual({ compact: false, narrow: false });
    expect(sizeFlags("negative-prompt", 635)).toEqual({ compact: true, narrow: false });
    expect(sizeFlags("upload", 440)).toEqual({ compact: false, narrow: false });
    expect(sizeFlags("upload", 439)).toEqual({ compact: false, narrow: true });
  });
});

describe("layout push resolve (dragged module priority)", () => {
  it("无重叠时保持各自意图 y，moving 不受影响", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: 0, w: 20, h: 4 } },
        { id: "controls", placement: { x: 30, y: 0, w: 20, h: 4 } },
        { id: "negative-prompt", placement: { x: 0, y: 20, w: 40, h: 4 } },
      ],
      "prompt",
    );
    expect(tops.prompt).toBe(0);
    expect(tops.controls).toBe(0);
    expect(tops["negative-prompt"]).toBe(20);
  });

  it("moving 落到下方模块上（横向重叠）→ 被压者下推到 moving 底边之下", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: 5, w: 40, h: 10 } },
        { id: "controls", placement: { x: 0, y: 8, w: 40, h: 4 } },
      ],
      "prompt",
    );
    expect(tops.prompt).toBe(5);
    expect(tops.controls).toBe(15);
  });

  it("链式推挤：A 推 B，B 被推后的底边继续推 C", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 10 } },
        { id: "controls", placement: { x: 0, y: 5, w: 40, h: 6 } },
        { id: "negative-prompt", placement: { x: 0, y: 12, w: 40, h: 4 } },
      ],
      "prompt",
    );
    expect(tops.controls).toBe(10);
    expect(tops["negative-prompt"]).toBe(16);
  });

  it("moving 落进悬挂模块中部（moving.y > 模块 y 且 < 模块底边）→ moving 下修到其底边；原处模块被修正后的 moving 推走", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 10 } },
        { id: "controls", placement: { x: 0, y: 5, w: 40, h: 4 } },
        { id: "negative-prompt", placement: { x: 0, y: 10, w: 40, h: 4 } },
      ],
      "controls",
    );
    expect(tops.controls).toBe(10);
    expect(tops["negative-prompt"]).toBe(14);
  });

  it("上方压制 + 链式推挤组合：moving 被悬挂模块下压后，连带把下方链条整体推走", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 10 } },
        { id: "controls", placement: { x: 0, y: 6, w: 40, h: 4 } },
        { id: "negative-prompt", placement: { x: 0, y: 10, w: 40, h: 4 } },
        { id: "reverse-prompt", placement: { x: 0, y: 14, w: 40, h: 4 } },
      ],
      "controls",
    );
    expect(tops.controls).toBe(10);
    expect(tops["negative-prompt"]).toBe(14);
    expect(tops["reverse-prompt"]).toBe(18);
  });

  it("同 y 竞争者（x 更小且横向重叠）在 moving 修正后的位置上 → 让位给 moving（moving 优先）", () => {
    const tops = resolvePushLayout(
      [
        { id: "controls", placement: { x: 0, y: 5, w: 30, h: 4 } },
        { id: "prompt", placement: { x: 20, y: 5, w: 40, h: 4 } },
      ],
      "prompt",
    );
    expect(tops.prompt).toBe(5);
    expect(tops.controls).toBe(9);
  });

  it("横向不重叠（边界相接）→ 谁都不动", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: 5, w: 20, h: 10 } },
        { id: "controls", placement: { x: 20, y: 5, w: 20, h: 10 } },
      ],
      "prompt",
    );
    expect(tops.prompt).toBe(5);
    expect(tops.controls).toBe(5);
  });

  it("measuredH 参与高度（快照 h 很小、实测很大 → 按实测推挤）", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 3 }, measuredH: 10 },
        { id: "controls", placement: { x: 0, y: 4, w: 40, h: 2 } },
      ],
      "prompt",
    );
    expect(tops.prompt).toBe(0);
    expect(tops.controls).toBe(10);
  });

  it("movingId 不在 items 中 → 不抛错，按普通收纳（无优先级）", () => {
    const items = [
      { id: "prompt", placement: { x: 0, y: 0, w: 40, h: 10 } },
      { id: "controls", placement: { x: 0, y: 5, w: 40, h: 4 } },
    ] as const;
    const tops = resolvePushLayout([...items], "mask");
    expect(tops.prompt).toBe(0);
    expect(tops.controls).toBe(10);
  });

  it("moving.y < 0 时钳到 0（只调 y、clamp 下界），其余模块仍正常推挤", () => {
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 0, y: -5, w: 40, h: 4 } },
        { id: "controls", placement: { x: 0, y: 0, w: 40, h: 4 } },
      ],
      "prompt",
    );
    expect(tops.prompt).toBe(0);
    expect(tops.controls).toBe(4);
    expect(resolvePushLayout([{ id: "prompt", placement: { x: 0, y: -5, w: 40, h: 4 } }], "prompt").prompt).toBe(0);
  });

  it("多 placed 且底边沿检查序非单调时，单遍扫描会把 item 停在早先 placed 的区间内（重叠）——必须迭代收敛", () => {
    // 检查序 (y, x)：project-strip → negative-prompt（bottom 20）→ controls（bottom 15，不横向重叠故底边更低）→ references。
    // references 先被 controls 推到 15，却被推回了 negative-prompt 的 [10, 20) 区间；单遍扫描不再复查 negative-prompt → 重叠。
    const tops = resolvePushLayout(
      [
        { id: "prompt", placement: { x: 52, y: 0, w: 8, h: 1 } }, // moving（远处，无交互）
        { id: "project-strip", placement: { x: 0, y: 0, w: 8, h: 10 } },
        { id: "negative-prompt", placement: { x: 0, y: 4, w: 24, h: 10 } },
        { id: "controls", placement: { x: 24, y: 5, w: 24, h: 10 } },
        { id: "references", placement: { x: 20, y: 6, w: 8, h: 3 } },
      ],
      "prompt",
    );
    expect(tops.prompt).toBe(0);
    expect(tops["project-strip"]).toBe(0);
    expect(tops["negative-prompt"]).toBe(10);
    expect(tops.controls).toBe(5);
    expect(tops.references).toBe(20);
  });
});

describe("layout module labels i18n", () => {
  it("moduleLabel 在 zh 下直通中文、在 en 下返回英文", () => {
    expect(moduleLabel("project-strip")).toBe("项目归属");
    expect(moduleLabel("prompt")).toBe("提示词");
    expect(moduleLabel("reverse-prompt")).toBe("图反推");
    setLocale("en");
    expect(moduleLabel("project-strip")).toBe("Project");
    expect(moduleLabel("prompt")).toBe("Prompt");
    // 「图反推」复用 settings 分片已登记的模型角色英文值。
    expect(moduleLabel("reverse-prompt")).toBe("Reverse prompt");
    expect(moduleLabel("controls")).toBe("Output controls");
  });
});
