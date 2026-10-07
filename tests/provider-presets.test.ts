import { describe, expect, it } from "vitest";
import { getAdapter, getPreset, PROVIDER_PRESETS } from "../electron/providers/presets";

describe("PROVIDER_PRESETS 预设表", () => {
  it("七家供应商共 12 条站点条目（国内组 7 + 国际组 5，分组排列不交叉），label 用各站官方品牌名、字段逐字一致", () => {
    expect(PROVIDER_PRESETS).toEqual([
      {
        id: "hunyuan",
        label: "腾讯混元",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        api: "hunyuan-image",
        presetModels: [{ id: "hy-image-v3.5-preview", roles: ["image"] }],
        keyHelp: "在腾讯云控制台 → TokenHub → API Key 创建",
      },
      {
        id: "zhipu",
        label: "智谱 AI",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        api: "zhipu-image",
        presetModels: [
          { id: "glm-image", roles: ["image"] },
          { id: "glm-4.6v", roles: ["reverse"] },
          { id: "glm-4.6", roles: ["enhance"] },
        ],
        keyHelp: "在智谱开放平台（bigmodel.cn）创建 API Key",
      },
      {
        id: "volcengine",
        label: "火山方舟",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        api: "volcengine-image",
        presetModels: [
          { id: "doubao-seedream-4-5-251128", roles: ["image"] },
          { id: "doubao-seed-1-6-vision-250815", roles: ["reverse"] },
          { id: "doubao-seed-2-0-lite-260428", roles: ["enhance"] },
        ],
        keyHelp: "在火山引擎控制台 → 火山方舟 → API Key 创建",
      },
      {
        id: "dashscope",
        label: "阿里云百炼",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api: "dashscope-image",
        presetModels: [
          { id: "qwen-image-3.0-pro", roles: ["image"] },
          { id: "qwen3-vl-235b-a22b-instruct", roles: ["reverse"] },
          { id: "qwen3.8-max", roles: ["enhance"] },
        ],
        keyHelp: "在阿里云百炼控制台创建 API-KEY",
      },
      {
        id: "siliconflow",
        label: "硅基流动",
        baseUrl: "https://api.siliconflow.cn/v1",
        api: "siliconflow-image",
        presetModels: [
          { id: "Qwen/Qwen-Image", roles: ["image"] },
          { id: "Qwen/Qwen3-VL-32B-Instruct", roles: ["reverse"] },
          { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", roles: ["enhance"] },
        ],
        keyHelp: "在硅基流动控制台创建 API 密钥",
      },
      {
        id: "xai",
        label: "xAI",
        baseUrl: "https://api.x.ai/v1",
        api: "xai-image",
        presetModels: [
          { id: "grok-imagine-image-2.0", roles: ["image"] },
          { id: "grok-4.6", roles: ["reverse", "enhance"] },
        ],
        keyHelp: "在 x.ai 控制台创建 API Key",
      },
      {
        id: "openrouter",
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        api: "openrouter-image",
        presetModels: [
          { id: "bytedance-seed/seedream-4.5", roles: ["image"] },
          { id: "qwen/qwen3-vl-235b-a22b-instruct", roles: ["reverse"] },
          { id: "qwen/qwen3.5-plus-02-15", roles: ["enhance"] },
        ],
        keyHelp: "在 OpenRouter 控制台创建 API Key",
      },
      {
        id: "hunyuan-intl",
        label: "TokenHub",
        baseUrl: "https://tokenhub-intl.tencentcloudmaas.com/v1",
        api: "hunyuan-image",
        presetModels: [{ id: "hy-image-v3.5-preview", roles: ["image"] }],
        keyHelp: "在腾讯云国际站控制台 → TokenHub → API Key 创建",
      },
      {
        id: "zhipu-intl",
        label: "Z.AI",
        baseUrl: "https://api.z.ai/api/paas/v4",
        api: "zhipu-image",
        presetModels: [
          { id: "glm-image", roles: ["image"] },
          { id: "glm-4.6v", roles: ["reverse"] },
          { id: "glm-4.6", roles: ["enhance"] },
        ],
        keyHelp: "在 Z.AI 控制台（z.ai）创建 API Key",
      },
      {
        id: "volcengine-intl",
        label: "BytePlus ModelArk",
        baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
        api: "volcengine-image",
        presetModels: [
          { id: "seedream-4-5-251128", roles: ["image"] },
          { id: "seed-1-6-250915", roles: ["reverse"] },
          { id: "seed-2-0-lite-260428", roles: ["enhance"] },
        ],
        keyHelp: "在 BytePlus 控制台 → ModelArk → API Key 创建",
      },
      {
        id: "dashscope-intl",
        label: "Alibaba Cloud Model Studio",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        api: "dashscope-image",
        presetModels: [
          { id: "qwen-image-3.0-pro", roles: ["image"] },
          { id: "qwen3-vl-plus", roles: ["reverse"] },
          { id: "qwen3-max", roles: ["enhance"] },
        ],
        keyHelp: "在 Alibaba Cloud Model Studio 控制台创建 API-KEY",
      },
      {
        id: "siliconflow-intl",
        label: "SiliconFlow",
        baseUrl: "https://api.siliconflow.com/v1",
        api: "siliconflow-image",
        presetModels: [
          { id: "Qwen/Qwen-Image", roles: ["image"] },
          { id: "Qwen/Qwen3-VL-32B-Instruct", roles: ["reverse"] },
          { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", roles: ["enhance"] },
        ],
        keyHelp: "在 SiliconFlow 控制台创建 API 密钥",
      },
    ]);
  });

  it("id 全表唯一，前 7 条为国内站、后 5 条为国际站，且国际站条目与国内站复用同一适配器 api 值（共 7 个）", () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROVIDER_PRESETS.slice(0, 7).map((preset) => preset.id)).toEqual([
      "hunyuan",
      "zhipu",
      "volcengine",
      "dashscope",
      "siliconflow",
      "xai",
      "openrouter",
    ]);
    expect(PROVIDER_PRESETS.slice(7).map((preset) => preset.id)).toEqual([
      "hunyuan-intl",
      "zhipu-intl",
      "volcengine-intl",
      "dashscope-intl",
      "siliconflow-intl",
    ]);
    const apis = new Set(PROVIDER_PRESETS.map((preset) => preset.api));
    expect(apis.size).toBe(7);
  });
});

describe("适配器注册表 getAdapter", () => {
  it("已知 api 返回对应适配器且 api 字段匹配", () => {
    const adapter = getAdapter("hunyuan-image");
    expect(adapter).toBeDefined();
    expect(adapter?.api).toBe("hunyuan-image");
    expect(typeof adapter?.generate).toBe("function");
  });

  it("六家新增平台的 api 全部命中注册表且 generate 可调用", () => {
    const styles = [
      "zhipu-image",
      "volcengine-image",
      "dashscope-image",
      "siliconflow-image",
      "xai-image",
      "openrouter-image",
    ];
    for (const api of styles) {
      const adapter = getAdapter(api);
      expect(adapter).toBeDefined();
      expect(adapter?.api).toBe(api);
      expect(typeof adapter?.generate).toBe("function");
    }
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
  it("命中返回预设（含国际站条目），未知 id 返回 undefined", () => {
    expect(getPreset("hunyuan")?.id).toBe("hunyuan");
    expect(getPreset("zhipu-intl")?.id).toBe("zhipu-intl");
    expect(getPreset("openrouter")?.id).toBe("openrouter");
    expect(getPreset("nope")).toBeUndefined();
  });
});
