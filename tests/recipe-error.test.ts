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

  it("preserves reference image metadata and adds the reference constraint once", () => {
    const recipe = normalizeRecipe({ recipe: { prompt: "高级产品海报", referenceCount: 2 } });
    const result = composeImagePrompt(recipe);
    expect(recipe.referenceCount).toBe(2);
    expect(result).toContain("已提供 2 张参考图");
    expect(result.match(/参考图使用要求/g)).toHaveLength(1);
  });

  it("classifies balance, content, rate limit and network failures", () => {
    expect(classifyHttpError(402, "insufficient balance").category).toBe("balance");
    expect(classifyHttpError(400, "content policy blocked").category).toBe("content");
    expect(classifyHttpError(429, "too many requests").category).toBe("rate_limit");
    expect(classifyRuntimeError(new TypeError("fetch failed")).category).toBe("network");
    expect(classifyRuntimeError(new Error("图片链接下载失败（403）")).title).toBe("图片结果转存失败");
    expect(classifyHttpError(400, "quality is not supported").title).toBe("清晰度参数不兼容");
  });
});
