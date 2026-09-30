// 渲染层布局持久化纯逻辑：多方案 store 的版本解析（v3 / v4）与 v3→v4 坐标迁移。
// 版本空间：
// - store 外层 version 4（本文件）；v3 为「比例单位」旧坐标（x/w/y/h 同为卡宽/64 单位，整层等比缩放）；
// - snapshot 内层 version 恒为 1（与 `src/lib/layout.ts` 的 LayoutSnapshot 对齐，独立版本空间）。
// v4 坐标为双单位：x/w 为列（0..LAYOUT_COLS），y/h 为行（1 行 = GRID_PX px）。
// 本文件不 import React / DOM / electron / 第三方包（可被 vitest 直接导入）。

import {
  GRID_PX,
  LAYOUT_COLS,
  isKnownModuleId,
  moduleDef,
  type LayoutMode,
  type LayoutModuleId,
  type LayoutPlacement,
  type LayoutSnapshot,
  type PlacementMap,
} from "./layout";

/** 一套命名方案（default = 基础方案；snapshot 为 null 表示尚未自定义 / 已恢复默认）。 */
export type LayoutPreset = { id: string; name: string; snapshot: LayoutSnapshot | null };

/** v4 持久化结构（双单位坐标：x/w = 列，y/h = 行）。 */
export type LayoutStore = { version: 4; activePresetId: string; presets: LayoutPreset[] };

/** v3 旧结构（宽松类型 + 运行时校验）：坐标为「比例单位」，字段可能缺失或畸形。 */
export type LegacyLayoutSnapshot = {
  shared?: Record<string, unknown>;
  modes?: Partial<Record<LayoutMode, Record<string, unknown>>>;
  hidden?: { shared?: unknown[]; modes?: Partial<Record<LayoutMode, unknown[]>> };
};

export type LegacyLayoutPreset = {
  id: unknown;
  name: unknown;
  snapshot?: LegacyLayoutSnapshot | null;
};

export type LegacyLayoutStoreV3 = {
  version: 3;
  activePresetId?: unknown;
  presets: LegacyLayoutPreset[];
};

/** `parseStoredLayout` 的判别联合结果。 */
export type ParsedLayout =
  | { kind: "empty" }
  | { kind: "v4"; store: LayoutStore }
  | { kind: "v3"; store: LegacyLayoutStoreV3 };

const DEFAULT_PRESET: LayoutPreset = { id: "default", name: "默认", snapshot: null };

/** 空 store（version 4，只含 default 方案；snapshot 为 null 表示未自定义）。 */
export function emptyLayoutStore(): LayoutStore {
  return { version: 4, activePresetId: DEFAULT_PRESET.id, presets: [{ ...DEFAULT_PRESET }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 私有 clamp（layout.ts 的 clampInt 未导出）：min > max 时收敛到 min，绝不产生 NaN。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 规范化 v4 快照的内层形状（畸形输入降级为安全空结构，绝不抛错；least data loss）。
 * 语义（只修「形状」，不校验单个 placement 的坐标语义——坐标合法性由运行时 clamp / 补位兜底）：
 * - snapshot 非普通对象（含 null / undefined）→ null（表示尚未自定义，走流式渲染）；
 * - shared 非普通对象 → {}；
 * - modes 非普通对象 → {}；generate / edit / outpaint 各自非普通对象 → {}；
 * - hidden 非普通对象 → { shared: [], modes: { generate: [], edit: [], outpaint: [] } }；各内层列表非数组 → []；
 * - 合法部分原样保留（引用不变），内层 version 归位 1（store 外层 4 与内层 1 为独立版本空间）。
 */
function normalizeV4Snapshot(value: unknown): LayoutSnapshot | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;
  const placementMap = (raw: unknown): PlacementMap => (isPlainObject(raw) ? (raw as PlacementMap) : {});
  const hiddenList = (raw: unknown): LayoutModuleId[] => (Array.isArray(raw) ? (raw as LayoutModuleId[]) : []);
  const rawModes = isPlainObject(value.modes) ? value.modes : {};
  const rawHidden = isPlainObject(value.hidden) ? value.hidden : {};
  const rawHiddenModes = isPlainObject(rawHidden.modes) ? rawHidden.modes : {};
  return {
    version: 1,
    shared: placementMap(value.shared),
    modes: {
      generate: placementMap(rawModes.generate),
      edit: placementMap(rawModes.edit),
      outpaint: placementMap(rawModes.outpaint),
    },
    hidden: {
      shared: hiddenList(rawHidden.shared),
      modes: {
        generate: hiddenList(rawHiddenModes.generate),
        edit: hiddenList(rawHiddenModes.edit),
        outpaint: hiddenList(rawHiddenModes.outpaint),
      },
    },
  };
}

/**
 * 解析 v4：顶层 presets 结构非法（缺失 / 非数组 / 空）返回 null；缺 default 方案时补回到最前（沿用旧 loadStore 容错语义）；
 * 每份快照经 `normalizeV4Snapshot` 做形状归一（畸形降级而非整库作废，避免 render 期 `ensureModePlacements` 抛错白屏）；
 * `activePresetId` 悬空（非字符串或匹配不到任何方案）→ 回落 `default`（镜像 `migrateV3ToV4`），
 * 保证 `commitSnapshot` 的 `preset.id === activePresetId` 查找必有命中、布局编辑能落盘。
 */
function parseV4(record: Record<string, unknown>): LayoutStore | null {
  const presets = record.presets;
  if (!Array.isArray(presets) || presets.length === 0) return null;
  const normalized: LayoutPreset[] = [];
  for (const item of presets) {
    if (!isPlainObject(item) || typeof item.id !== "string") return null;
    normalized.push({
      id: item.id,
      name: typeof item.name === "string" ? item.name : item.id,
      snapshot: normalizeV4Snapshot(item.snapshot),
    });
  }
  if (!normalized.some((item) => item.id === DEFAULT_PRESET.id)) {
    normalized.unshift({ ...DEFAULT_PRESET });
  }
  const activePresetId =
    typeof record.activePresetId === "string" && normalized.some((item) => item.id === record.activePresetId)
      ? record.activePresetId
      : DEFAULT_PRESET.id;
  return { version: 4, activePresetId, presets: normalized };
}

/** 解析 v3：仅校验顶层结构（presets 非空数组），其余原样保留（迁移时再逐项容错）。 */
function parseV3(record: Record<string, unknown>): LegacyLayoutStoreV3 | null {
  const presets = record.presets;
  if (!Array.isArray(presets) || presets.length === 0) return null;
  return record as unknown as LegacyLayoutStoreV3;
}

/**
 * 解析 localStorage 中的布局原始字符串：
 * 空值 / 坏 JSON / 非对象 / 未知版本 / 结构非法 → `{kind:"empty"}`；
 * v4 → `{kind:"v4"}`（缺 default 补回）；v3 → `{kind:"v3"}`（原样保留，待调用方迁移）。
 */
export function parseStoredLayout(raw: string | null): ParsedLayout {
  if (raw === null || raw === "") return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "empty" };
  }
  if (!isPlainObject(parsed)) return { kind: "empty" };
  if (parsed.version === 4) {
    const store = parseV4(parsed);
    return store ? { kind: "v4", store } : { kind: "empty" };
  }
  if (parsed.version === 3) {
    const store = parseV3(parsed);
    return store ? { kind: "v3", store } : { kind: "empty" };
  }
  return { kind: "empty" };
}

/**
 * 迁移单个坐标（v3 比例单位 → v4 双单位）：
 * x/w 数值直接取整为列（旧单位与列数值相等，x 收敛到 [0, LAYOUT_COLS - w']）；
 * y/h 经 colWidth / GRID_PX 换算为行，h 下限为 ceil(minHpx / GRID_PX)。
 * 仅接受有限非负 x/y 与正 w/h；否则返回 null（非法项整体跳过，交由补位兜底）。
 */
function migratePlacement(id: LayoutModuleId, value: unknown, colWidth: number): LayoutPlacement | null {
  if (!isPlainObject(value)) return null;
  const { x, y, w, h } = value;
  const nums = [x, y, w, h];
  if (!nums.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  const [nx, ny, nw, nh] = nums as [number, number, number, number];
  if (nx < 0 || ny < 0 || nw <= 0 || nh <= 0) return null;
  const def = moduleDef(id);
  const minWCols = Math.max(1, Math.ceil(def.minW / colWidth));
  const minHRows = Math.max(1, Math.ceil(def.minH / GRID_PX));
  const nextW = clamp(Math.round(nw), minWCols, LAYOUT_COLS);
  return {
    x: clamp(Math.round(nx), 0, LAYOUT_COLS - nextW),
    y: Math.max(0, Math.round((ny * colWidth) / GRID_PX)),
    w: nextW,
    h: Math.max(minHRows, Math.round((nh * colWidth) / GRID_PX)),
  };
}

/** 迁移一个坐标表：未知模块 id 与非对象值跳过。 */
function migratePlacementMap(raw: unknown, colWidth: number): PlacementMap {
  const result: PlacementMap = {};
  if (!isPlainObject(raw)) return result;
  for (const [id, value] of Object.entries(raw)) {
    if (!isKnownModuleId(id)) continue;
    const placement = migratePlacement(id, value, colWidth);
    if (placement) result[id] = placement;
  }
  return result;
}

/** 迁移隐藏集合：保留原值但过滤未知模块 id（结构缺失时回退空数组）。 */
function migrateHidden(raw: unknown): LayoutSnapshot["hidden"] {
  const filter = (list: unknown): LayoutModuleId[] =>
    Array.isArray(list) ? list.filter((id): id is LayoutModuleId => typeof id === "string" && isKnownModuleId(id)) : [];
  const record = isPlainObject(raw) ? raw : {};
  const modes = isPlainObject(record.modes) ? record.modes : {};
  return {
    shared: filter(record.shared),
    modes: {
      generate: filter(modes.generate),
      edit: filter(modes.edit),
      outpaint: filter(modes.outpaint),
    },
  };
}

/** 迁移一套 v3 快照（比例单位 → 双单位），内层 version 归位 1。 */
function migrateSnapshot(raw: LegacyLayoutSnapshot, colWidth: number): LayoutSnapshot {
  const modes = isPlainObject(raw.modes) ? raw.modes : {};
  return {
    version: 1,
    shared: migratePlacementMap(raw.shared, colWidth),
    modes: {
      generate: migratePlacementMap(modes.generate, colWidth),
      edit: migratePlacementMap(modes.edit, colWidth),
      outpaint: migratePlacementMap(modes.outpaint, colWidth),
    },
    hidden: migrateHidden(raw.hidden),
  };
}

/**
 * v3 → v4 迁移（纯函数，一次覆盖全部方案的全部层级：shared + modes 三模式 + hidden）。
 * colWidth 为当前列宽 px（= 卡宽 / LAYOUT_COLS），非有限正数时 fail-fast 抛错（无法换算 y/h）。
 * 结构非法的方案条目跳过；null 快照保持 null；缺 default 补回最前；activePresetId 指向缺失方案时回落 default。
 */
export function migrateV3ToV4(legacy: LegacyLayoutStoreV3, colWidth: number): LayoutStore {
  if (typeof colWidth !== "number" || !Number.isFinite(colWidth) || colWidth <= 0) {
    throw new Error(`migrateV3ToV4: colWidth 必须为有限正数，收到 ${String(colWidth)}`);
  }
  const source = Array.isArray(legacy?.presets) ? legacy.presets : [];
  const presets: LayoutPreset[] = [];
  for (const item of source) {
    if (!isPlainObject(item) || typeof item.id !== "string") continue; // 结构非法条目跳过
    const id = item.id;
    const name = typeof item.name === "string" ? item.name : id;
    const snapshot = item.snapshot;
    if (snapshot === null || snapshot === undefined) {
      presets.push({ id, name, snapshot: null });
      continue;
    }
    if (!isPlainObject(snapshot)) continue;
    presets.push({ id, name, snapshot: migrateSnapshot(snapshot as LegacyLayoutSnapshot, colWidth) });
  }
  if (!presets.some((item) => item.id === DEFAULT_PRESET.id)) {
    presets.unshift({ ...DEFAULT_PRESET });
  }
  const activePresetId =
    typeof legacy.activePresetId === "string" && presets.some((item) => item.id === legacy.activePresetId)
      ? legacy.activePresetId
      : DEFAULT_PRESET.id;
  return { version: 4, activePresetId, presets };
}

/** 序列化 v4 store 为 JSON 字符串（内层 LayoutSnapshot.version 保持 1）。 */
export function serializeLayoutStore(store: LayoutStore): string {
  return JSON.stringify(store);
}
