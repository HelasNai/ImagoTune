import { describe, expect, it } from "vitest";
import * as electronConstants from "../electron/constants";
import * as rendererConstants from "../src/lib/constants";

describe("constants cross-layer consistency", () => {
  it("electron 侧与渲染层的 inbox 与默认模型常量逐一同名同值", () => {
    expect(rendererConstants.INBOX_PROJECT_ID).toBe(electronConstants.INBOX_PROJECT_ID);
    expect(rendererConstants.DEFAULT_IMAGE_MODEL).toBe(electronConstants.DEFAULT_IMAGE_MODEL);
    expect(rendererConstants.DEFAULT_CHAT_MODEL).toBe(electronConstants.DEFAULT_CHAT_MODEL);
  });

  it("两端常量与既定的字面值一致", () => {
    expect(electronConstants.INBOX_PROJECT_ID).toBe("inbox");
    expect(electronConstants.DEFAULT_IMAGE_MODEL).toBe("gpt-image-2");
    expect(electronConstants.DEFAULT_CHAT_MODEL).toBe("gpt-4o");
    expect(rendererConstants.INBOX_PROJECT_ID).toBe("inbox");
    expect(rendererConstants.DEFAULT_IMAGE_MODEL).toBe("gpt-image-2");
    expect(rendererConstants.DEFAULT_CHAT_MODEL).toBe("gpt-4o");
  });
});
