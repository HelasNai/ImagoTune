import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySharedLayout,
  createEmptySnapshot,
  effectivePlacement,
  ensureModePlacements,
  findFreeSlot,
  GRID_PX,
  isHidden,
  isKnownModuleId,
  LAYOUT_COLS,
  moduleDef,
  resolveAllConflicts,
  resolveVerticalLayout,
  setHidden,
  setPlacement,
  visibleModuleIds,
  type LayoutMode,
  type LayoutModuleId,
  type LayoutPlacement,
  type LayoutSnapshot,
  type PlacementMap,
} from "../lib/layout";

const STORAGE_KEY = "imagotune:layout:v1";

/** 一套命名方案（default = 基础方案；snapshot 为 null 表示尚未自定义 / 已恢复默认）。 */
type LayoutPreset = { id: string; name: string; snapshot: LayoutSnapshot | null };
/** 持久化结构（version 3：坐标语义为「比例单位」——水平列与垂直格共用同一单位（= 卡宽/64），整层随窗口等比缩放；v1/v2 旧数据直接丢弃重建）。 */
type LayoutStore = { version: 3; activePresetId: string; presets: LayoutPreset[] };

const DEFAULT_PRESET: LayoutPreset = { id: "default", name: "默认", snapshot: null };

function emptyStore(): LayoutStore {
  return { version: 3, activePresetId: DEFAULT_PRESET.id, presets: [{ ...DEFAULT_PRESET }] };
}

function loadStore(): LayoutStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as LayoutStore;
    if (!parsed || parsed.version !== 3 || !Array.isArray(parsed.presets) || !parsed.presets.length) return emptyStore();
    // 容错：补回 default 方案（方案管理与分享都假定它存在）。
    if (!parsed.presets.some((item) => item.id === DEFAULT_PRESET.id)) parsed.presets.unshift({ ...DEFAULT_PRESET });
    return parsed;
  } catch {
    return emptyStore();
  }
}

function writeStore(store: LayoutStore) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 本地布局保存失败不影响创作（下次改动会重试） */
  }
}

/** 编辑模式覆盖层一项：模块的拖拽 / 缩放热区（px）。 */
export type LayoutHandle = { id: LayoutModuleId; label: string; left: number; top: number; width: number; height: number };

type DragSession = {
  id: LayoutModuleId;
  kind: "move" | "resize";
  startClientX: number;
  startClientY: number;
  /** 拖拽基准（px；取「所见位置」，y 用显示 top 而非快照 y，保证从所见位置开始拖）。 */
  start: LayoutPlacement;
};

type LiveRect = { id: LayoutModuleId; x: number; y: number; w: number; h: number };

/** 列范围内 clamp 后的显示左缘（列单位）。 */
function displayLeft(placement: LayoutPlacement): number {
  const width = Math.min(placement.w, LAYOUT_COLS);
  return Math.max(0, Math.min(placement.x, Math.max(0, LAYOUT_COLS - width)));
}

/** 占用矩形：宽度按列范围 clamp、高度取「快照 h 与实测高度」较大者，更接近真实遮挡（unit = 比例单位 px）。 */
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

/** 首次进入编辑模式：测量当前流式排布（以第一个模块左上角为原点），生成初始快照（水平换算为列、垂直换算为同一比例单位）。 */
function measureInitial(container: HTMLElement | null, mode: LayoutMode, cardWidth: number): LayoutSnapshot | null {
  if (!container) return null;
  const nodes = [...container.querySelectorAll<HTMLElement>("[data-layout-id]")];
  if (!nodes.length) return null;
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
    const placement: LayoutPlacement = {
      x: Math.floor((rect.left - originX) / colWidth),
      y: Math.floor((rect.top - originY) / colWidth),
      w: Math.max(Math.round(rect.width / colWidth), moduleDef(id).minW),
      h: Math.max(Math.round(rect.height / colWidth), moduleDef(id).minH),
    };
    snapshot = setPlacement(snapshot, mode, id, placement);
  }
  return ensureModePlacements(snapshot, mode);
}

/**
 * 创作页布局编辑（网格画布 + 自由拖动 / 松手吸附 / 缩放 / 隐藏）。
 * - 坐标系 = 比例单位（水平列与垂直格共用同一单位 = 卡宽 / LAYOUT_COLS）：整层随窗口
 *   等比缩放，窗口还原时布局还原（不含取整误差）；
 * - 快照为 null = 流式（与现状零差异）；首次进入编辑时测量生成，之后实时写入 localStorage；
 * - 通用模块共享一份坐标（三模式同步）、专属模块按模式分层（见 src/lib/layout.ts）；
 * - 渲染显示位置 = 意图坐标经「纵向推挤」消解（模块内容高度动态时不重叠）。
 */
export function useComposerLayout({ mode, containerRef }: {
  mode: LayoutMode;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [store, setStore] = useState<LayoutStore>(() => loadStore());
  const activePreset = store.presets.find((item) => item.id === store.activePresetId) ?? store.presets[0];
  /** 当前激活方案的快照（null = 流式渲染，与现状零差异）。 */
  const snapshot = activePreset?.snapshot ?? null;
  const [editing, setEditing] = useState(false);
  /** 模块实测高度（px；id → 高度）。 */
  const [measured, setMeasured] = useState<Record<string, number>>({});
  /** 卡片内容宽（px，模块可用宽）。 */
  const [cardWidth, setCardWidth] = useState(0);
  /** 拖动 / 缩放中的实时矩形（px，自由不吸附）。 */
  const [live, setLive] = useState<LiveRect | null>(null);
  const liveRef = useRef<LiveRect | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  /** 事件回调读取的最新状态（事件发生在提交之后，effect 同步足够）。 */
  const stateRef = useRef({ snapshot, measured, cardWidth });
  useEffect(() => {
    stateRef.current = { snapshot, measured, cardWidth };
  });

  const applyLive = (rect: LiveRect | null) => {
    liveRef.current = rect;
    setLive(rect);
  };

  /** 更新持久化 store（React state 与 localStorage 同步；函数式更新避免读到旧值）。 */
  const updateStore = useCallback((mutate: (current: LayoutStore) => LayoutStore) => {
    setStore((current) => {
      const next = mutate(current);
      writeStore(next);
      return next;
    });
  }, []);

  /** 写入当前激活方案的快照（拖动 / 缩放 / 隐藏 / 重置的统一落点）。 */
  const commitSnapshot = useCallback((next: LayoutSnapshot | null) => {
    updateStore((current) => ({
      ...current,
      presets: current.presets.map((preset) => (preset.id === current.activePresetId ? { ...preset, snapshot: next } : preset)),
    }));
  }, [updateStore]);

  /** 布局比例单位（px = 卡片内容宽 / LAYOUT_COLS）：水平列与垂直格共用同一单位，整层随窗口等比缩放。 */
  const colWidth = cardWidth > 0 ? cardWidth / LAYOUT_COLS : GRID_PX;

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

  // 模块高度测量：ResizeObserver 盯住现有模块，MutationObserver 负责条件渲染带来的增删
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

  // 渲染用快照：补齐当前模式下缺失的模块（不改写持久化，等下次进入编辑时落盘）
  const resolved = useMemo<LayoutSnapshot | null>(
    () => (snapshot ? ensureModePlacements(snapshot, mode) : null),
    [snapshot, mode],
  );

  const layoutItems = useMemo(
    () =>
      resolved
        ? visibleModuleIds(mode)
            .filter((id) => !isHidden(resolved, mode, id))
            .map((id) => {
              const placement = effectivePlacement(resolved, mode, id)!;
              const measuredH = measured[id] ? measured[id] / colWidth : undefined;
              return { id, placement, measuredH };
            })
        : [],
    [resolved, mode, measured, colWidth],
  );

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
      const top = displayTops[id] ?? placement.y;
      return {
        position: "absolute",
        left: displayLeft(placement) * colWidth,
        top: top * colWidth,
        width: Math.min(placement.w, LAYOUT_COLS) * colWidth,
        minHeight: placement.h * colWidth,
      };
    },
    [resolved, mode, colWidth, live, displayTops],
  );

  /** 模块容器高度（网格模式下显式撑开，流式下由文档流决定）。 */
  const containerHeight = useMemo(() => {
    let bottom = 0;
    for (const item of layoutItems) {
      const top = displayTops[item.id] ?? item.placement.y;
      bottom = Math.max(bottom, (top + Math.max(item.placement.h, item.measuredH ?? 0)) * colWidth);
    }
    return bottom;
  }, [layoutItems, displayTops, colWidth]);

  /** 编辑模式覆盖层热区（与模块同位置同尺寸；编辑态下替代内容交互承担拖拽 / 缩放）。 */
  const handles = useMemo<LayoutHandle[]>(() => {
    if (!editing || !resolved) return [];
    return layoutItems.map((item) => {
      if (live?.id === item.id) {
        return { id: item.id, label: moduleDef(item.id).label, left: live.x, top: live.y, width: live.w, height: live.h };
      }
      const top = displayTops[item.id] ?? item.placement.y;
      return {
        id: item.id,
        label: moduleDef(item.id).label,
        left: displayLeft(item.placement) * colWidth,
        top: top * colWidth,
        width: Math.min(item.placement.w, LAYOUT_COLS) * colWidth,
        height: Math.max(item.measuredH ?? 0, item.placement.h) * colWidth,
      };
    });
  }, [editing, resolved, layoutItems, displayTops, colWidth, live]);

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

  /** 恢复默认布局：清空自定义快照 → 回到流式渲染（与现状零差异），并退出编辑模式。 */
  const resetLayout = useCallback(() => {
    commitSnapshot(null);
    setEditing(false);
  }, [commitSnapshot]);

  /** 增强进度条等「跟随 prompt-assistant」的附属元素在网格模式下的位置（紧贴其底边）。 */
  const followerStyle = useCallback((): React.CSSProperties | undefined => {
    if (!resolved) return undefined;
    const anchor = effectivePlacement(resolved, mode, "prompt-assistant");
    if (!anchor) return undefined;
    const top = displayTops["prompt-assistant"] ?? anchor.y;
    const anchorHeight = Math.max(anchor.h, measured["prompt-assistant"] ? measured["prompt-assistant"] / colWidth : 0);
    return {
      position: "absolute",
      left: displayLeft(anchor) * colWidth,
      top: (top + anchorHeight) * colWidth,
      width: Math.min(anchor.w, LAYOUT_COLS) * colWidth,
    };
  }, [resolved, mode, colWidth, displayTops, measured]);

  const beginDrag = useCallback(
    (id: LayoutModuleId, kind: "move" | "resize", event: React.PointerEvent) => {
      const state = stateRef.current;
      if (!state.snapshot) return;
      const current = ensureModePlacements(state.snapshot, mode);
      const placement = effectivePlacement(current, mode, id);
      if (!placement) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      // 从「所见位置」开始（px）：y 取显示 top、x/w 取列范围 clamp 后的值（与渲染一致）。
      const shownX = displayLeft(placement) * colWidth;
      const shownY = (displayTops[id] ?? placement.y) * colWidth;
      const shownW = Math.min(placement.w, LAYOUT_COLS) * colWidth;
      dragRef.current = {
        id,
        kind,
        startClientX: event.clientX,
        startClientY: event.clientY,
        start: { x: shownX, y: shownY, w: shownW, h: placement.h * colWidth },
      };
      applyLive({ id, x: shownX, y: shownY, w: shownW, h: placement.h * colWidth });
    },
    [mode, colWidth, displayTops],
  );

  const moveDrag = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    const base = drag.start;
    if (drag.kind === "move") {
      applyLive({ id: drag.id, x: base.x + dx, y: base.y + dy, w: base.w, h: base.h });
      return;
    }
    const def = moduleDef(drag.id);
    applyLive({
      id: drag.id,
      x: base.x,
      y: base.y,
      w: Math.max(base.w + dx, def.minW * colWidth),
      h: Math.max(base.h + dy, def.minH * colWidth),
    });
  }, [colWidth]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    const liveRect = liveRef.current;
    dragRef.current = null;
    applyLive(null);
    const state = stateRef.current;
    if (!drag || !liveRect || !state.snapshot) return;
    const def = moduleDef(drag.id);
    // 松手吸附：水平吸附到列、垂直吸附到同一比例单位（整层等比）。
    const desired: LayoutPlacement = {
      x: Math.round(liveRect.x / colWidth),
      y: Math.round(liveRect.y / colWidth),
      w: Math.max(Math.round(liveRect.w / colWidth), def.minW),
      h: Math.max(Math.round(liveRect.h / colWidth), def.minH),
    };
    const occupied = occupiedWithMeasured(state.snapshot, mode, drag.id, state.measured, colWidth);
    const placed = findFreeSlot(desired, occupied);
    commitSnapshot(setPlacement(state.snapshot, mode, drag.id, placed));
  }, [mode, colWidth, commitSnapshot]);

  /** 入口：进入编辑模式（首次 = 测量现状生成初始快照；已有 = 补位缺失模块）；再次点击退出。 */
  const toggleEditing = useCallback(() => {
    if (editing) {
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
    commitSnapshot(base);
    setEditing(true);
  }, [editing, mode, containerRef, commitSnapshot]);

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
      if (id === DEFAULT_PRESET.id) return;
      setEditing(false);
      updateStore((current) => {
        const presets = current.presets.filter((item) => item.id !== id);
        if (!presets.length) presets.push({ ...DEFAULT_PRESET });
        const activePresetId =
          current.activePresetId === id
            ? (presets.find((item) => item.id === DEFAULT_PRESET.id)?.id ?? presets[0].id)
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
    /** 拖动 / 缩放中的模块 id（视觉反馈用）。 */
    draggingId: live?.id ?? null,
    styleOf,
    modulesClassName: resolved ? "composer-modules layout-grid" : "composer-modules",
    modulesStyle: resolved ? ({ height: containerHeight, "--layout-unit": `${colWidth}px` } as React.CSSProperties) : undefined,
    handles,
    /** 当前模式下已隐藏、可从列表恢复的模块 */
    hiddenIds,
    hideModule,
    showModule,
    resetLayout,
    followerStyle,
    beginDrag,
    moveDrag,
    endDrag,
    toggleEditing,
    /** 当前激活方案快照（编码分享码用） */
    snapshot,
    /** 方案列表（id + 名称） */
    presets: store.presets.map((item) => ({ id: item.id, name: item.name })),
    activePresetId: store.activePresetId,
    createPreset,
    switchPreset,
    renamePreset,
    deletePreset,
    importSharedLayout,
  };
}
