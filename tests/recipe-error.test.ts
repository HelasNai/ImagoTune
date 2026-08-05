import { describe, expect, it } from "vitest";
import { composeImagePrompt, normalizeRecipe } from "../electron/image-recipe";
import { classifyHttpError, classifyRuntimeError } from "../electron/generation-error";

describe("recipe and error classification", () => {
  it("keeps positive and negative prompts separate and composes constraints once", () => {
    const recipe = normalizeRecipe({ recipe: { prompt: "蓝色产品海报", negativePrompt: "水印、乱码", size: "1024x1024", ratio: "1:1" } });
    const result = composeImagePrompt(recipe);
    expect(result).toContain("蓝色产品海报");
    expect(result.match(/必须避免以下内容或缺陷/g)).toHaveLength(1);
    expect(recipe.prompt).toBe("蓝色产品海报");
    expect(recipe.negativePrompt).toBe("水印、乱码");
  });

  it("classifies balance, content, rate limit and network failures", () => {
    expect(classifyHttpError(402, "insufficient balance").category).toBe("balance");
    expect(classifyHttpError(400, "content policy blocked").category).toBe("content");
    expect(classifyHttpError(429, "too many requests").category).toBe("rate_limit");
    expect(classifyRuntimeError(new TypeError("fetch failed")).category).toBe("network");
    expect(classifyHttpError(400, "quality is not supported").title).toBe("清晰度参数不兼容");
  });
});
