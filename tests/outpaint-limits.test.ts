import { describe, expect, it } from "vitest";
import * as creative from "../src/lib/creative";
import * as outpaintLimits from "../electron/outpaint-limits";

describe("canvas limits cross-layer consistency", () => {
  it("electron 侧与渲染层的画布上限常量逐一同名同值", () => {
    expect(outpaintLimits.CANVAS_MULTIPLE).toBe(creative.CANVAS_MULTIPLE);
    expect(outpaintLimits.CANVAS_MAX_EDGE).toBe(creative.CANVAS_MAX_EDGE);
    expect(outpaintLimits.CANVAS_MAX_PIXELS).toBe(creative.CANVAS_MAX_PIXELS);
  });

  it("两端常量与扩图安全范围的既定字面值一致", () => {
    expect(outpaintLimits.CANVAS_MULTIPLE).toBe(16);
    expect(outpaintLimits.CANVAS_MAX_EDGE).toBe(3840);
    expect(outpaintLimits.CANVAS_MAX_PIXELS).toBe(14_745_600);
    expect(creative.CANVAS_MULTIPLE).toBe(16);
    expect(creative.CANVAS_MAX_EDGE).toBe(3840);
    expect(creative.CANVAS_MAX_PIXELS).toBe(14_745_600);
  });
});
