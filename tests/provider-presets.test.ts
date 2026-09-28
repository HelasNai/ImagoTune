import { describe, expect, it } from "vitest";
import { getAdapter, getPreset, PROVIDER_PRESETS } from "../electron/providers/presets";

describe("PROVIDER_PRESETS 预设表", () => {
  it("唯一预设为腾讯混元，字段与 K1 契约逐字一致", () => {
    expect(PROVIDER_PRESETS).toEqual([
      {
        id: "hunyuan",
        label: "腾讯混元",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        api: "hunyuan-image",
        presetModels: [{ id: "hy-image-v3.5-preview", roles: ["image"] }],
        keyHelp: "在腾讯云控制台 → TokenHub → API Key 创建",
      },
    ]);
  });
});

describe("适配器注册表 getAdapter", () => {
  it("已知 api 返回对应适配器且 api 字段匹配", () => {
    const adapter = getAdapter("hunyuan-image");
    expect(adapter).toBeDefined();
    expect(adapter?.api).toBe("hunyuan-image");
    expect(typeof adapter?.generate).toBe("function");
  });

  it("openai 与 undefined 均返回 undefined（走 openai 默认路径）", () => {
    expect(getAdapter("openai")).toBeUndefined();
    expect(getAdapter(undefined)).toBeUndefined();
  });

  it("未知 api 返回 undefined", () => {
    expect(getAdapter("nope")).toBeUndefined();
  });
});

describe("预设查询 getPreset", () => {
  it("命中返回预设，未知 id 返回 undefined", () => {
    expect(getPreset("hunyuan")?.id).toBe("hunyuan");
    expect(getPreset("nope")).toBeUndefined();
  });
});
