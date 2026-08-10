import { describe, expect, it } from "vitest";
import { embedRecipeInPng, readRecipeFromPng } from "../electron/png-metadata";
import { normalizeRecipe } from "../electron/image-recipe";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("PNG recipe metadata", () => {
  it("round trips UTF-8 prompts without changing image chunks", () => {
    const recipe = normalizeRecipe({ recipe: { prompt: "蓝粉色产品海报", negativePrompt: "水印、乱码", size: "1024x1024", seed: "9988" } });
    const output = embedRecipeInPng(onePixelPng, recipe);
    expect(output.length).toBeGreaterThan(onePixelPng.length);
    expect(output.includes(Buffer.from("image-studio.recipe"))).toBe(true);
    expect(readRecipeFromPng(output)).toMatchObject({ prompt: "蓝粉色产品海报", negativePrompt: "水印、乱码", seed: "9988" });
  });
});
