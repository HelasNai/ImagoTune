import { describe, expect, it } from "vitest";
import { isVisionInputUnsupported, parseReversePrompt } from "../electron/reverse-prompt";

describe("reverse prompt helpers", () => {
  it("parses JSON and labeled bilingual responses", () => {
    expect(parseReversePrompt("```json\n{\"zh\":\"蓝色海报\",\"en\":\"blue poster\"}\n```")).toEqual({ zh: "蓝色海报", en: "blue poster" });
    expect(parseReversePrompt("中文：产品摄影\n英文：product photography")).toEqual({ zh: "产品摄影", en: "product photography" });
  });

  it("recognizes unsupported vision input responses", () => {
    expect(isVisionInputUnsupported("image_url is not supported by this model")).toBe(true);
    expect(isVisionInputUnsupported("temporary gateway error")).toBe(false);
  });
});

