import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySharedLayout,
  compactCollapsedItems,
  createEmptySnapshot,
  effectivePlacement,
  ensureModePlacements,
  findFreeSlot,
  GRID_PX,
  isHidden,
  isKnownModuleId,
  LAYOUT_COLS,
  minResizeHeightPx,
  moduleDef,
  moduleLabel,
  resolveAllConflicts,
  resolvePushLayout,
  resolveVerticalLayout,
  setHidden,
  setPlacement,
  sizeFlags,
  snapToGrid,
  visibleModuleIds,
  type LayoutMode,
  type LayoutModuleId,
  type LayoutPlacement,
  type LayoutSnapshot,
  type PlacementMap,
} from "../lib/layout";
import {
  emptyLayoutStore,
  migrateV3ToV4,
  parseStoredLayout,
  serializeLayoutStore,
  type LayoutPreset,
  type LayoutStore,
  type LegacyLayoutStoreV3,
} from "../lib/layout-store";
import { createHistory, pushHistory, redoHistory, undoHistory, type LayoutHistory } from "../lib/layout-history";
import { t } from "../lib/i18n";
import { useGlobalKeyDown } from "./useKeyboard";

const STORAGE_KEY = "imagotune:layout:v1";

/** 边缘自动滚动：指针进入 .app 视口上/下边缘带（px）时，按接近度线性加速（距离 band→0，速度 0→EDGE_MAX_STEP px/帧）。 */
const EDGE_BAND = 48;
const EDGE_MAX_STEP = 15;

/** 键盘快捷键豁免：焦点在输入控件 / 可编辑元素时，Ctrl+Z 等交给原生文本编辑，绝不拦截。 */
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const DEFAULT_PRESET_ID = "default";
/** 默认方案初始显示名：作为「未被用户重命名」的哨兵，展示时经 t("默认") 按当前语言输出。 */
const DEFAULT_PRESET_NAME = "默认";

/** 构造默认方案（快照为 null = 未自定义，流式渲染）。 */
function defaultPreset(): LayoutPreset {
  return { id: DEFAULT_PRESET_ID, name: DEFAULT_PRESET_NAME, snapshot: null };
}

/**
 * 从 localStorage 读取布局：v4 直接使用；v3 暂存到 legacyRef（本次以空 store 流式渲染，待列宽就绪后一次性迁移）；
 * 空 / 坏 JSON / 未知版本 → 空 store。
 */
function loadStore(legacyRef: { current: LegacyLayoutStoreV3 | null }): LayoutStore {
  const parsed = parseStoredLayout(window.localStorage.getItem(STORAGE_KEY));
  if (parsed.kind === "v4") return parsed.store;
  if (parsed.kind === "v3") {
    legacyRef.current = parsed.store;
    return emptyLayoutStore();
  }
  return emptyLayoutStore();
}

function writeStore(store: LayoutStore) {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeLayoutStore(store));
  } catch {
    /* 本地布局保存失败不影响创作（下次改动会重试） */
  }
}

/** 编辑模式覆盖层一项：模块的拖拽 / 缩放热区（px）。 */
export type LayoutHandle = { id: LayoutModuleId; label: string; left: number; top: number; width: number; height: number };

type DragSession = {
  id: LayoutModuleId;
  /** move 跟指针移动；resize-e 只改宽、resize-s 只改高、resize-se 同时改宽高（均不移动 x/y）。 */
  kind: "move" | "resize-e" | "resize-s" | "resize-se";
  startClientX: number;
  startClientY: number;
  /** 拖拽基准（px；取「所见位置」，y 用显示 top 而非快照 y，保证从所见位置开始拖）。 */
  start: LayoutPlacement;
  /**
   * 垂直缩放（拉矮）下限（px，GRID_PX 的整数倍；会话开始时经 minResizeHeightPx 判定一次）。
   * 拖动中不再重算：网格态实测高度 = max(内容, minHeight) 恒 ≥ 当前高度，实时采信会把「拉矮」永久钳住。
   */
  minHpx: number;
  /** 拖拽开始时记录页面滚动容器（.app，唯一页面级滚动容器）与其 scrollTop；null = 无（测试 / 未挂载）。 */
  app: HTMLElement | null;
  scroll0: number;
  /** 最近一次指针 client 坐标：边缘自动滚动每帧据此重算实时矩形 + 吸附预览，让模块跟随滚动。 */
  lastClientX: number;
  lastClientY: number;
};

type LiveRect = { id: LayoutModuleId; x: number; y: number; w: number; h: number };

/** 列范围内 clamp 后的显示左缘（列单位）。 */
function displayLeft(placement: LayoutPlacement): number {
  const width = Math.min(placement.w, LAYOUT_COLS);
  return Math.max(0, Math.min(placement.x, Math.max(0, LAYOUT_COLS - width)));
}

/** 占用矩形：宽度按列范围 clamp、高度取「快照 h（行）与实测高度换算（px→行）」较大者，更接近真实遮挡（unit = 垂直行高 px，调用方传 GRID_PX）。 */
function occupiedWithMeasured(
  snapshot: LayoutSnapshot,
  mode: LayoutMode,
  excludeId: LayoutModuleId,
  measured: Record<string, number>,
  unit: number,
): LayoutPlacement[] {
  const result: LayoutPlacement[] = [];
  for (const id of visibleModuleIds(mode)) {
    if (id === excludeId || isHidden(snapshot, mode, id)) continue;
    const placement = effectivePlacement(snapshot, mode, id);
    if (!placement) continue;
    const measuredGrid = measured[id] ? Math.ceil(measured[id] / unit) : 0;
    result.push({ ...placement, w: Math.min(placement.w, LAYOUT_COLS), h: Math.max(placement.h, measuredGrid) });
  }
  return result;
}

/**
 * 首次进入编辑模式：测量当前流式排布（以第一个模块左上角为原点），生成初始快照（水平换算为列、垂直换算为 GRID_PX 行；minW/minH 为 px 语义，须换算为列/行后作下限，绝不直接当坐标单位）。
 * details 类模块（图反推）一律按「折叠态」测量：展开是临时交互状态，若把展开高度写进快照，
 * 折叠后会被快照 h 撑出大块空白、下方模块的位置也会带上展开高度的偏差；测完立即恢复原展开状态。
 */
function measureInitial(container: HTMLElement | null, mode: LayoutMode, cardWidth: number): LayoutSnapshot | null {
  if (!container) return null;
  const nodes = [...container.querySelectorAll<HTMLElement>("[data-layout-id]")];
  if (!nodes.length) return null;
  // 临时折叠仍处于展开状态的 details（同步测量不渲染中间态，finally 兜底恢复）。
  const reopened: HTMLDetailsElement[] = [];
  for (const node of nodes) {
    if (node instanceof HTMLDetailsElement && node.open) {
      node.open = false;
      reopened.push(node);
    }
  }
  try {
    const colWidth = cardWidth > 0 ? cardWidth / LAYOUT_COLS : GRID_PX;
    let originX = Infinity;
    let originY = Infinity;
    const rects = nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      originX = Math.min(originX, rect.left);
      originY = Math.min(originY, rect.top);
      return { node, rect };
    });
    let snapshot = createEmptySnapshot();
    for (const { node, rect } of rects) {
      const id = node.dataset.layoutId;
      if (!id || !isKnownModuleId(id)) continue;
      const def = moduleDef(id);
      const placement: LayoutPlacement = {
        x: Math.floor((rect.left - originX) / colWidth),
        y: Math.floor((rect.top - originY) / GRID_PX),
        w: Math.max(Math.round(rect.width / colWidth), Math.ceil(def.minW / colWidth)),
        h: Math.max(Math.round(rect.height / GRID_PX), Math.ceil(def.minH / GRID_PX)),
      };
      snapshot = setPlacement(snapshot, mode, id, placement);
    }
    return ensureModePlacements(snapshot, mode);
  } finally {
    for (const node of reopened) node.open = true;
  }
}

/**
 * 创作页布局编辑（网格画布 + 自由拖动 / 松手吸附 / 缩放 / 隐藏）。
 * - 坐标系 = 双单位：水平 x/w 为列（1 列 = 卡宽 / LAYOUT_COLS，随窗口水平自适应）；
 *   垂直 y/h 为固定行（1 行 = GRID_PX = 16px，与窗口无关，内容高度驱动）；
 *   松手吸附：水平吸附到列、垂直经 snapToGrid 吸附到行；
 * - 快照为 null = 流式（与现状零差异）；首次进入编辑时测量生成，之后实时写入 localStorage；
 * - 通用模块共享一份坐标（三模式同步）、专属模块按模式分层（见 src/lib/layout.ts）；
 * - 渲染显示位置 = 意图坐标经「纵向推挤」消解（模块内容高度动态时不重叠）。
 */
export function useComposerLayout({ mode, containerRef }: {
  mode: LayoutMode;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const legacyRef = useRef<LegacyLayoutStoreV3 | null>(null);
  const [store, setStore] = useState<LayoutStore>(() => loadStore(legacyRef));
  const activePreset = store.presets.find((item) => item.id === store.activePresetId) ?? store.presets[0];
  /** 当前激活方案的快照（null = 流式渲染，与现状零差异）。 */
  const snapshot = activePreset?.snapshot ?? null;
  const [editing, setEditing] = useState(false);
  /**
   * 折叠模块（内容高度随交互剧变的 details 类，目前仅 reverse-prompt 图反推）：
   * 非编辑态收缩为内容自然高度（避免快照 h 撑出大块空白），编辑态显示布局真相（快照 h）。
   * 初始值与 ComposerPanel 的 details 默认闭合一致（无 open 属性）；用户在面板上切换时经 setModuleCollapsed 同步。
   */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<LayoutModuleId>>(() => new Set<LayoutModuleId>(["reverse-prompt"]));
  /** 模块实测高度（px；id → 高度）。 */
  const [measured, setMeasured] = useState<Record<string, number>>({});
  /** 模块实测宽度（px；id → 宽度），驱动网格态尺寸档位属性（与高度同一套 ResizeObserver）。 */
  const [widths, setWidths] = useState<Record<string, number>>({});
  /** 卡片内容宽（px，模块可用宽）。 */
  const [cardWidth, setCardWidth] = useState(0);
  /** 拖动 / 缩放中的实时矩形（px，自由不吸附）。 */
  const [live, setLive] = useState<LiveRect | null>(null);
  const liveRef = useRef<LiveRect | null>(null);
  /** 拖动 / 缩放时的吸附落点预览（快照坐标系：x/w 列、y/h 行）；null = 无预览。 */
  const [ghost, setGhost] = useState<LayoutPlacement | null>(null);
  const ghostRef = useRef<LayoutPlacement | null>(null);
  /** 拖动中「全场推挤预览」：id → y（行）；null = 无预览（非 move 拖动 / 未拖动）。 */
  const [pushTops, setPushTops] = useState<Record<string, number> | null>(null);
  const pushTopsRef = useRef<Record<string, number> | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  /** 边缘自动滚动 rAF 句柄（非 null = 循环运行中；全路径终止时清零，防泄漏）。 */
  const scrollRafRef = useRef<number | null>(null);
  /** 事件回调读取的最新状态（事件发生在提交之后，effect 同步足够）。 */
  const stateRef = useRef({ snapshot, measured, cardWidth });
  useEffect(() => {
    stateRef.current = { snapshot, measured, cardWidth };
  });

  const applyLive = (rect: LiveRect | null) => {
    liveRef.current = rect;
    setLive(rect);
  };

  /** 写入吸附预览：ref 镜像供事件回调（endDrag）同步读取最新值，避免闭包读到旧 state。 */
  const applyGhost = (slot: LayoutPlacement | null) => {
    ghostRef.current = slot;
    setGhost(slot);
  };

  /** 写入推挤预览：ref 镜像供事件回调（endDrag）同步读取，避免闭包读到旧 state。 */
  const applyPushTops = (tops: Record<string, number> | null) => {
    pushTopsRef.current = tops;
    setPushTops(tops);
  };

  /** 指针相对 .app 视口的位置：-1 = 上边缘带内、1 = 下边缘带内、0 = 带外（决定自动滚动启停与方向）。 */
  const edgeDirection = useCallback((app: HTMLElement, clientY: number): -1 | 0 | 1 => {
    const rect = app.getBoundingClientRect();
    if (clientY < rect.top + EDGE_BAND) return -1;
    if (clientY > rect.bottom - EDGE_BAND) return 1;
    return 0;
  }, []);

  /** 停止边缘自动滚动（幂等）：拖动结束 / 指针离带 / pointercancel / 卸载统一经此清理，绝不留循环。 */
  const cancelAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  /** 更新持久化 store（React state 与 localStorage 同步；函数式更新避免读到旧值）。 */
  const updateStore = useCallback((mutate: (current: LayoutStore) => LayoutStore) => {
    setStore((current) => {
      const next = mutate(current);
      writeStore(next);
      return next;
    });
  }, []);

  /** 编辑会话内的撤销 / 重做历史（ref 供事件回调同步读取，state 驱动 canUndo/canRedo 重渲染）。 */
  const historyRef = useRef<LayoutHistory>(createHistory());
  const [historyState, setHistoryState] = useState<LayoutHistory>(() => createHistory());
  const applyHistory = useCallback((next: LayoutHistory) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  /**
   * 写入当前激活方案的快照（拖动 / 缩放 / 隐藏 / 重置 / 导入 / 撤销 / 重做的统一落点）。
   * 默认把「将被替换的旧快照」压入撤销栈（仅用户对布局的真实改动入栈）；
   * `{ noHistory: true }` 用于会话边界（进入编辑）与回放本身（撤销 / 重做 / 重置），避免污染撤销栈。
   */
  const commitSnapshot = useCallback(
    (next: LayoutSnapshot | null, options?: { noHistory?: boolean }) => {
      const previous = stateRef.current.snapshot;
      if (!options?.noHistory && previous) {
        applyHistory(pushHistory(historyRef.current, previous));
      }
      updateStore((current) => ({
        ...current,
        presets: current.presets.map((preset) => (preset.id === current.activePresetId ? { ...preset, snapshot: next } : preset)),
      }));
    },
    [updateStore, applyHistory],
  );

  /** 布局水平列宽（px = 卡片内容宽 / LAYOUT_COLS）：仅用于水平量（left/width/x/w）；垂直量一律走 GRID_PX 固定行。 */
  const colWidth = cardWidth > 0 ? cardWidth / LAYOUT_COLS : GRID_PX;

  // v3 → v4 一次性迁移：必须等卡片宽度就绪（colWidth 为真实列宽）才迁移，绝不用回退值换算
  // （错误列宽会以约 16x 偏差写坏布局）。迁移后清空 legacyRef —— StrictMode 的重复 effect
  // 与 state 初始化器的二次调用因 ref 为空而成为空操作，保证只落盘一次（幂等）。
  useEffect(() => {
    const legacy = legacyRef.current;
    if (!legacy || cardWidth <= 0) return;
    let migrated: LayoutStore;
    try {
      migrated = migrateV3ToV4(legacy, cardWidth / LAYOUT_COLS);
    } catch {
      legacyRef.current = null; // 换算失败：放弃迁移并保持流式，避免用错误列宽产出畸形布局
      return;
    }
    legacyRef.current = null;
    setStore(migrated);
    writeStore(migrated);
  }, [cardWidth]);

  // 卡片内容宽监测（display:contents 容器自身无盒，用父级 .composer 的内宽）
  useEffect(() => {
    const card = containerRef.current?.parentElement;
    if (!card) return;
    const update = () => {
      const style = window.getComputedStyle(card);
      const width = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setCardWidth((current) => (Math.abs(current - width) > 0.5 ? width : current));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    return () => observer.disconnect();
  }, [containerRef]);

  // 模块尺寸测量：ResizeObserver 盯住现有模块（高度 + 宽度），MutationObserver 负责条件渲染带来的增删
  // （隐藏 → 恢复复用同一套观察：节点重新连上后再次回调，宽度随之重建，档位属性自然恢复）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const seen = new Set<Element>();
    const observer = new ResizeObserver((entries) => {
      setMeasured((current) => {
        let changed = false;
        const next = { ...current };
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          const id = node.dataset.layoutId;
          if (!id) continue;
          const height = node.getBoundingClientRect().height;
          if (Math.abs((next[id] ?? -1) - height) > 0.5) {
            next[id] = height;
            changed = true;
          }
        }
        return changed ? next : current;
      });
      setWidths((current) => {
        let changed = false;
        const next = { ...current };
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          const id = node.dataset.layoutId;
          if (!id) continue;
          const width = node.getBoundingClientRect().width;
          if (Math.abs((next[id] ?? -1) - width) > 0.5) {
            next[id] = width;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    const scan = () => {
      for (const node of container.querySelectorAll<HTMLElement>("[data-layout-id]")) {
        if (!seen.has(node)) {
          seen.add(node);
          observer.observe(node);
        }
      }
      for (const node of [...seen]) {
        if (!node.isConnected) {
          observer.unobserve(node);
          seen.delete(node);
        }
      }
    };
    scan();
    const mutations = new MutationObserver(scan);
    mutations.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [containerRef]);

  /** 模块尺寸档位（由实测宽度推导）：widthPx ≤ 0（未测量）不触发任何档位；无档位模块恒全 false。 */
  const flagsOf = useCallback((id: LayoutModuleId) => sizeFlags(id, widths[id] ?? 0), [widths]);

  /** 模块根属性注入：仅返回真实生效的档位键（值为字符串 "true"，供 CSS 精确选择器匹配；无档位 → 空对象）。 */
  const dataFlagsOf = useCallback(
    (id: LayoutModuleId): { "data-layout-compact"?: "true"; "data-layout-narrow"?: "true" } => {
      const flags = flagsOf(id);
      const attrs: { "data-layout-compact"?: "true"; "data-layout-narrow"?: "true" } = {};
      if (flags.compact) attrs["data-layout-compact"] = "true";
      if (flags.narrow) attrs["data-layout-narrow"] = "true";
      return attrs;
    },
    [flagsOf],
  );

  /** 同步 details 类模块的折叠状态（ComposerPanel 的 onToggle 调用）。 */
  const setModuleCollapsed = useCallback((id: LayoutModuleId, collapsed: boolean) => {
    setCollapsedIds((current) => {
      if (current.has(id) === collapsed) return current;
      const next = new Set(current);
      if (collapsed) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** 非编辑态的折叠视图：模块高度回归内容（编辑态恒 false，显示布局真相）。 */
  const isCollapsedView = useCallback(
    (id: LayoutModuleId) => !editing && collapsedIds.has(id),
    [editing, collapsedIds],
  );

  /** 折叠模块的收缩高度（行）：实测内容高度取整，未测量时用 minH 换算兜底。 */
  const collapsedHeightRows = useCallback(
    (id: LayoutModuleId): number =>
      measured[id]
        ? Math.max(1, Math.round(measured[id] / GRID_PX))
        : Math.max(1, Math.ceil(moduleDef(id).minH / GRID_PX)),
    [measured],
  );

  /**
   * 折叠模块的显示收缩（非编辑态）：details 类模块折叠时内容高度远小于快照 h，若仍按快照 h 注入
   * min-height 会留出大块空白——且此时实测高度恒被 min-height 撑住、ResizeObserver 永不回调，
   * 无法靠实测自愈（必须先真正收缩、让尺寸变化发生）。因此渲染上折叠模块不注入 min-height
   * （高度完全交给内容），布局解算（推挤 / 容器高度）改用实测高度换算的收缩值；
   * 编辑态恒返回原值：编辑视图显示布局真相，拖拽 / 缩放热区与快照一致。
   */
  const displayPlacementOf = useCallback(
    (id: LayoutModuleId, placement: LayoutPlacement): LayoutPlacement => {
      if (!isCollapsedView(id)) return placement;
      const height = collapsedHeightRows(id);
      return placement.h === height ? placement : { ...placement, h: height };
    },
    [isCollapsedView, collapsedHeightRows],
  );

  // 渲染用快照：补齐当前模式下缺失的模块（不改写持久化，等下次进入编辑时落盘）
  const resolved = useMemo<LayoutSnapshot | null>(
    () => (snapshot ? ensureModePlacements(snapshot, mode) : null),
    [snapshot, mode],
  );

  const layoutItems = useMemo(() => {
    if (!resolved) return [];
    const base = visibleModuleIds(mode)
      .filter((id) => !isHidden(resolved, mode, id))
      .map((id) => {
        const placement = effectivePlacement(resolved, mode, id)!;
        const measuredH = measured[id] ? measured[id] / GRID_PX : undefined;
        return { id, placement, measuredH };
      });
    // 折叠视图：收缩模块高度，并把当年被「展开高度」推下去的模块同步上移——
    // 消除快照里遗留的空白（测量于展开态的下方模块位置会带上展开高度的偏差）。
    const collapsedHeights: Partial<Record<LayoutModuleId, number>> = {};
    for (const item of base) {
      if (isCollapsedView(item.id)) collapsedHeights[item.id] = collapsedHeightRows(item.id);
    }
    return compactCollapsedItems(base, collapsedHeights);
  }, [resolved, mode, measured, isCollapsedView, collapsedHeightRows]);

  const displayTops = useMemo(() => resolveVerticalLayout(layoutItems), [layoutItems]);

  /** 模块样式注入：流式 → undefined；网格 → 绝对定位（含隐藏 display:none）；拖动中 → 跟随实时矩形。 */
  const styleOf = useCallback(
    (id: LayoutModuleId): React.CSSProperties | undefined => {
      if (!resolved) return undefined;
      if (isHidden(resolved, mode, id)) return { display: "none" };
      const placement = effectivePlacement(resolved, mode, id);
      if (!placement) return undefined;
      if (live?.id === id) {
        return { position: "absolute", left: live.x, top: live.y, width: live.w, minHeight: live.h, zIndex: 5 };
      }
      const shown = displayPlacementOf(id, placement);
      // 拖动中优先用全场推挤预览（被推模块实时下移）；否则用渲染解算 top。
      const top = pushTops?.[id] ?? displayTops[id] ?? shown.y;
      return {
        position: "absolute",
        left: displayLeft(shown) * colWidth,
        top: top * GRID_PX,
        width: Math.min(shown.w, LAYOUT_COLS) * colWidth,
        // 折叠（非编辑态）不注入 min-height：高度完全由内容决定，避免快照 h 撑出空白。
        minHeight: isCollapsedView(id) ? undefined : shown.h * GRID_PX,
      };
    },
    [resolved, mode, colWidth, live, displayTops, pushTops, displayPlacementOf, isCollapsedView],
  );

  /** 模块容器高度（网格模式下显式撑开，流式下由文档流决定）。 */
  const containerHeight = useMemo(() => {
    let bottom = 0;
    for (const item of layoutItems) {
      // 拖动中容器高度须容纳被推挤下移的模块，避免预览越出网格容器。
      const top = pushTops?.[item.id] ?? displayTops[item.id] ?? item.placement.y;
      bottom = Math.max(bottom, (top + Math.max(item.placement.h, item.measuredH ?? 0)) * GRID_PX);
    }
    return bottom;
  }, [layoutItems, displayTops, pushTops]);

  /** 编辑模式覆盖层热区（与模块同位置同尺寸；编辑态下替代内容交互承担拖拽 / 缩放）。 */
  const handles = useMemo<LayoutHandle[]>(() => {
    if (!editing || !resolved) return [];
    return layoutItems.map((item) => {
      if (live?.id === item.id) {
        return { id: item.id, label: moduleLabel(item.id), left: live.x, top: live.y, width: live.w, height: live.h };
      }
      // 手柄层跟随推挤预览（被推模块的拖拽 / 缩放热区须与其可见位置一致）。
      const top = pushTops?.[item.id] ?? displayTops[item.id] ?? item.placement.y;
      return {
        id: item.id,
        label: moduleLabel(item.id),
        left: displayLeft(item.placement) * colWidth,
        top: top * GRID_PX,
        width: Math.min(item.placement.w, LAYOUT_COLS) * colWidth,
        height: Math.max(item.measuredH ?? 0, item.placement.h) * GRID_PX,
      };
    });
  }, [editing, resolved, layoutItems, displayTops, colWidth, live, pushTops]);

  /** 吸附落点预览矩形（px）：与 handles 同一坐标系（.layout-handle-layer 内绝对定位），无预览时 undefined。 */
  const ghostRect = useMemo<React.CSSProperties | undefined>(() => {
    if (!ghost) return undefined;
    return {
      position: "absolute",
      left: ghost.x * colWidth,
      top: ghost.y * GRID_PX,
      width: ghost.w * colWidth,
      height: ghost.h * GRID_PX,
      pointerEvents: "none",
    };
  }, [ghost, colWidth]);

  /** 当前模式下被隐藏的模块（供「已隐藏」列表恢复；通用模块隐藏 = 三模式同藏）。 */
  const hiddenIds = useMemo(
    () => (resolved ? visibleModuleIds(mode).filter((id) => isHidden(resolved, mode, id)) : []),
    [resolved, mode],
  );

  /** 隐藏模块：通用模块三模式同步隐藏，专属模块仅本模式（见 src/lib/layout.ts 的隐藏语义）。 */
  const hideModule = useCallback(
    (id: LayoutModuleId) => {
      const state = stateRef.current;
      if (!state.snapshot) return;
      commitSnapshot(setHidden(state.snapshot, mode, id, true));
    },
    [mode, commitSnapshot],
  );

  /** 恢复被隐藏的模块。 */
  const showModule = useCallback(
    (id: LayoutModuleId) => {
      const state = stateRef.current;
      if (!state.snapshot) return;
      commitSnapshot(setHidden(state.snapshot, mode, id, false));
    },
    [mode, commitSnapshot],
  );

  /** 恢复默认布局：清空自定义快照 → 回到流式渲染（与现状零差异），并退出编辑模式（不入撤销栈）。 */
  const resetLayout = useCallback(() => {
    commitSnapshot(null, { noHistory: true });
    setEditing(false);
  }, [commitSnapshot]);

  const beginDrag = useCallback(
    (id: LayoutModuleId, kind: "move" | "resize-e" | "resize-s" | "resize-se", event: React.PointerEvent) => {
      cancelAutoScroll();
      applyGhost(null);
      applyPushTops(null);
      const state = stateRef.current;
      if (!state.snapshot) return;
      const current = ensureModePlacements(state.snapshot, mode);
      const placement = effectivePlacement(current, mode, id);
      if (!placement) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      // 从「所见位置」开始（px）：y 取显示 top（行→px 经 GRID_PX）、x/w 取列范围 clamp 后的值（与渲染一致）。
      const shownX = displayLeft(placement) * colWidth;
      const shownY = (displayTops[id] ?? placement.y) * GRID_PX;
      const shownW = Math.min(placement.w, LAYOUT_COLS) * colWidth;
      // 垂直缩放下限（会话级判定一次）：网格态元素高度 = max(内容自然高度, 撑开高度 placement.h*GRID_PX)，
      // 实测值恒 ≥ 当前高度，直接采信会把「拉矮」永久钳住（只能拉高不能拉矮）；
      // 仅在内容顶破撑开高度时取实测（= 内容自然高度）为下限，见 minResizeHeightPx。
      const minHpx = minResizeHeightPx(moduleDef(id).minH, state.measured[id] ?? 0, placement.h * GRID_PX);
      // 页面滚动补偿基准：记录唯一页面滚动容器 .app 与其当前 scrollTop（不存在时为 null，行为退化为无补偿）。
      const app = containerRef.current ? (containerRef.current.closest(".app") as HTMLElement | null) : null;
      dragRef.current = {
        id,
        kind,
        startClientX: event.clientX,
        startClientY: event.clientY,
        start: { x: shownX, y: shownY, w: shownW, h: placement.h * GRID_PX },
        minHpx,
        app,
        scroll0: app ? app.scrollTop : 0,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      applyLive({ id, x: shownX, y: shownY, w: shownW, h: placement.h * GRID_PX });
    },
    [mode, colWidth, displayTops, containerRef, cancelAutoScroll],
  );

  /**
   * 由实时矩形解算落点预览：move = 拖拽者优先的全场纵向推挤（ghost 为拖拽者修正后落点、tops 为全场 top）；
   * resize-* = 维持既有 findFreeSlot 避让（tops 恒 null）。recomputeDrag 与 endDrag 回退共用此函数，
   * 保证「预览 = 落地」永不漂移（与改造前 findFreeSlot 的单点契约一致）。
   */
  const resolveDragPreview = useCallback(
    (drag: DragSession, rect: LiveRect): { ghost: LayoutPlacement; tops: Record<string, number> | null } | null => {
      const state = stateRef.current;
      if (!state.snapshot) return null;
      const def = moduleDef(drag.id);
      // 松手吸附：水平吸附到列，垂直经 snapToGrid 吸附到 GRID_PX 行；minW 换算为列、minH 用会话级 drag.minHpx 换算为行。
      const desired: LayoutPlacement = {
        x: Math.round(rect.x / colWidth),
        y: Math.round(snapToGrid(rect.y) / GRID_PX),
        w: Math.max(Math.round(rect.w / colWidth), Math.ceil(def.minW / colWidth)),
        h: Math.max(Math.round(rect.h / GRID_PX), Math.ceil(drag.minHpx / GRID_PX)),
      };
      if (drag.kind === "move") {
        // move 走推挤：先按列范围 clamp 期望落点（w ≤ 列数、x ∈ [0, 列数−w]），再用拖拽者优先解算全场 top（只调 y、只下推）。
        const w = Math.min(desired.w, LAYOUT_COLS);
        const desiredMove: LayoutPlacement = {
          ...desired,
          w,
          x: Math.max(0, Math.min(desired.x, Math.max(0, LAYOUT_COLS - w))),
        };
        const items = layoutItems.map((item) => (item.id === drag.id ? { ...item, placement: desiredMove } : item));
        const tops = resolvePushLayout(items, drag.id);
        return { ghost: { ...desiredMove, y: tops[drag.id] ?? desiredMove.y }, tops };
      }
      // resize-* 维持既有行为：快照占用 → 最近空位避让。
      const occupied = occupiedWithMeasured(state.snapshot, mode, drag.id, state.measured, GRID_PX);
      return { ghost: findFreeSlot(desired, occupied), tops: null };
    },
    [colWidth, mode, layoutItems],
  );

  /**
   * 依据指针 client 坐标重算实时矩形与吸附预览（moveDrag 与边缘自动滚动每帧共用同一路径，避免两处公式漂移）。
   * 垂直位移追加页面滚动补偿：dy = 指针位移 + (.app.scrollTop − 起始 scrollTop)。.app 是唯一页面级滚动容器，
   * 拖动中页面滚动时，被拖模块（move 的 y / 缩放的下缘高）须继续贴在指针下——缩放的高度同样跟指针内容坐标距离走。
   */
  const recomputeDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.lastClientX = clientX;
      drag.lastClientY = clientY;
      const dx = clientX - drag.startClientX;
      const dy = clientY - drag.startClientY + ((drag.app?.scrollTop ?? 0) - drag.scroll0);
      const base = drag.start;
      const def = moduleDef(drag.id);
      // 拖拽下限为 px 域：minW（px）换算为列；minH 用会话开始时判定的 drag.minHpx
      // （会话内固定，绝不读实时实测值——实测 ≥ 当前高度会把「拉矮」钳死）。
      const minWpx = Math.max(1, Math.ceil(def.minW / colWidth)) * colWidth;
      // 自由跟随指针的实时矩形（不吸附）：按 kind 只改动对应维度。
      // move 改 x/y；resize-e/s/se 分别只改右缘宽 / 下缘高 / 右下角宽高，x/y 恒取基准（缩放绝不移动模块）。
      const isMove = drag.kind === "move";
      const growsW = drag.kind === "resize-e" || drag.kind === "resize-se";
      const growsH = drag.kind === "resize-s" || drag.kind === "resize-se";
      const rect: LiveRect = {
        id: drag.id,
        x: isMove ? base.x + dx : base.x,
        y: isMove ? base.y + dy : base.y,
        w: growsW ? Math.max(base.w + dx, minWpx) : base.w,
        h: growsH ? Math.max(base.h + dy, drag.minHpx) : base.h,
      };
      applyLive(rect);
      // 落点预览：与 endDrag 共用同一解算（shared helper），保证预览 = 落地位置。
      const preview = resolveDragPreview(drag, rect);
      applyGhost(preview ? preview.ghost : null);
      applyPushTops(preview ? preview.tops : null);
    },
    [colWidth, resolveDragPreview],
  );

  /**
   * 边缘自动滚动每帧执行体（命名函数表达式：自调度用内部名，不构成 useCallback 的循环类型依赖）。
   * 指针在 .app 视口上/下 48px 带内时按接近度线性滚动（0→15px/帧）；每帧用最后指针坐标重算实时矩形 + 吸附预览，
   * 模块随自动滚动继续跟手。离开边缘带 / 无 drag / 已到顶底 → 停止（不再排下一帧）。
   */
  const stepAutoScroll = useCallback(
    function step() {
      scrollRafRef.current = null;
      const drag = dragRef.current;
      const app = drag?.app ?? null;
      if (!drag || !app) return;
      const direction = edgeDirection(app, drag.lastClientY);
      if (direction === 0) return; // 指针已离开边缘带：停止循环
      const rect = app.getBoundingClientRect();
      // 接近度 0 → 1（距离 48 → 0），方向由上下边缘决定（上 = -1 向上滚、下 = +1 向下滚）。
      const distance = direction < 0 ? Math.max(0, drag.lastClientY - rect.top) : Math.max(0, rect.bottom - drag.lastClientY);
      const proximity = (EDGE_BAND - distance) / EDGE_BAND;
      const before = app.scrollTop;
      app.scrollTop = before + direction * proximity * EDGE_MAX_STEP;
      if (app.scrollTop === before) return; // 已到顶 / 底：无滚动可做，停止空转（指针再动会经 moveDrag 重启）
      recomputeDrag(drag.lastClientX, drag.lastClientY);
      scrollRafRef.current = window.requestAnimationFrame(step);
    },
    [edgeDirection, recomputeDrag],
  );

  /** 启动边缘自动滚动（幂等：已有循环不重复排帧）。 */
  const startAutoScroll = useCallback(() => {
    if (scrollRafRef.current === null) {
      scrollRafRef.current = window.requestAnimationFrame(stepAutoScroll);
    }
  }, [stepAutoScroll]);

  const moveDrag = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      recomputeDrag(event.clientX, event.clientY);
      // 指针在边缘带内 → 启动自动滚动；离带 → 立即取消，绝不让循环在带外继续跑。
      if (drag.app && edgeDirection(drag.app, event.clientY) !== 0) startAutoScroll();
      else cancelAutoScroll();
    },
    [recomputeDrag, edgeDirection, startAutoScroll, cancelAutoScroll],
  );

  const endDrag = useCallback(() => {
    cancelAutoScroll();
    const drag = dragRef.current;
    const liveRect = liveRef.current;
    const ghostSlot = ghostRef.current;
    // 先读推挤预览再清理（退出路径一律清理，避免预览残留）。
    const previewTops = pushTopsRef.current;
    dragRef.current = null;
    applyLive(null);
    applyGhost(null);
    applyPushTops(null);
    const state = stateRef.current;
    if (!drag || !liveRect || !state.snapshot) return;
    // 落点与推挤预览优先取拖动中已算好的结果；无预览时用同一共享公式回退重算，保证预览 = 落地。
    let ghost = ghostSlot;
    let tops = drag.kind === "move" ? previewTops : null;
    if (!ghost) {
      const recomputed = resolveDragPreview(drag, liveRect);
      if (!recomputed) return;
      ghost = recomputed.ghost;
      tops = recomputed.tops;
    }
    // 推挤结果落到快照：仅写「本次拖动确实改变其显示位置」的可见模块（moving 自己最后写），单次提交 = 单条撤销历史。
    let next = state.snapshot;
    if (tops) {
      for (const id of visibleModuleIds(mode)) {
        if (id === drag.id || isHidden(next, mode, id)) continue;
        if (!(id in tops)) continue;
        const target = tops[id];
        if (target === displayTops[id]) continue; // 未受本次拖动影响（含显示层原有推挤）→ 不写
        const current = effectivePlacement(next, mode, id);
        if (!current || current.y === target) continue;
        next = setPlacement(next, mode, id, { ...current, y: target });
      }
    }
    next = setPlacement(next, mode, drag.id, ghost);
    commitSnapshot(next);
  }, [mode, commitSnapshot, cancelAutoScroll, resolveDragPreview, displayTops]);

  // 卸载清理：组件卸载时终止仍在运行的自动滚动循环（与 endDrag / 离带 / pointercancel 并列的第四道取消点）。
  useEffect(() => cancelAutoScroll, [cancelAutoScroll]);

  /** 入口：进入编辑模式（首次 = 测量现状生成初始快照；已有 = 补位缺失模块）；再次点击退出。进出均清空撤销栈（会话级）。 */
  const toggleEditing = useCallback(() => {
    if (editing) {
      applyHistory(createHistory());
      setEditing(false);
      return;
    }
    const state = stateRef.current;
    // 卡片宽度尚未就绪（挂载未完成）时不进入，避免按错误列宽生成畸形快照。
    if (state.cardWidth <= 0) return;
    let base = state.snapshot;
    if (!base) {
      base = measureInitial(containerRef.current, mode, state.cardWidth);
      if (!base) return;
    } else {
      base = ensureModePlacements(base, mode);
    }
    applyHistory(createHistory());
    commitSnapshot(base, { noHistory: true });
    setEditing(true);
  }, [editing, mode, containerRef, commitSnapshot, applyHistory]);

  // —— 撤销 / 重做（仅编辑会话内；回放本身不入栈）——

  const undo = useCallback(() => {
    const current = stateRef.current.snapshot;
    if (!current) return;
    const step = undoHistory(historyRef.current, current);
    if (!step) return;
    applyHistory(step.history);
    commitSnapshot(step.snapshot, { noHistory: true });
  }, [applyHistory, commitSnapshot]);

  const redo = useCallback(() => {
    const current = stateRef.current.snapshot;
    if (!current) return;
    const step = redoHistory(historyRef.current, current);
    if (!step) return;
    applyHistory(step.history);
    commitSnapshot(step.snapshot, { noHistory: true });
  }, [applyHistory, commitSnapshot]);

  // 快捷键：仅编辑态生效；焦点在输入控件 / 可编辑元素时不拦截（保留原生文本撤销）。
  const handleShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (isTextEditingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    },
    [undo, redo],
  );
  useGlobalKeyDown(handleShortcut, editing);

  // —— 方案管理（新建 / 切换 / 重命名 / 删除）——

  /** 另存为：把当前布局复制为命名方案并激活（保持编辑态，便于继续调整）。 */
  const createPreset = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      updateStore((current) => {
        const active = current.presets.find((item) => item.id === current.activePresetId) ?? current.presets[0];
        const id = `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        return {
          ...current,
          activePresetId: id,
          presets: [...current.presets, { id, name: trimmed, snapshot: active?.snapshot ?? null }],
        };
      });
    },
    [updateStore],
  );

  /** 切换方案（退出编辑，加载目标方案快照）。 */
  const switchPreset = useCallback(
    (id: string) => {
      setEditing(false);
      updateStore((current) => (current.presets.some((item) => item.id === id) ? { ...current, activePresetId: id } : current));
    },
    [updateStore],
  );

  /** 重命名方案。 */
  const renamePreset = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      updateStore((current) => ({ ...current, presets: current.presets.map((item) => (item.id === id ? { ...item, name: trimmed } : item)) }));
    },
    [updateStore],
  );

  /** 删除方案（「默认」不可删；删除当前激活方案时回落到默认方案）。 */
  const deletePreset = useCallback(
    (id: string) => {
      if (id === DEFAULT_PRESET_ID) return;
      setEditing(false);
      updateStore((current) => {
        const presets = current.presets.filter((item) => item.id !== id);
        if (!presets.length) presets.push(defaultPreset());
        const activePresetId =
          current.activePresetId === id
            ? (presets.find((item) => item.id === DEFAULT_PRESET_ID)?.id ?? presets[0].id)
            : current.activePresetId;
        return { ...current, presets, activePresetId };
      });
    },
    [updateStore],
  );

  /**
   * 导入分享码：只替换通用池（坐标 + 隐藏），随后补齐缺失模块并消解冲突
   * （新的通用位置与专属模块撞位时专属让位）。
   */
  const importSharedLayout = useCallback(
    (decoded: { shared: PlacementMap; hidden: LayoutModuleId[] }) => {
      const state = stateRef.current;
      const current = state.snapshot ?? createEmptySnapshot();
      let next = applySharedLayout(current, decoded.shared, decoded.hidden);
      next = ensureModePlacements(next, mode);
      next = resolveAllConflicts(next, mode);
      commitSnapshot(next);
    },
    [mode, commitSnapshot],
  );

  return {
    /** 编辑模式开启中 */
    editing,
    /** 已建立自定义布局（快照存在 → 网格渲染）；false = 流式（与现状零差异） */
    custom: snapshot !== null,
    /** 当前水平列宽（px = 卡片内容宽 / LAYOUT_COLS；导入旧版 ITL1 分享码时换算 y/h 用）。 */
    colWidth,
    /** 拖动 / 缩放中的模块 id（视觉反馈用）。 */
    draggingId: live?.id ?? null,
    styleOf,
    /** 按实测宽度推导的尺寸档位属性（仅含生效键；流式注入无副作用，CSS 仅在 .layout-grid 作用域响应）。 */
    dataFlagsOf,
    modulesClassName: resolved ? "composer-modules layout-grid" : "composer-modules",
    modulesStyle: resolved
      ? ({ height: containerHeight, "--layout-col-unit": `${colWidth}px`, "--layout-row-unit": `${GRID_PX}px` } as React.CSSProperties)
      : undefined,
    handles,
    /** 拖动 / 缩放时的吸附落点预览（px 绝对定位矩形；null 表示无预览） */
    ghostRect,
    /** 当前模式下已隐藏、可从列表恢复的模块 */
    hiddenIds,
    hideModule,
    showModule,
    /** 同步 details 类模块的折叠状态（非编辑态收缩为内容高度，编辑态显示布局真相） */
    setModuleCollapsed,
    resetLayout,
    beginDrag,
    moveDrag,
    endDrag,
    toggleEditing,
    /** 撤销栈非空（按钮可用态） */
    canUndo: historyState.past.length > 0,
    /** 重做栈非空（按钮可用态） */
    canRedo: historyState.future.length > 0,
    /** 撤销上一步布局改动（仅编辑会话内；回放不入栈） */
    undo,
    /** 重做被撤销的布局改动 */
    redo,
    /** 当前激活方案快照（编码分享码用） */
    snapshot,
    /** 方案列表（id + 名称）；默认方案的初始名按当前语言显示，用户重命名后保留自定义名。 */
    presets: store.presets.map((item) => ({
      id: item.id,
      name: item.id === DEFAULT_PRESET_ID && item.name === DEFAULT_PRESET_NAME ? t("默认") : item.name,
    })),
    activePresetId: store.activePresetId,
    createPreset,
    switchPreset,
    renamePreset,
    deletePreset,
    importSharedLayout,
  };
}
