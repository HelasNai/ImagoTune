import { describe, expect, it } from "vitest";
import { b64FromDataUrl, b64ToDataUrl, dataUrlFor } from "../src/lib/media";

describe("media data url helpers", () => {
  it("b64ToDataUrl 默认拼成 image/png data URL", () => {
    expect(b64ToDataUrl("AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("b64ToDataUrl 支持显式 image/jpeg MIME（不得依赖 PNG 默认值）", () => {
    expect(b64ToDataUrl("BBBB", "image/jpeg")).toBe("data:image/jpeg;base64,BBBB");
    expect(b64ToDataUrl("BBBB", "image/jpeg")).not.toBe(b64ToDataUrl("BBBB"));
  });

  it("b64FromDataUrl 去除 png / jpeg / svg+xml 前缀且大小写不敏感", () => {
    expect(b64FromDataUrl("data:image/png;base64,QUJD")).toBe("QUJD");
    expect(b64FromDataUrl("data:image/jpeg;base64,QUJD")).toBe("QUJD");
    expect(b64FromDataUrl("data:image/svg+xml;base64,QUJD")).toBe("QUJD");
    expect(b64FromDataUrl("DATA:IMAGE/PNG;base64,QUJD")).toBe("QUJD");
  });

  it("b64FromDataUrl 对无前缀 / 非法输入原样返回", () => {
    expect(b64FromDataUrl("QUJD")).toBe("QUJD");
    expect(b64FromDataUrl("")).toBe("");
    expect(b64FromDataUrl("data:text/plain;base64,QUJD")).toBe("data:text/plain;base64,QUJD");
    expect(b64FromDataUrl("data:image/png;base64")).toBe("data:image/png;base64");
  });

  it("b64ToDataUrl 与 b64FromDataUrl 可往返还原", () => {
    const b64 = "aGVsbG8=";
    expect(b64FromDataUrl(b64ToDataUrl(b64))).toBe(b64);
    expect(b64FromDataUrl(b64ToDataUrl(b64, "image/jpeg"))).toBe(b64);
  });

  it("dataUrlFor 等价于默认 PNG 拼接", () => {
    expect(dataUrlFor({ b64: "QUJD" })).toBe("data:image/png;base64,QUJD");
  });
});
