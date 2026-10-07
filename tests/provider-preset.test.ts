import { afterEach, describe, expect, it } from "vitest";
import { presetKeyHelp, presetToProviderDraft } from "../src/lib/provider-preset";
import { setLocale } from "../src/lib/i18n";

// i18n 单例在用例间共享：每个用例后复位为默认中文。
afterEach(() => setLocale("zh"));

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

describe("presetKeyHelp", () => {
  it("zh 下命中映射：直通中文原文（t 的 zh 分支）", () => {
    expect(presetKeyHelp("hunyuan", "回退原文")).toBe("在腾讯云控制台 → TokenHub → API Key 创建");
  });

  it("en 下命中 en/settings.ts 译文并插值无占位符", () => {
    setLocale("en");
    expect(presetKeyHelp("hunyuan", "回退原文")).toBe(
      "Create an API key at Tencent Cloud Console → TokenHub → API Key",
    );
  });

  it("国际站条目（*-intl）全部命中 en 译文（映射与词典同步锁定）", () => {
    setLocale("en");
    expect(presetKeyHelp("hunyuan-intl", "回退")).toBe(
      "Create an API key in the Tencent Cloud International console → TokenHub → API Key",
    );
    expect(presetKeyHelp("zhipu-intl", "回退")).toBe("Create an API key in the Z.AI console (z.ai)");
    expect(presetKeyHelp("volcengine-intl", "回退")).toBe(
      "Create an API key in the BytePlus console → ModelArk → API Key",
    );
    expect(presetKeyHelp("dashscope-intl", "回退")).toBe(
      "Create an API-KEY in the Alibaba Cloud Model Studio console",
    );
    expect(presetKeyHelp("siliconflow-intl", "回退")).toBe(
      "Create an API key in the SiliconFlow console (siliconflow.com)",
    );
  });

  it("未知 id 回退传入原文（zh / en 均不泄漏 id）", () => {
    expect(presetKeyHelp("unknown-preset", "回退原文")).toBe("回退原文");
    setLocale("en");
    expect(presetKeyHelp("unknown-preset", "回退原文")).toBe("回退原文");
  });
});
