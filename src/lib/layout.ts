// 渲染层布局纯逻辑：支持创作页「布局编辑模式」（自由拖动 / 松手吸附 / 调大小 / 隐藏）。
// 模型（与需求定稿对齐）：
// - 坐标系为双单位模型：x / w 以「列」为单位（1 列 = 容器宽 / LAYOUT_COLS）——
//   窗口缩放时仅水平方向按比例自适应；y / h 以「行」为单位（1 行 = GRID_PX = 16px，
//   垂直绝对、与窗口无关，内容高度驱动）。
//   拖动 / 缩放松手时吸附：水平吸附到列、垂直吸附到行；
// - 通用模块（三模式都出现的 8 个）坐标只存一份（shared），任一模式里调整 = 三模式同步；
// - 专属模块按「出现模式」独立存储（modes[mode]），上传区 / 参考图这类跨两模式的各存一份；
// - 无钉住 / 覆盖机制；隐藏与坐标同规则（通用藏 = 三模式同藏）；
// - 放置不允许重叠：冲突时由 findFreeSlot 在期望位置附近找最近空位（自动避让；
//   「最近」是列/行混合度量，不承诺像素最优）；
// - 运行行（生成按钮条）钉在底部，不参与布局模型。
// 本文件不 import components/、electron/ 与任何第三方包（可被 vitest 直接导入）。
// 注意：默认布局不由本模块静态定义——现状排布依赖运行时实测（流式高度），
// 由编辑模式开启时测量生成；本模块只提供模型与运算。

/** 垂直行高（y / h 单位），窗口无关：1 行 = 16px。 */
export const GRID_PX = 16;

/** 水平网格总列数：x / w 以「列」为单位，1 列 = 容器宽 / LAYOUT_COLS（窗口缩放自适应）。 */
export const LAYOUT_COLS = 64;

export type LayoutMode = "generate" | "edit" | "outpaint";

export type LayoutModuleId =
  | "project-strip"
  | "prompt-tools"
  | "prompt"
  | "negative-prompt"
  | "prompt-assistant"
  | "reverse-prompt"
  | "upload"
  | "mask"
  | "references"
  | "outpaint-panel"
  | "presets"
  | "controls"
  | "custom-size";

/** 快照坐标（双单位：x / w 为列（0..LAYOUT_COLS），y / h 为行（1 行 = GRID_PX px）；x / y 为左上角，w / h 为宽高）。 */
export type LayoutPlacement = { x: number; y: number; w: number; h: number };

export type LayoutModuleDef = {
  id: LayoutModuleId;
  label: string;
  /** 出现的模式（三个 = 通用模块，坐标三模式共享）。 */
  modes: readonly LayoutMode[];
  /** 最小尺寸（px 语义，窗口无关）：缩放把手下限，避免压扁到不可用；换算列/行由调用方按 colWidth / GRID_PX 进行。 */
  minW: number;
  minH: number;
};

/** 可编辑模块清单（一级颗粒度；顺序 = 未自定义时的默认纵向顺序，供测量兜底）。 */
export const LAYOUT_MODULES: readonly LayoutModuleDef[] = [
  { id: "project-strip", label: "项目归属", modes: ["generate", "edit", "outpaint"], minW: 400, minH: 64 },
  { id: "prompt-tools", label: "提示词模板", modes: ["generate", "edit", "outpaint"], minW: 320, minH: 48 },
  { id: "prompt", label: "提示词", modes: ["generate", "edit", "outpaint"], minW: 320, minH: 128 },
  { id: "negative-prompt", label: "负面提示词", modes: ["generate", "edit", "outpaint"], minW: 360, minH: 112 },
  { id: "prompt-assistant", label: "提示词助手", modes: ["generate", "edit", "outpaint"], minW: 280, minH: 48 },
  { id: "reverse-prompt", label: "图反推", modes: ["generate", "edit", "outpaint"], minW: 320, minH: 48 },
  { id: "upload", label: "上传区", modes: ["edit", "outpaint"], minW: 320, minH: 48 },
  { id: "mask", label: "蒙版绘制", modes: ["edit"], minW: 360, minH: 240 },
  { id: "references", label: "参考图", modes: ["generate", "edit"], minW: 320, minH: 120 },
  { id: "outpaint-panel", label: "扩图画布", modes: ["outpaint"], minW: 360, minH: 160 },
  { id: "presets", label: "生成速度", modes: ["generate", "edit", "outpaint"], minW: 300, minH: 48 },
  { id: "controls", label: "输出控制", modes: ["generate", "edit", "outpaint"], minW: 480, minH: 48 },
  { id: "custom-size", label: "自定义尺寸", modes: ["generate", "edit"], minW: 280, minH: 48 },
];

/** 模块宽度档位阈值（px，模块自身宽度）：widthPx < 阈值时对应档位生效。空对象 = 无档位（天然弹性）。 */
export const LAYOUT_SIZE_THRESHOLDS: Record<LayoutModuleId, { compact?: number; narrow?: number }> = {
  "project-strip": { compact: 700, narrow: 480 },
  "prompt-tools": { narrow: 380 },
  prompt: {},
  "negative-prompt": { compact: 636 },
  "prompt-assistant": { narrow: 440 },
  "reverse-prompt": { compact: 636 },
  upload: { narrow: 440 },
  mask: {},
  references: { compact: 636, narrow: 480 },
  "outpaint-panel": { compact: 636 },
  presets: {},
  controls: { compact: 680, narrow: 560 },
  "custom-size": { narrow: 440 },
};

/**
 * 按模块实测宽度（px）计算尺寸档位标志：widthPx < 阈值 → 对应档位 true；
 * widthPx <= 0（尚未测量）不触发任何档位；未登记的 id / 无档位模块返回全 false（不抛错）。
 */
export function sizeFlags(id: LayoutModuleId, widthPx: number): { compact: boolean; narrow: boolean } {
  const thresholds = LAYOUT_SIZE_THRESHOLDS[id];
  if (!thresholds || widthPx <= 0) return { compact: false, narrow: false };
  return {
    compact: thresholds.compact !== undefined && widthPx < thresholds.compact,
    narrow: thresholds.narrow !== undefined && widthPx < thresholds.narrow,
  };
}

export type PlacementMap = Partial<Record<LayoutModuleId, LayoutPlacement>>;

/** 一套布局快照（一份方案内容）。 */
export type LayoutSnapshot = {
  version: 1;
  /** 通用模块坐标（一份，三模式同步）。 */
  shared: PlacementMap;
  /** 专属模块坐标（按出现模式分别存储）。 */
  modes: Record<LayoutMode, PlacementMap>;
  /** 隐藏集合：通用模块的隐藏三模式同步；专属模块按模式。 */
  hidden: { shared: LayoutModuleId[]; modes: Record<LayoutMode, LayoutModuleId[]> };
};

const MODES: readonly LayoutMode[] = ["generate", "edit", "outpaint"];

export function moduleDef(id: LayoutModuleId): LayoutModuleDef {
  const def = LAYOUT_MODULES.find((item) => item.id === id);
  if (!def) throw new Error(`未知布局模块：${id}`);
  return def;
}

/** 校验任意字符串是否为已知模块 id（DOM 属性读取时用，避免对非法值抛错）。 */
export function isKnownModuleId(value: string): value is LayoutModuleId {
  return LAYOUT_MODULES.some((def) => def.id === value);
}

/** 该模块是否通用（三模式全可见 → 坐标共享）。 */
export function isSharedModule(id: LayoutModuleId): boolean {
  return moduleDef(id).modes.length === MODES.length;
}

/** 某模式下可见的模块 id（按清单顺序）。 */
export function visibleModuleIds(mode: LayoutMode): LayoutModuleId[] {
  return LAYOUT_MODULES.filter((def) => def.modes.includes(mode)).map((def) => def.id);
}

export function createEmptySnapshot(): LayoutSnapshot {
  return {
    version: 1,
    shared: {},
    modes: { generate: {}, edit: {}, outpaint: {} },
    hidden: { shared: [], modes: { generate: [], edit: [], outpaint: [] } },
  };
}

/** 解析某模块在某模式下生效的坐标：通用模块读 shared，专属模块读 modes[mode]。 */
export function effectivePlacement(snapshot: LayoutSnapshot, mode: LayoutMode, id: LayoutModuleId): LayoutPlacement | undefined {
  return isSharedModule(id) ? snapshot.shared[id] : snapshot.modes[mode][id];
}

/** 写入坐标（自动落到正确层级：通用 → shared；专属 → modes[mode]），返回新快照（不可变更新）。 */
export function setPlacement(snapshot: LayoutSnapshot, mode: LayoutMode, id: LayoutModuleId, placement: LayoutPlacement): LayoutSnapshot {
  if (isSharedModule(id)) {
    return { ...snapshot, shared: { ...snapshot.shared, [id]: placement } };
  }
  return { ...snapshot, modes: { ...snapshot.modes, [mode]: { ...snapshot.modes[mode], [id]: placement } } };
}

/** 移除坐标（恢复该模块为「未摆放」，供兜底测量/重置用）。 */
export function clearPlacement(snapshot: LayoutSnapshot, mode: LayoutMode, id: LayoutModuleId): LayoutSnapshot {
  if (isSharedModule(id)) {
    const next = { ...snapshot.shared };
    delete next[id];
    return { ...snapshot, shared: next };
  }
  const next = { ...snapshot.modes[mode] };
  delete next[id];
  return { ...snapshot, modes: { ...snapshot.modes, [mode]: next } };
}

/** 某模块在某模式下是否隐藏（通用模块看 shared.hidden，专属模块看各自层）。 */
export function isHidden(snapshot: LayoutSnapshot, mode: LayoutMode, id: LayoutModuleId): boolean {
  return isSharedModule(id)
    ? snapshot.hidden.shared.includes(id)
    : snapshot.hidden.modes[mode].includes(id);
}

/** 设置隐藏状态（通用 → 三模式同步；专属 → 仅本模式），返回新快照。 */
export function setHidden(snapshot: LayoutSnapshot, mode: LayoutMode, id: LayoutModuleId, hidden: boolean): LayoutSnapshot {
  const toggle = (list: LayoutModuleId[]) => (hidden ? [...new Set([...list, id])] : list.filter((value) => value !== id));
  if (isSharedModule(id)) {
    return { ...snapshot, hidden: { ...snapshot.hidden, shared: toggle(snapshot.hidden.shared) } };
  }
  return {
    ...snapshot,
    hidden: { ...snapshot.hidden, modes: { ...snapshot.hidden.modes, [mode]: toggle(snapshot.hidden.modes[mode]) } },
  };
}

/** 垂直行吸附（px → 最近 GRID_PX 行线的像素值；四舍五入，负值由调用方 clamp）。仅供垂直（y / h）使用，水平吸附按列另行换算。 */
export function snapToGrid(value: number): number {
  return Math.round(value / GRID_PX) * GRID_PX;
}

/** 轴对齐矩形重叠判定（边界相接不算重叠）。 */
export function rectsOverlap(a: LayoutPlacement, b: LayoutPlacement): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 某模式下已占用的矩形列表（可见、未隐藏、排除自身），供碰撞检测 / 避让使用。
 * 注意：这是**纯快照**占用（高度用快照 h），**不是生产拖拽/缩放路径**——实时避让由 `useComposerLayout`
 * 内部的 `occupiedWithMeasured` 完成（快照 h 与实测高度取大，更接近真实遮挡）；本函数供测试与无实测数据场景使用。
 */
export function occupiedInMode(snapshot: LayoutSnapshot, mode: LayoutMode, excludeId?: LayoutModuleId): LayoutPlacement[] {
  const result: LayoutPlacement[] = [];
  for (const id of visibleModuleIds(mode)) {
    if (id === excludeId || isHidden(snapshot, mode, id)) continue;
    const placement = effectivePlacement(snapshot, mode, id);
    if (placement) result.push(placement);
  }
  return result;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 不允许重叠的放置：期望位置无冲突则原地返回（含 [0, LAYOUT_COLS] 列范围 clamp）；
 * 有冲突则以期望位置为中心按「切比雪夫距离」逐环向外找最近的可放位置（意图最接近、允许向下推挤）。
 * 极端满场时返回 clamp 后的原位置（调用方可用 overlap 兜底重排）。
 */
export function findFreeSlot(desired: LayoutPlacement, occupied: readonly LayoutPlacement[]): LayoutPlacement {
  const w = Math.min(Math.max(desired.w, 1), LAYOUT_COLS);
  const h = Math.max(desired.h, 1);
  const clamped: LayoutPlacement = {
    w,
    h,
    x: clampInt(desired.x, 0, LAYOUT_COLS - w),
    y: Math.max(0, desired.y),
  };
  if (!occupied.some((rect) => rectsOverlap(rect, clamped))) return clamped;
  const maxRadius = Math.max(LAYOUT_COLS, 64);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue; // 只扫当前环
        const candidate: LayoutPlacement = {
          w,
          h,
          x: clampInt(clamped.x + dx, 0, LAYOUT_COLS - w),
          y: Math.max(0, clamped.y + dy),
        };
        if (!occupied.some((rect) => rectsOverlap(rect, candidate))) return candidate;
      }
    }
  }
  return clamped;
}

/** 推挤解算输入项：意图坐标 + 实测高度（行；缺省用快照 h）。 */
export type LayoutResolveItem = {
  id: LayoutModuleId;
  placement: LayoutPlacement;
  /** 实测高度（行，内容撑开后的真实值）——大于快照 h 时以实测为准。 */
  measuredH?: number;
};

/**
 * 纵向推挤解算（渲染用）：按 (y, x) 排序逐个收纳，凡与其「横向区间重叠」的已放置模块底边更低者，
 * 把当前模块下推到其下方——只调 y、不动 x，且只下推不上拉（用户摆放的意图位置是下界）。
 * 用途：模块内容高度动态（图反推展开、蒙版画布出现等）时防止视觉重叠（「不允许重叠」原则的运行时保障）。
 * 返回 id → 显示用 top（行）。
 */
export function resolveVerticalLayout(items: readonly LayoutResolveItem[]): Record<string, number> {
  const sorted = [...items].sort((a, b) => (a.placement.y - b.placement.y) || (a.placement.x - b.placement.x));
  const tops: Record<string, number> = {};
  const placed: Array<{ x: number; w: number; bottom: number }> = [];
  for (const item of sorted) {
    const height = Math.max(item.placement.h, item.measuredH ?? 0);
    let top = item.placement.y;
    for (const other of placed) {
      const overlapsX = item.placement.x < other.x + other.w && other.x < item.placement.x + item.placement.w;
      if (overlapsX) top = Math.max(top, other.bottom);
    }
    tops[item.id] = top;
    placed.push({ x: item.placement.x, w: item.placement.w, bottom: top + height });
  }
  return tops;
}

/** 某模式下已摆放（未隐藏）模块的最大底边（行），无则 0。 */
function maxBottomOf(snapshot: LayoutSnapshot, mode: LayoutMode): number {
  let bottom = 0;
  for (const id of visibleModuleIds(mode)) {
    if (isHidden(snapshot, mode, id)) continue;
    const placement = effectivePlacement(snapshot, mode, id);
    if (placement) bottom = Math.max(bottom, placement.y + placement.h);
  }
  return bottom;
}

/**
 * 按模式补位：给该模式下「还没有坐标」的可见模块追加默认位置（自上而下排在已摆放内容底部，全宽）。
 * 高度为 px → 行等价换算（minH 是 px 语义）：h = max(1, ceil(minHpx / GRID_PX))。
 * 用途：① 快照首次在某个模式建立时，补齐该模式可见但未测量的模块；② 渲染前保证每个渲染模块都有坐标。
 */
export function ensureModePlacements(snapshot: LayoutSnapshot, mode: LayoutMode): LayoutSnapshot {
  let next = snapshot;
  let bottom = maxBottomOf(next, mode);
  for (const id of visibleModuleIds(mode)) {
    if (effectivePlacement(next, mode, id)) continue;
    const def = moduleDef(id);
    const placement: LayoutPlacement = { x: 0, y: bottom + 1, w: LAYOUT_COLS, h: Math.max(1, Math.ceil(def.minH / GRID_PX)) };
    next = setPlacement(next, mode, id, placement);
    bottom = placement.y + placement.h;
  }
  return next;
}

/**
 * 冲突消解（导入分享码后 / 渲染前兜底）：通用模块先按 (y, x) 顺序占位，随后专属模块依次让位——
 * 与已放置者重叠的一律经 findFreeSlot 找最近空位。顺序固定 → 结果确定（可复现）。
 */
export function resolveAllConflicts(snapshot: LayoutSnapshot, mode: LayoutMode): LayoutSnapshot {
  let next = snapshot;
  const positions = new Map<LayoutModuleId, LayoutPlacement>();
  for (const id of visibleModuleIds(mode)) {
    const placement = effectivePlacement(next, mode, id);
    if (placement) positions.set(id, placement);
  }
  const sorted = (ids: LayoutModuleId[]) =>
    [...ids].sort((a, b) => {
      const pa = positions.get(a)!;
      const pb = positions.get(b)!;
      return pa.y - pb.y || pa.x - pb.x;
    });
  const occupied: LayoutPlacement[] = [];
  const place = (id: LayoutModuleId) => {
    const placement = effectivePlacement(next, mode, id);
    if (!placement) return;
    const free = occupied.some((rect) => rectsOverlap(rect, placement))
      ? findFreeSlot(placement, occupied)
      : placement;
    if (free !== placement) next = setPlacement(next, mode, id, free);
    occupied.push(free);
  };
  const visible = visibleModuleIds(mode).filter((id) => !isHidden(next, mode, id) && positions.has(id));
  sorted(visible.filter((id) => isSharedModule(id))).forEach(place);
  sorted(visible.filter((id) => !isSharedModule(id))).forEach(place);
  return next;
}

/** 旧版分享码前缀（v1：x/w 与 y/h 同为「64 列比例单位」，导入时 y/h 需按当前 colWidth 近似换算为行）。 */
export const LAYOUT_CODE_PREFIX_V1 = "ITL1:";

/** 分享码前缀（字符串即对外契约；格式不兼容调整时递增版本号数字）。 */
export const LAYOUT_CODE_PREFIX = "ITL2:";

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

/** 分享码体积控制：只打包通用模块（坐标 + 隐藏），专属模块不进码（见「只记录通用组件」约定）。 */
export function encodeLayoutCode(snapshot: LayoutSnapshot): string {
  const modules: Record<string, [number, number, number, number]> = {};
  for (const def of LAYOUT_MODULES) {
    if (!isSharedModule(def.id)) continue;
    const placement = snapshot.shared[def.id];
    if (placement) modules[def.id] = [placement.x, placement.y, placement.w, placement.h];
  }
  const hidden = snapshot.hidden.shared.filter((id) => isSharedModule(id));
  return LAYOUT_CODE_PREFIX + toBase64Url(JSON.stringify({ v: 2, m: modules, h: hidden }));
}

/** 分享码解码结果：legacy=true 仅表示来自旧版 ITL1 码（y/h 为按当前 colWidth 的近似换算，x/w 列值精确）。 */
export type DecodedLayoutCode = { shared: PlacementMap; hidden: LayoutModuleId[]; legacy: boolean };

/** 分享码数值护栏（防畸形码撑爆布局）：在取整 / 换算之后校验。y 以「行」为单位，上限高于 x/w/h。 */
function withinShareGuards(placement: LayoutPlacement): boolean {
  return (
    placement.x >= 0 &&
    placement.x <= 400 &&
    placement.y >= 0 &&
    placement.y <= 4000 &&
    placement.w >= 1 &&
    placement.w <= 400 &&
    placement.h >= 1 &&
    placement.h <= 400
  );
}

/**
 * 旧版（ITL1）坐标换算：x/w 为列（数值不变、钳入列范围）；
 * y/h 为旧比例单位（1 单位 = colWidth px），经 colWidth / GRID_PX 近似换算为行（y/h 不保真，仅近似）。
 */
function convertLegacyPlacement(x: number, y: number, w: number, h: number, colWidth: number): LayoutPlacement {
  const nextW = clampInt(Math.round(w), 1, LAYOUT_COLS);
  return {
    x: clampInt(Math.round(x), 0, LAYOUT_COLS - nextW),
    y: Math.max(0, Math.round((y * colWidth) / GRID_PX)),
    w: nextW,
    h: Math.max(1, Math.round((h * colWidth) / GRID_PX)),
  };
}

/**
 * 分享码解码（严格校验：前缀 / base64 / JSON / 版本 / 模块范围 / 数值护栏）；任何异常返回 null。
 * ITL2 直接解码；ITL1 旧码需提供有效的 colWidth（当前列宽 px）做 y/h 近似换算，缺失或非法一律拒绝。
 */
export function decodeLayoutCode(code: string, colWidth?: number): DecodedLayoutCode | null {
  const trimmed = code.trim();
  const isV2 = trimmed.startsWith(LAYOUT_CODE_PREFIX);
  const isV1 = !isV2 && trimmed.startsWith(LAYOUT_CODE_PREFIX_V1);
  if (!isV2 && !isV1) return null;
  if (isV1 && (typeof colWidth !== "number" || !Number.isFinite(colWidth) || colWidth <= 0)) return null;
  const json = fromBase64Url(trimmed.slice((isV2 ? LAYOUT_CODE_PREFIX : LAYOUT_CODE_PREFIX_V1).length));
  if (!json) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { v?: unknown; m?: unknown; h?: unknown };
  if (record.v !== (isV2 ? 2 : 1) || !record.m || typeof record.m !== "object") return null;
  const shared: PlacementMap = {};
  for (const [id, value] of Object.entries(record.m as Record<string, unknown>)) {
    if (!isKnownModuleId(id) || !isSharedModule(id)) continue; // 只接受通用模块
    if (!Array.isArray(value) || value.length !== 4) continue;
    const [rawX, rawY, rawW, rawH] = value as unknown[];
    if (![rawX, rawY, rawW, rawH].every((item) => typeof item === "number" && Number.isFinite(item))) continue;
    const placement = isV2
      ? { x: Math.round(rawX as number), y: Math.round(rawY as number), w: Math.round(rawW as number), h: Math.round(rawH as number) }
      : convertLegacyPlacement(rawX as number, rawY as number, rawW as number, rawH as number, colWidth as number);
    if (!withinShareGuards(placement)) continue; // 防畸形码撑爆布局（换算后同样受限）
    shared[id] = placement;
  }
  const hidden = Array.isArray(record.h)
    ? (record.h as unknown[]).filter((id): id is LayoutModuleId => typeof id === "string" && isKnownModuleId(id) && isSharedModule(id))
    : [];
  if (!Object.keys(shared).length) return null;
  return { shared, hidden, legacy: isV1 };
}

/** 导入应用：只替换通用池（坐标 + 隐藏），专属层原样保留（撞位由 resolveAllConflicts 让位）。 */
export function applySharedLayout(snapshot: LayoutSnapshot, shared: PlacementMap, hidden: LayoutModuleId[]): LayoutSnapshot {
  const nextShared: PlacementMap = { ...snapshot.shared };
  for (const def of LAYOUT_MODULES) {
    if (!isSharedModule(def.id)) continue;
    const placement = shared[def.id];
    if (placement) nextShared[def.id] = placement;
    else delete nextShared[def.id];
  }
  return { ...snapshot, shared: nextShared, hidden: { ...snapshot.hidden, shared: [...new Set(hidden)] } };
}
