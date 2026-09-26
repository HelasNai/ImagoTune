import { describe, expect, it } from "vitest";
import { embedRecipeInPng, readRecipeFromPng } from "../electron/png-metadata";
import { normalizeRecipe } from "../electron/image-recipe";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("PNG recipe metadata", () => {
  it("round trips UTF-8 prompts without changing image chunks", () => {
    const recipe = normalizeRecipe({ recipe: {
      prompt: "蓝粉色产品海报",
      negativePrompt: "水印、乱码",
      size: "1024x1024",
      seed: "9988",
      postProcessing: [{
        tool: "upscale",
        modelId: "realesrgan-x2",
        modelVersion: "test-version",
        parameters: { scale: 2 },
        device: "wasm",
        elapsedMs: 1200,
        createdAt: "2026-08-12T00:00:00.000Z",
      }],
    } });
    const output = embedRecipeInPng(onePixelPng, recipe);
    expect(output.length).toBeGreaterThan(onePixelPng.length);
    expect(output.includes(Buffer.from("image-studio.recipe"))).toBe(true);
    expect(readRecipeFromPng(output)).toMatchObject({
      prompt: "蓝粉色产品海报",
      negativePrompt: "水印、乱码",
      seed: "9988",
      postProcessing: [{ tool: "upscale", modelId: "realesrgan-x2", device: "wasm" }],
    });
  });

  it("写入的 iTXt 块 CRC 字段等于 golden 值", () => {
    const recipe = normalizeRecipe({ recipe: {
      prompt: "蓝粉色产品海报",
      negativePrompt: "水印、乱码",
      size: "1024x1024",
      seed: "9988",
      // 固定 createdAt：normalizeRecipe 缺省回填当前时间戳，golden CRC 需要确定性输入
      createdAt: "2026-08-12T00:00:00.000Z",
      postProcessing: [{
        tool: "upscale",
        modelId: "realesrgan-x2",
        modelVersion: "test-version",
        parameters: { scale: 2 },
        device: "wasm",
        elapsedMs: 1200,
        createdAt: "2026-08-12T00:00:00.000Z",
      }],
    } });
    const output = embedRecipeInPng(onePixelPng, recipe);
    // golden 值 413849985 (0x18AAD981) 来源：对手写实现产出的 iTXt 块 type+data，
    // 经三套独立 CRC-32 实现交叉验证一致——node:zlib.crc32（先用标准向量
    // CRC-32("123456789")=0xCBF43926 校验其为标准 CRC-32）、Python zlib.crc32、
    // 以及改造前的手写查表实现自身。readRecipeFromPng 不校验 CRC，
    // 故此 golden 断言是 CRC 字段的唯一回归守卫。
    const GOLDEN_ITXT_CRC = 413849985;
    let storedCrc: number | undefined;
    let offset = 8;
    while (offset + 12 <= output.length) {
      const length = output.readUInt32BE(offset);
      const type = output.toString("ascii", offset + 4, offset + 8);
      if (type === "iTXt") {
        storedCrc = output.readUInt32BE(offset + 8 + length);
        break;
      }
      offset += 12 + length;
    }
    expect(storedCrc).toBe(GOLDEN_ITXT_CRC);
  });
});
