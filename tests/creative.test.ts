import { afterEach, describe, expect, it } from "vitest";
import {
  applyLocalPromptAction,
  createRecipe,
  outpaintQuickRatios,
  parseTags,
  ratioOptions,
  resolutionLevels,
  resolutionOptions,
  sizeMatrix,
  validateCanvasSize,
  variationOptions,
} from "../src/lib/creative";
import { setLocale } from "../src/lib/i18n";
import { normalizeImageBase64, prioritizeImageResponses } from "../electron/image-response";

// i18n 模块级单例在测试间共享：每例结束复位中文，避免 en 用例污染后续/默认断言。
afterEach(() => setLocale("zh"));

describe("creative helpers", () => {
  it("applies local prompt enhancement without an API call", () => {
    const result = applyLocalPromptAction("蓝色产品", "poster");
    expect(result).toContain("蓝色产品");
    expect(result).toContain("商业海报");
  });

  it("validates safe custom canvas sizes", () => {
    expect(validateCanvasSize("1536x1024").ok).toBe(true);
    expect(validateCanvasSize("3840x3840").ok).toBe(true);
    expect(validateCanvasSize("1000x1000").ok).toBe(false);
    expect(validateCanvasSize("4096x4096").ok).toBe(false);
    expect(validateCanvasSize("1600x512").ok).toBe(false);
  });

  it("normalizes comma and Chinese comma separated tags", () => {
    expect(parseTags("海报, 蓝粉，海报\n科技")).toEqual(["海报", "蓝粉", "科技"]);
  });

  it("prefers final Base64 results over progress URLs", () => {
    const selected = prioritizeImageResponses([
      { url: "https://cdn.example/progress.png" },
      { b64_json: "data:image/png;base64,final-image", seed: 12 },
    ], 1);
    expect(selected).toEqual([{ b64_json: "data:image/png;base64,final-image", seed: 12 }]);
    expect(normalizeImageBase64(selected[0].b64_json!)).toBe("final-image");
    expect(prioritizeImageResponses([{ url: "https://cdn.example/final.png" }], 1))
      .toEqual([{ url: "https://cdn.example/final.png" }]);
  });
});

describe("createRecipe defaults and clamps", () => {
  it("clamps n to 1..4", () => {
    expect(createRecipe({ n: 10 }).n).toBe(4);
    expect(createRecipe({ n: 0 }).n).toBe(1);
    expect(createRecipe({ n: -3 }).n).toBe(1);
    expect(createRecipe({ n: 2 }).n).toBe(2);
  });

  it("caps tags at 20 and keeps the first ones", () => {
    const tags = Array.from({ length: 25 }, (_, index) => `标签${index}`);
    const recipe = createRecipe({ tags });
    expect(recipe.tags).toHaveLength(20);
    expect(recipe.tags).toEqual(tags.slice(0, 20));
    expect(createRecipe({ tags: Array(25) }).tags).toHaveLength(20);
  });

  it("clamps referenceCount to at most 3", () => {
    expect(createRecipe({ referenceCount: 9 }).referenceCount).toBe(3);
    expect(createRecipe({ referenceCount: 2 }).referenceCount).toBe(2);
    expect(createRecipe({ referenceCount: 0 }).referenceCount).toBeUndefined();
    expect(createRecipe({}).referenceCount).toBeUndefined();
  });

  it("fills unified defaults (version 1 / inbox / ISO createdAt / default model)", () => {
    const recipe = createRecipe({});
    expect(recipe.version).toBe(1);
    expect(recipe.projectId).toBe("inbox");
    expect(recipe.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(recipe.createdAt).toISOString()).toBe(recipe.createdAt);
    expect(recipe.model).toBe("gpt-image-2");
    expect(recipe.n).toBe(1);
    expect(recipe.tags).toEqual([]);
    expect(recipe.mode).toBe("generate");
  });

  it("keeps caller-provided values and recipe fields", () => {
    const recipe = createRecipe({
      prompt: "蓝色产品",
      negativePrompt: "水印",
      model: "gpt-image-1",
      size: "1024x1024",
      mode: "edit",
      projectId: "project-a",
      tags: ["海报"],
      referenceCount: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(recipe.prompt).toBe("蓝色产品");
    expect(recipe.negativePrompt).toBe("水印");
    expect(recipe.model).toBe("gpt-image-1");
    expect(recipe.size).toBe("1024x1024");
    expect(recipe.mode).toBe("edit");
    expect(recipe.projectId).toBe("project-a");
    expect(recipe.tags).toEqual(["海报"]);
    expect(recipe.referenceCount).toBe(2);
    expect(recipe.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("size and ratio presets", () => {
  it("renders the outpaint quick ratios as the explicit 4-item subset", () => {
    expect(outpaintQuickRatios).toEqual(["1:1", "4:5", "16:9", "9:16"]);
  });

  it("renders the gallery resolution filter as 1k/2k/4k", () => {
    expect(resolutionLevels).toEqual(["1k", "2k", "4k"]);
  });

  it("keeps sizeMatrix keys consistent with ratioOptions and resolutionLevels", () => {
    const ratioValues = ratioOptions.map((item) => item.value).sort();
    expect(Object.keys(sizeMatrix).sort()).toEqual([...resolutionLevels].sort());
    for (const level of resolutionLevels) {
      expect(Object.keys(sizeMatrix[level]).sort()).toEqual(ratioValues);
    }
  });
});

describe("creative options i18n (en)", () => {
  it("清晰度 / 比例 / 变体 label 在 en 下为英文（value / id / suffix 不变）", () => {
    setLocale("en");
    expect(resolutionOptions.find((item) => item.value === "1k")!.label).toBe("1K (Standard)");
    expect(resolutionOptions.find((item) => item.value === "4k")!.label).toBe("4K (Ultra HD)");
    expect(ratioOptions.find((item) => item.value === "1:1")!.label).toBe("1:1 Square");
    expect(ratioOptions.find((item) => item.value === "21:9")!.label).toBe("21:9 Ultra-wide");
    const premium = variationOptions.find((item) => item.id === "premium")!;
    expect(premium.label).toBe("More premium");
    // suffix 是模型输入，语言无关（保持中文原文）。
    expect(premium.suffix).toBe("版本方向：提升高级感、统一性与材质质感，保持原主题。");
  });

  it("validateCanvasSize 校验消息在 en 下为英文（成功消息模板插值）", () => {
    setLocale("en");
    expect(validateCanvasSize("abc")).toMatchObject({ ok: false, message: "Enter width x height, e.g. 1536x1024" });
    expect(validateCanvasSize("1000x1000")).toMatchObject({ ok: false, message: "Width and height must be multiples of 16" });
    expect(validateCanvasSize("4096x4096")).toMatchObject({ ok: false, message: "The longest edge cannot exceed 3840 px" });
    expect(validateCanvasSize("1536x1024")).toMatchObject({ ok: true, message: "1536 × 1024, about 1.57 MP" });
  });
});
