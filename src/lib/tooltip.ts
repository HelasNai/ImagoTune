// 悬浮提示定位纯逻辑：只做几何计算，不依赖 React / DOM。
// 供 src/components/Tooltip.tsx 在测量气泡后计算 fixed 定位；
// 与 src/lib/format.ts 同风格：双引号、分号、相对导入、无第三方依赖。

/** 触发器 / 气泡都可用的一维矩形（视口坐标系）。 */
export interface TooltipRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** resolveTooltipLayout 的输入。 */
export interface TooltipLayoutInput {
  /** 触发器视口矩形。 */
  trigger: TooltipRect;
  /** 气泡实测尺寸。 */
  bubble: { width: number; height: number };
  /** 视口尺寸（window.innerWidth / innerHeight）。 */
  viewport: { width: number; height: number };
  /** 触发器与气泡的间距；默认 8。 */
  gap?: number;
  /** 与视口边缘的安全边距；默认 8。 */
  margin?: number;
}

/** 计算出的 fixed 定位（top / left 为视口坐标）。 */
export interface TooltipLayout {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

/**
 * 计算气泡位置：默认置于触发器上方居中；上方放不下则翻转下方；
 * 两侧都放不下时取空间更大的一侧，并沿两个轴钳入视口（保留 margin）。
 * 返回的 top / left 永不为负（下界为 margin）。
 */
export function resolveTooltipLayout(input: TooltipLayoutInput): TooltipLayout {
  const gap = input.gap ?? 8;
  const margin = input.margin ?? 8;
  const { trigger, bubble, viewport } = input;

  const topSpace = trigger.top - gap - margin;
  const bottomSpace = viewport.height - (trigger.top + trigger.height) - gap - margin;

  let placement: "top" | "bottom";
  if (bubble.height <= topSpace) placement = "top";
  else if (bubble.height <= bottomSpace) placement = "bottom";
  else placement = topSpace >= bottomSpace ? "top" : "bottom";

  const rawTop =
    placement === "top" ? trigger.top - gap - bubble.height : trigger.top + trigger.height + gap;
  const maxTop = viewport.height - margin - bubble.height;
  const top = Math.max(margin, Math.min(rawTop, maxTop));

  const rawLeft = trigger.left + trigger.width / 2 - bubble.width / 2;
  const maxLeft = viewport.width - margin - bubble.width;
  const left = Math.max(margin, Math.min(rawLeft, maxLeft));

  return { top, left, placement };
}
