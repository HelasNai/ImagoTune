import { describe, expect, it } from "vitest";
import { presetToProviderDraft } from "../src/lib/provider-preset";

// K1 契约的内联 fixture（测试不得 import electron/；形状与 tests/provider-presets.test.ts 锁定的一致）。
const HUNYUAN: ProviderPreset = {
  id: "hunyuan",
  label: "腾讯混元",
  baseUrl: "https://tokenhub.tencentmaas.com/v1",
  api: "hunyuan-image",
  presetModels: [{ id: "hy-image-v3.5-preview", roles: ["image"] }],
  keyHelp: "在腾讯云控制台 → TokenHub → API Key 创建",
};

describe("presetToProviderDraft", () => {
  it("字段精确映射：id 用传入值，name=label，baseUrl/api/models 原样带入", () => {
    const draft = presetToProviderDraft(HUNYUAN, "p-new", "sk-abc");
    expect(draft).toEqual({
      id: "p-new",
      name: "腾讯混元",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      api: "hunyuan-image",
      models: [{ id: "hy-image-v3.5-preview", roles: ["image"] }],
      apiKey: "sk-abc",
    });
    expect(draft.api).toBe("hunyuan-image");
  });

  it("apiKey 为真实密钥时去除首尾空白后保留", () => {
    const draft = presetToProviderDraft(HUNYUAN, "p1", "  sk-abc  ");
    expect(draft.apiKey).toBe("sk-abc");
  });

  it("空串 / 纯空白 / undefined 时完全不产生 apiKey 键", () => {
    for (const key of ["", "   ", "\t\n", undefined]) {
      const draft = presetToProviderDraft(HUNYUAN, "p1", key);
      expect("apiKey" in draft).toBe(false);
    }
  });

  it("预置模型深拷贝：改写草稿的 models 与 roles 不污染输入预设", () => {
    const draft = presetToProviderDraft(HUNYUAN, "p1");
    expect(draft.models[0]).not.toBe(HUNYUAN.presetModels[0]);
    expect(draft.models[0].roles).not.toBe(HUNYUAN.presetModels[0].roles);
    draft.models[0].roles.push("enhance");
    draft.models[0].id = "renamed";
    draft.models.push({ id: "extra", roles: [] });
    expect(HUNYUAN.presetModels).toEqual([{ id: "hy-image-v3.5-preview", roles: ["image"] }]);
  });

  it("两次调用互不影响：各自的 models 为独立副本", () => {
    const first = presetToProviderDraft(HUNYUAN, "p1");
    const second = presetToProviderDraft(HUNYUAN, "p2");
    first.models[0].roles.push("reverse");
    expect(second.models[0].roles).toEqual(["image"]);
    expect(HUNYUAN.presetModels[0].roles).toEqual(["image"]);
  });
});
