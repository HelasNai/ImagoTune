import { describe, expect, it } from "vitest";
import { maximizeAriaLabel, maximizeIconName } from "../src/lib/window-controls";

describe("window control helpers", () => {
  it("展示还原图标当窗口已最大化", () => {
    expect(maximizeIconName(true)).toBe("copy");
  });

  it("展示方框图标当窗口未最大化", () => {
    expect(maximizeIconName(false)).toBe("square");
  });

  it("提供还原窗口无障碍标签当窗口已最大化", () => {
    expect(maximizeAriaLabel(true)).toBe("还原窗口");
  });

  it("提供最大化窗口无障碍标签当窗口未最大化", () => {
    expect(maximizeAriaLabel(false)).toBe("最大化窗口");
  });
});
