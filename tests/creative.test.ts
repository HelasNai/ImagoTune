import { describe, expect, it } from "vitest";
import {
  applyLocalPromptAction,
  createRecipe,
  outpaintQuickRatios,
  parseTags,
  ratioOptions,
  resolutionLevels,
  sizeMatrix,
  validateCanvasSize,
} from "../src/lib/creative";
import { normalizeImageBase64, prioritizeImageResponses } from "../electron/image-response";

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
