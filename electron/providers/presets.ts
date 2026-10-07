// 预设平台表 + 适配器注册表：纯逻辑、无 electron / Node 副作用。
// 预设与自定义共用 ProviderConfig 结构（仅多一个 api 字段）；
// getAdapter 未知 api 返回 undefined → 上层走 openai 默认路径。
// 「文档实施」批次：请求/响应协议按各家官方文档构造（适配器内置前置校验），
// 预设模型 ID 取自官方文档（部分标注待实测），用户可在设置页刷新/手动调整。
// 国际站条目（*-intl）：label 用各站官方品牌名（品牌名保持其原语言，不翻译）；
// 与国内站协议同构（同端点路径/请求/响应形状），仅 baseUrl 与模型 ID 不同
// （火山国际去 doubao- 前缀）→ 复用同一适配器；两站密钥独立不互通，故分列条目。
// 排列契约：先国内站组（7 条）、后国际站组（5 条）——不做品牌配对交叉排列
// （避免中/英 label 交替；设置页平台选择器按本数组顺序渲染）。

import type { ProviderPreset } from "../../shared/types";
import { dashscopeImageAdapter } from "./dashscope-image";
import { hunyuanImageAdapter } from "./hunyuan-image";
import { openRouterImageAdapter } from "./openrouter-image";
import { siliconflowImageAdapter } from "./siliconflow-image";
import { volcengineImageAdapter } from "./volcengine-image";
import { xaiImageAdapter } from "./xai-image";
import { zhipuImageAdapter } from "./zhipu-image";
import type { ProviderAdapter } from "./types";

/** 内置预设平台（K1）；新增平台 = 一条预设 + 一个适配器模块；国际站同协议时仅加预设、复用适配器。 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // —— 国内站组（7 条） ——
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
  // —— 国际站组（5 条，label 用各站官方品牌名、复用国内站适配器） ——
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
    // 国际站模型 ID 去 doubao- 前缀（待实测：以 BytePlus 控制台/GET /models 为准）。
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
    // 待实测：国际区模型 ID 以 Model Studio 模型广场为准（qwen-image-3.0-pro 官方标注 Scope: International）。
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
    // 两站模型 ID 一致（待实测：国际站目录以 GET /v1/models 为准）。
    presetModels: [
      { id: "Qwen/Qwen-Image", roles: ["image"] },
      { id: "Qwen/Qwen3-VL-32B-Instruct", roles: ["reverse"] },
      { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", roles: ["enhance"] },
    ],
    keyHelp: "在 SiliconFlow 控制台创建 API 密钥",
  },
];

const ADAPTERS: ProviderAdapter[] = [
  hunyuanImageAdapter,
  zhipuImageAdapter,
  volcengineImageAdapter,
  dashscopeImageAdapter,
  siliconflowImageAdapter,
  xaiImageAdapter,
  openRouterImageAdapter,
];

/** 未知 api 返回 undefined → 上层走 openai 默认路径。 */
export function getAdapter(api: string | undefined): ProviderAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.api === api);
}

/** 按 id 查询内置预设；未知 id 返回 undefined。 */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}
