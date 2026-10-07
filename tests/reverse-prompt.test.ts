import { describe, expect, it } from "vitest";
import { isVisionInputUnsupported, parseReversePrompt, reverseContentError } from "../electron/reverse-prompt";

describe("reverse prompt helpers", () => {
  it("parses JSON and labeled bilingual responses", () => {
    expect(parseReversePrompt("```json\n{\"zh\":\"蓝色海报\",\"en\":\"blue poster\"}\n```")).toEqual({ zh: "蓝色海报", en: "blue poster" });
    expect(parseReversePrompt("中文：产品摄影\n英文：product photography")).toEqual({ zh: "产品摄影", en: "product photography" });
  });

  it("recognizes unsupported vision input responses", () => {
    expect(isVisionInputUnsupported("image_url is not supported by this model")).toBe(true);
    expect(isVisionInputUnsupported("temporary gateway error")).toBe(false);
  });

  it("maps truncated or empty reverse responses to actionable errors", () => {
    expect(reverseContentError("length")).toContain("截断");
    expect(reverseContentError("stop")).toBe("图反推没有返回提示词");
    expect(reverseContentError(undefined)).toBe("图反推没有返回提示词");
  });
});

