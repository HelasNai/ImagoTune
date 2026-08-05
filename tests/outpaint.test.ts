import { describe, expect, it } from "vitest";
import { buildOutpaintMaskAlpha, outpaintFromPercent, outpaintToSize, targetSizeForRatio } from "../src/lib/outpaint";

describe("outpaint geometry", () => {
  it("creates a larger centered target without cropping", () => {
    const result = outpaintToSize(1024, 1024, "1024x1280");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout).toMatchObject({ top: 128, bottom: 128, left: 0, right: 0 });
    const alpha = buildOutpaintMaskAlpha(result.layout);
    expect(alpha[0]).toBe(0);
    expect(alpha[result.layout.y * result.layout.targetWidth]).toBe(255);
  });

  it("supports directional percentages, ratio presets and blocks shrinking", () => {
    const directional = outpaintFromPercent(1024, 1024, { top: 0, right: 50, bottom: 0, left: 0 });
    expect(directional.ok && directional.layout.targetSize).toBe("1536x1024");
    expect(targetSizeForRatio(1024, 1024, "9:16")).toBe("1024x1824");
    expect(outpaintToSize(1024, 1024, "768x1024").ok).toBe(false);
  });
});

