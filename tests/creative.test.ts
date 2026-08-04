import { describe, expect, it } from "vitest";
import {
  applyLocalPromptAction,
  parseTags,
  validateCanvasSize,
} from "../src/lib/creative";

describe("creative helpers", () => {
  it("applies local prompt enhancement without an API call", () => {
    const result = applyLocalPromptAction("蓝色产品", "poster");
    expect(result).toContain("蓝色产品");
    expect(result).toContain("商业海报");
  });

  it("validates safe custom canvas sizes", () => {
    expect(validateCanvasSize("1536x1024").ok).toBe(true);
    expect(validateCanvasSize("1000x1000").ok).toBe(false);
    expect(validateCanvasSize("4096x4096").ok).toBe(false);
    expect(validateCanvasSize("1600x512").ok).toBe(false);
  });

  it("normalizes comma and Chinese comma separated tags", () => {
    expect(parseTags("海报, 蓝粉，海报\n科技")).toEqual(["海报", "蓝粉", "科技"]);
  });
});
