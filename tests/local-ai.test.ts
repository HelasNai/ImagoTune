import { describe, expect, it } from "vitest";
import {
  boxBlurMask,
  chooseTileSize,
  nms,
  resizeAlphaBilinear,
  solveAffine,
  tileOrigins,
  validateUpscaleOutput,
} from "../src/lib/local-ai";

describe("local AI image helpers", () => {
  it("validates 2x and 4x output dimensions and hard limits", () => {
    expect(validateUpscaleOutput(1024, 768, 2)).toEqual({ ok: true, width: 2048, height: 1536 });
    expect(validateUpscaleOutput(1024, 768, 4)).toEqual({ ok: true, width: 4096, height: 3072 });
    expect(validateUpscaleOutput(3000, 1000, 4)).toMatchObject({ ok: false });
    expect(validateUpscaleOutput(8000, 5000, 2)).toMatchObject({ ok: false });
  });

  it("covers a dimension with deterministic non-overlapping tile origins", () => {
    expect(tileOrigins(513, 256)).toEqual([0, 256, 512]);
    expect(chooseTileSize("webgpu", 1024, 1024)).toBe(256);
    expect(chooseTileSize("wasm", 3000, 1000)).toBe(64);
  });

  it("resizes the original alpha channel without changing endpoints", () => {
    const rgba = new Uint8ClampedArray([
      10, 20, 30, 0,
      40, 50, 60, 255,
    ]);
    const alpha = resizeAlphaBilinear(rgba, 2, 1, 4, 1);
    expect(alpha[0]).toBe(0);
    expect(alpha[3]).toBe(255);
    expect(alpha[1]).toBeGreaterThan(0);
    expect(alpha[2]).toBeLessThan(255);
  });

  it("feathers masks and suppresses overlapping face detections", () => {
    const blurred = boxBlurMask(new Float32Array([0, 0, 1, 0, 0]), 5, 1, 1);
    expect(blurred[2]).toBeCloseTo(1 / 3);
    expect(blurred[1]).toBeCloseTo(1 / 3);
    const selected = nms([
      { box: [0, 0, 100, 100] as [number, number, number, number], score: .9, id: "best" },
      { box: [5, 5, 100, 100] as [number, number, number, number], score: .8, id: "duplicate" },
      { box: [200, 200, 50, 50] as [number, number, number, number], score: .7, id: "other" },
    ]);
    expect(selected.map((value) => value.id)).toEqual(["best", "other"]);
  });

  it("solves a known affine face alignment transform", () => {
    const source: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [2, 1], [1, 2]];
    const target = source.map(([x, y]) => [2 * x + 3 * y + 5, -x + 4 * y + 7] as [number, number]);
    const matrix = solveAffine(source, target);
    expect(matrix).toEqual(expect.arrayContaining(matrix.map((value, index) => expect.closeTo([2, 3, 5, -1, 4, 7][index], 8))));
  });
});
