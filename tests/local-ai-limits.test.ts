import { describe, expect, it } from "vitest";
import * as localAILimits from "../electron/local-ai-limits";
import * as localAI from "../src/lib/local-ai";

describe("local AI limits cross-layer consistency", () => {
  it("electron 侧与渲染层的本地 AI 上限常量逐一同名同值", () => {
    expect(localAILimits.LOCAL_AI_MAX_EDGE).toBe(localAI.LOCAL_AI_MAX_EDGE);
    expect(localAILimits.LOCAL_AI_MAX_PIXELS).toBe(localAI.LOCAL_AI_MAX_PIXELS);
  });

  it("两端常量与既定的 8192 / 7000 万像素字面值一致", () => {
    expect(localAILimits.LOCAL_AI_MAX_EDGE).toBe(8192);
    expect(localAILimits.LOCAL_AI_MAX_PIXELS).toBe(70_000_000);
    expect(localAI.LOCAL_AI_MAX_EDGE).toBe(8192);
    expect(localAI.LOCAL_AI_MAX_PIXELS).toBe(70_000_000);
  });

  it("validateUpscaleOutput 在恰好等于最长边上限时通过、超过时返回 ok:false", () => {
    // 2048×1024 的 4× 输出为 8192×4096：最长边恰好等于 LOCAL_AI_MAX_EDGE，应通过
    expect(localAI.validateUpscaleOutput(2048, 1024, 4)).toMatchObject({ ok: true });
    // 2049×1024 的 4× 输出最长边 8196 > 8192，应被拒绝且带上错误信息
    expect(localAI.validateUpscaleOutput(2049, 1024, 4)).toMatchObject({ ok: false });
  });
});
