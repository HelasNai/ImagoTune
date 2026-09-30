import { describe, expect, it } from "vitest";
import { GRID_PX, LAYOUT_COLS, type LayoutSnapshot } from "../src/lib/layout";
import {
  emptyLayoutStore,
  migrateV3ToV4,
  parseStoredLayout,
  serializeLayoutStore,
  type LayoutStore,
  type LegacyLayoutStoreV3,
} from "../src/lib/layout-store";

/** 构造一份最小可用的 v3 store（比例单位坐标：y/h 单位 = 卡宽/64）。 */
function makeLegacyStore(): LegacyLayoutStoreV3 {
  return {
    version: 3,
    activePresetId: "default",
    presets: [
      {
        id: "default",
        name: "默认",
        snapshot: {
          shared: {
            prompt: { x: 2, y: 5, w: 40, h: 10 },
          },
          modes: {
            generate: { references: { x: 0, y: 20, w: 30, h: 8 } },
            edit: { mask: { x: 4, y: 6, w: 24, h: 12 } },
            outpaint: { "outpaint-panel": { x: 1, y: 3, w: 20, h: 6 } },
          },
          hidden: { shared: ["prompt-assistant"], modes: { generate: [], edit: ["upload"], outpaint: [] } },
        },
      },
    ],
  };
}

/** 构造一份 v4 store（双单位坐标：x/w = 列，y/h = 行）。 */
function makeV4Store(): LayoutStore {
  const snapshot: LayoutSnapshot = {
    version: 1,
    shared: { prompt: { x: 2, y: 5, w: 40, h: 10 } },
    modes: { generate: {}, edit: { mask: { x: 4, y: 6, w: 24, h: 15 } }, outpaint: {} },
    hidden: { shared: [], modes: { generate: [], edit: [], outpaint: [] } },
  };
  return {
    version: 4,
    activePresetId: "default",
    presets: [
      { id: "default", name: "默认", snapshot },
      { id: "preset-a", name: "方案 A", snapshot: null },
    ],
  };
}

describe("emptyLayoutStore", () => {
  it("空 store 为 version 4 且只含 default 方案（快照为 null）", () => {
    const store = emptyLayoutStore();
    expect(store.version).toBe(4);
    expect(store.activePresetId).toBe("default");
    expect(store.presets).toEqual([{ id: "default", name: "默认", snapshot: null }]);
  });
});

describe("parseStoredLayout", () => {
  it("raw 为 null 时返回 empty", () => {
    expect(parseStoredLayout(null)).toEqual({ kind: "empty" });
  });

  it("raw 为空字符串时返回 empty", () => {
    expect(parseStoredLayout("")).toEqual({ kind: "empty" });
  });

  it("坏 JSON 返回 empty（不抛错）", () => {
    expect(parseStoredLayout("{oops")).toEqual({ kind: "empty" });
  });

  it("JSON 非对象（数组 / 数字 / null 字面量）返回 empty", () => {
    expect(parseStoredLayout("[]")).toEqual({ kind: "empty" });
    expect(parseStoredLayout("42")).toEqual({ kind: "empty" });
    expect(parseStoredLayout("null")).toEqual({ kind: "empty" });
  });

  it("未知版本号返回 empty", () => {
    expect(parseStoredLayout(JSON.stringify({ version: 2, presets: [{ id: "default" }] }))).toEqual({ kind: "empty" });
    expect(parseStoredLayout(JSON.stringify({ version: 99, presets: [{ id: "default" }] }))).toEqual({ kind: "empty" });
  });

  it("presets 缺失 / 非数组 / 空数组均返回 empty", () => {
    expect(parseStoredLayout(JSON.stringify({ version: 4 }))).toEqual({ kind: "empty" });
    expect(parseStoredLayout(JSON.stringify({ version: 4, presets: "nope" }))).toEqual({ kind: "empty" });
    expect(parseStoredLayout(JSON.stringify({ version: 4, presets: [] }))).toEqual({ kind: "empty" });
  });

  it("合法 v4 数据原样解析为 kind=v4", () => {
    const store = makeV4Store();
    const result = parseStoredLayout(JSON.stringify(store));
    expect(result.kind).toBe("v4");
    if (result.kind !== "v4") throw new Error("unreachable");
    expect(result.store.version).toBe(4);
    expect(result.store.activePresetId).toBe("default");
    expect(result.store.presets.map((item) => item.id)).toEqual(["default", "preset-a"]);
    expect(result.store.presets[0].snapshot?.shared.prompt).toEqual({ x: 2, y: 5, w: 40, h: 10 });
  });

  it("v4 缺 default 方案时补回到最前（沿用 loadStore 容错语义）", () => {
    const store = makeV4Store();
    store.presets = store.presets.filter((item) => item.id !== "default");
    store.activePresetId = "preset-a";
    const result = parseStoredLayout(JSON.stringify(store));
    expect(result.kind).toBe("v4");
    if (result.kind !== "v4") throw new Error("unreachable");
    expect(result.store.presets[0]).toEqual({ id: "default", name: "默认", snapshot: null });
    expect(result.store.presets.map((item) => item.id)).toEqual(["default", "preset-a"]);
    expect(result.store.activePresetId).toBe("preset-a");
  });

  it("v3 数据识别为 kind=v3 且原样保留", () => {
    const legacy = makeLegacyStore();
    const result = parseStoredLayout(JSON.stringify(legacy));
    expect(result.kind).toBe("v3");
    if (result.kind !== "v3") throw new Error("unreachable");
    expect(result.store.version).toBe(3);
    expect(result.store.presets[0].snapshot?.shared?.prompt).toEqual({ x: 2, y: 5, w: 40, h: 10 });
  });

  it("v3 但结构坏（presets 为空）返回 empty", () => {
    expect(parseStoredLayout(JSON.stringify({ version: 3, presets: [] }))).toEqual({ kind: "empty" });
  });
});

describe("migrateV3ToV4", () => {
  it("colWidth <= 0 / 非有限值时抛出明确错误（fail-fast）", () => {
    const legacy = makeLegacyStore();
    expect(() => migrateV3ToV4(legacy, 0)).toThrowError(/colWidth/);
    expect(() => migrateV3ToV4(legacy, -4)).toThrowError(/colWidth/);
    expect(() => migrateV3ToV4(legacy, Number.NaN)).toThrowError(/colWidth/);
    expect(() => migrateV3ToV4(legacy, Number.POSITIVE_INFINITY)).toThrowError(/colWidth/);
  });

  it("colWidth = GRID_PX（16）时 y/h 行数与原值一致（旧 1 单位 = 16px = 1 行）", () => {
    const migrated = migrateV3ToV4(makeLegacyStore(), GRID_PX);
    const snapshot = migrated.presets.find((item) => item.id === "default")?.snapshot;
    expect(snapshot?.shared.prompt?.y).toBe(5);
    expect(snapshot?.shared.prompt?.h).toBe(10);
  });

  it("colWidth = 8 时 y=5 → round(5×8/16)=round(2.5)=3 行", () => {
    const migrated = migrateV3ToV4(makeLegacyStore(), 8);
    const snapshot = migrated.presets.find((item) => item.id === "default")?.snapshot;
    expect(snapshot?.shared.prompt?.y).toBe(3);
    // prompt minH=128px → 下限 ceil(128/GRID_PX)=8 行；round(10×8/16)=5 < 8 → 取 8
    expect(snapshot?.shared.prompt?.h).toBe(8);
  });

  it("x/w 直接取整为列（旧单位与列数值相等，不经 colWidth 换算）", () => {
    const migrated = migrateV3ToV4(makeLegacyStore(), 8);
    const snapshot = migrated.presets.find((item) => item.id === "default")?.snapshot;
    expect(snapshot?.shared.prompt?.x).toBe(2);
    expect(snapshot?.shared.prompt?.w).toBe(40);
  });

  it("迁移覆盖全部方案的全部层级（shared / modes 三模式）", () => {
    const legacy = makeLegacyStore();
    legacy.presets.push({
      id: "preset-b",
      name: "方案 B",
      snapshot: { shared: { controls: { x: 0, y: 4, w: 50, h: 3 } } },
    });
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    expect(migrated.presets.map((item) => item.id)).toEqual(["default", "preset-b"]);
    const main = migrated.presets[0].snapshot;
    expect(main?.shared.prompt).toBeDefined();
    expect(main?.modes.generate.references).toBeDefined();
    expect(main?.modes.edit.mask).toBeDefined();
    expect(main?.modes.outpaint["outpaint-panel"]).toBeDefined();
    const second = migrated.presets[1].snapshot;
    expect(second?.shared.controls?.y).toBe(4);
  });

  it("h 下限为 ceil(minHpx / GRID_PX) 行（mask 240px → 15 行）", () => {
    const legacy = makeLegacyStore();
    // mask 原 h=12（colWidth=16 时 round(12)=12 < 15 → 抬到 15）
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    expect(migrated.presets[0].snapshot?.modes.edit.mask?.h).toBe(15);
  });

  it("w 下限为 ceil(minWpx / colWidth) 列（controls 480px / colWidth 16 → 30 列）", () => {
    const legacy: LegacyLayoutStoreV3 = {
      version: 3,
      activePresetId: "default",
      presets: [{ id: "default", name: "默认", snapshot: { shared: { controls: { x: 0, y: 0, w: 2, h: 3 } } } }],
    };
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    expect(migrated.presets[0].snapshot?.shared.controls?.w).toBe(30);
  });

  it("超宽 w 收敛到 LAYOUT_COLS；x 收敛到 [0, LAYOUT_COLS - w]", () => {
    const legacy: LegacyLayoutStoreV3 = {
      version: 3,
      activePresetId: "default",
      presets: [
        {
          id: "default",
          name: "默认",
          snapshot: {
            shared: {
              // presets w=100 超宽 → 64，x=50 被压回 [0, LAYOUT_COLS-w']=[0,64-64]=[0,0] → 0；
              // prompt-tools w=40 合法，x=100 越界 → x=64-40=24
              presets: { x: 50, y: 0, w: 100, h: 3 },
              "prompt-tools": { x: 100, y: 0, w: 40, h: 3 },
            },
          },
        },
      ],
    };
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    const shared = migrated.presets[0].snapshot?.shared;
    expect(shared?.presets?.w).toBe(LAYOUT_COLS);
    expect(shared?.presets?.x).toBe(0);
    expect(shared?.["prompt-tools"]?.w).toBe(40);
    expect(shared?.["prompt-tools"]?.x).toBe(LAYOUT_COLS - 40);
  });

  it("含负数的 placement 视为非法被整体跳过（非法坐标不收敛保留，交由补位兜底）", () => {
    const legacy: LegacyLayoutStoreV3 = {
      version: 3,
      activePresetId: "default",
      presets: [{ id: "default", name: "默认", snapshot: { shared: { prompt: { x: 0, y: -0.4, w: 40, h: 10 } } } }],
    };
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    expect(migrated.presets[0].snapshot?.shared.prompt).toBeUndefined();
  });

  it("非法 placement（非有限 / 负数 / 零尺寸 / 非对象）跳过，不置零", () => {
    const legacy: LegacyLayoutStoreV3 = {
      version: 3,
      activePresetId: "default",
      presets: [
        {
          id: "default",
          name: "默认",
          snapshot: {
            shared: {
              prompt: { x: Number.NaN, y: 0, w: 40, h: 10 },
              "prompt-tools": { x: -1, y: 0, w: 40, h: 10 },
              "negative-prompt": { x: 0, y: 0, w: 0, h: 10 },
              "prompt-assistant": { x: 0, y: 0, w: 40, h: 0 },
              "reverse-prompt": "garbage",
              "unknown-module": { x: 0, y: 0, w: 10, h: 10 },
              controls: { x: 0, y: 0, w: 40, h: 3 },
            } as Record<string, unknown>,
          },
        },
      ],
    };
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    const shared = migrated.presets[0].snapshot?.shared;
    expect(shared?.prompt).toBeUndefined();
    expect(shared?.["prompt-tools"]).toBeUndefined();
    expect(shared?.["negative-prompt"]).toBeUndefined();
    expect(shared?.["prompt-assistant"]).toBeUndefined();
    expect(shared?.["reverse-prompt"]).toBeUndefined();
    expect((shared as Record<string, unknown>)?.["unknown-module"]).toBeUndefined();
    // 唯一合法项保留
    expect(shared?.controls).toEqual({ x: 0, y: 0, w: 40, h: 3 });
  });

  it("null 快照保持 null；hidden 原样保留（未知 id 过滤）", () => {
    const legacy = makeLegacyStore();
    legacy.presets.push({ id: "preset-empty", name: "空方案", snapshot: null });
    (legacy.presets[0].snapshot?.hidden?.shared as unknown[]).push("ghost-module");
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    // makeLegacyStore 仅含 default，push 后 preset-empty 位于索引 1（原写死 2 越界）
    expect(migrated.presets[1].snapshot).toBeNull();
    const hidden = migrated.presets[0].snapshot?.hidden;
    expect(hidden?.shared).toEqual(["prompt-assistant"]);
    expect(hidden?.modes.edit).toEqual(["upload"]);
    expect(hidden?.modes.generate).toEqual([]);
  });

  it("activePresetId 指向缺失方案时回落 default；缺 default 时补回", () => {
    const legacy: LegacyLayoutStoreV3 = {
      version: 3,
      activePresetId: "preset-gone",
      presets: [{ id: "preset-a", name: "方案 A", snapshot: null }],
    };
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    expect(migrated.presets[0]).toEqual({ id: "default", name: "默认", snapshot: null });
    expect(migrated.activePresetId).toBe("default");
  });

  it("结构非法的方案条目被跳过，但含有效坐标的方案绝不丢弃", () => {
    const legacy = {
      version: 3,
      activePresetId: "default",
      presets: [
        { id: "default", name: "默认", snapshot: { shared: { prompt: { x: 0, y: 1, w: 40, h: 10 } } } },
        null,
        { name: "缺 id" },
        { id: 42, name: "数字 id" },
      ],
    } as unknown as LegacyLayoutStoreV3;
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    expect(migrated.presets.map((item) => item.id)).toEqual(["default"]);
    expect(migrated.presets[0].snapshot?.shared.prompt?.y).toBe(1);
  });

  it("name 非字符串时回落为 id", () => {
    const legacy = {
      version: 3,
      activePresetId: "default",
      presets: [{ id: "default", name: 123, snapshot: null }],
    } as unknown as LegacyLayoutStoreV3;
    const migrated = migrateV3ToV4(legacy, GRID_PX);
    expect(migrated.presets[0].name).toBe("default");
  });
});

describe("serializeLayoutStore", () => {
  it("迁移结果序列化后再解析为 v4（幂等，不重复迁移）", () => {
    const migrated = migrateV3ToV4(makeLegacyStore(), GRID_PX);
    const roundTripped = parseStoredLayout(serializeLayoutStore(migrated));
    expect(roundTripped.kind).toBe("v4");
    if (roundTripped.kind !== "v4") throw new Error("unreachable");
    expect(roundTripped.store.version).toBe(4);
    expect(roundTripped.store.presets[0].snapshot?.shared.prompt).toEqual({ x: 2, y: 5, w: 40, h: 10 });
  });

  it("LayoutSnapshot 内层 version 恒为 1（与 store 的 version: 4 是两个独立版本空间）", () => {
    const migrated = migrateV3ToV4(makeLegacyStore(), GRID_PX);
    const parsed = JSON.parse(serializeLayoutStore(migrated)) as LayoutStore;
    expect(parsed.version).toBe(4);
    expect(parsed.presets[0].snapshot?.version).toBe(1);
  });

  it("null 快照序列化后仍为 null", () => {
    const store = emptyLayoutStore();
    const roundTripped = parseStoredLayout(serializeLayoutStore(store));
    expect(roundTripped.kind).toBe("v4");
    if (roundTripped.kind !== "v4") throw new Error("unreachable");
    expect(roundTripped.store.presets[0].snapshot).toBeNull();
  });
});
