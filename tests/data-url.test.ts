import { describe, expect, it } from "vitest";
import { stripDataUrlPrefix } from "../electron/data-url";
import { b64FromDataUrl } from "../src/lib/media";

// 两端（electron / renderer）必须对同一 data URL 样本给出完全相同的结果。
const identicalSamples: ReadonlyArray<readonly [string, string]> = [
  ["data:image/png;base64,QUJD", "QUJD"],
  ["data:image/jpeg;base64,QUJD", "QUJD"],
  ["data:image/svg+xml;base64,QUJD", "QUJD"],
  ["DATA:IMAGE/PNG;base64,QUJD", "QUJD"],
  // 无前缀 / 非法输入：原样返回
  ["QUJD", "QUJD"],
  ["", ""],
  ["data:text/plain;base64,QUJD", "data:text/plain;base64,QUJD"],
  ["data:image/png;base64", "data:image/png;base64"],
];

describe("data-url prefix handling consistency", () => {
  it("electron stripDataUrlPrefix 与 renderer b64FromDataUrl 对全部样本结果一致", () => {
    for (const [input, expected] of identicalSamples) {
      expect(stripDataUrlPrefix(input), `electron: ${input}`).toBe(expected);
      expect(b64FromDataUrl(input), `renderer: ${input}`).toBe(expected);
      expect(stripDataUrlPrefix(input), `cross-layer: ${input}`).toBe(b64FromDataUrl(input));
    }
  });

  it("已声明的行为拓宽：svg+xml 与大写 MIME 由不识别变为识别", () => {
    // svg+xml：旧 `\w+` 正则匹配不到，超集 `[^;]+` 可以。
    const svg = "data:image/svg+xml;base64,QUJD";
    expect(svg.replace(/^data:image\/\w+;base64,/, "")).not.toBe("QUJD");
    expect(stripDataUrlPrefix(svg)).toBe("QUJD");
    expect(b64FromDataUrl(svg)).toBe("QUJD");
    // 大写 MIME：旧正则大小写敏感无法匹配，新正则 `/i` 可匹配。
    const upper = "DATA:IMAGE/PNG;base64,QUJD";
    expect(upper.replace(/^data:image\/\w+;base64,/, "")).not.toBe("QUJD");
    expect(stripDataUrlPrefix(upper)).toBe("QUJD");
    expect(b64FromDataUrl(upper)).toBe("QUJD");
  });

  it("当前已识别输入的剥离结果保持不变（png / jpeg 字节一致）", () => {
    const png = "data:image/png;base64,AQIDBA==";
    const jpeg = "data:image/jpeg;base64,AQIDBA==";
    expect(stripDataUrlPrefix(png)).toBe(png.replace(/^data:image\/\w+;base64,/, ""));
    expect(stripDataUrlPrefix(jpeg)).toBe(jpeg.replace(/^data:image\/\w+;base64,/, ""));
    expect(stripDataUrlPrefix(png)).toBe("AQIDBA==");
    expect(stripDataUrlPrefix(jpeg)).toBe("AQIDBA==");
  });
});
