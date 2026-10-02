import { describe, expect, it } from "vitest";
import { resolveTooltipLayout } from "../src/lib/tooltip";

const viewport = { width: 1000, height: 800 };

describe("resolveTooltipLayout", () => {
  it("上方空间足够时置于上方（默认 gap 8）", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 400, left: 400, width: 100, height: 40 },
      bubble: { width: 120, height: 80 },
      viewport,
    });
    expect(result.placement).toBe("top");
    expect(result.top).toBe(312);
  });

  it("上方不足但下方足够时翻转到下方", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 20, left: 100, width: 80, height: 30 },
      bubble: { width: 120, height: 80 },
      viewport,
    });
    expect(result.placement).toBe("bottom");
    expect(result.top).toBe(58);
  });

  it("上下都不足时取空间更大的一侧并钳入视口", () => {
    const vp = { width: 1000, height: 300 };
    const result = resolveTooltipLayout({
      trigger: { top: 100, left: 400, width: 100, height: 40 },
      bubble: { width: 120, height: 280 },
      viewport: vp,
    });
    expect(result.placement).toBe("bottom");
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.top).toBeLessThanOrEqual(vp.height - 8 - 280);
    expect(result.top).toBe(12);
  });

  it("水平默认以触发器中心居中", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 400, left: 400, width: 100, height: 40 },
      bubble: { width: 120, height: 80 },
      viewport,
    });
    expect(result.left).toBe(400 + 100 / 2 - 120 / 2);
  });

  it("左缘溢出时钳到 margin", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 400, left: 0, width: 20, height: 40 },
      bubble: { width: 120, height: 80 },
      viewport,
    });
    expect(result.left).toBe(8);
  });

  it("右缘溢出时钳到 viewport.width - margin - width", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 400, left: 480, width: 20, height: 40 },
      bubble: { width: 120, height: 80 },
      viewport: { width: 500, height: 800 },
    });
    expect(result.left).toBe(500 - 8 - 120);
  });

  it("视口小于气泡时不返回负数（钳到边距）", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 40, left: 40, width: 20, height: 20 },
      bubble: { width: 200, height: 200 },
      viewport: { width: 100, height: 100 },
    });
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.top).toBe(8);
    expect(result.left).toBe(8);
  });

  it("自定义 gap / margin 生效", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 400, left: 400, width: 100, height: 40 },
      bubble: { width: 100, height: 60 },
      viewport,
      gap: 20,
      margin: 30,
    });
    expect(result.placement).toBe("top");
    expect(result.top).toBe(400 - 20 - 60);
  });

  it("恰好放得下（bubble.height === topSpace）仍算上方", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 108, left: 300, width: 100, height: 40 },
      bubble: { width: 120, height: 92 },
      viewport,
    });
    expect(result.placement).toBe("top");
    expect(result.top).toBe(108 - 8 - 92);
  });

  it("贴近顶部的高触发器 + 高气泡被钳入视口内", () => {
    const result = resolveTooltipLayout({
      trigger: { top: 0, left: 300, width: 100, height: 500 },
      bubble: { width: 120, height: 300 },
      viewport,
    });
    expect(result.placement).toBe("bottom");
    expect(result.top).toBe(800 - 8 - 300);
    expect(result.top + 300).toBeLessThanOrEqual(800 - 8);
  });
});
