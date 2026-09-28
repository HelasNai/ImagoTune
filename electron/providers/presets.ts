// 预设平台表 + 适配器注册表：纯逻辑、无 electron / Node 副作用。
// 预设与自定义共用 ProviderConfig 结构（仅多一个 api 字段）；
// getAdapter 未知 api 返回 undefined → 上层走 openai 默认路径。

import type { ProviderPreset } from "../../shared/types";
import { hunyuanImageAdapter } from "./hunyuan-image";
import type { ProviderAdapter } from "./types";

/** 内置预设平台（K1）；新增平台只需加一条预设 + 一个适配器模块。 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "hunyuan",
    label: "腾讯混元",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    api: "hunyuan-image",
    presetModels: [{ id: "hy-image-v3.5-preview", roles: ["image"] }],
    keyHelp: "在腾讯云控制台 → TokenHub → API Key 创建",
  },
];

const ADAPTERS: ProviderAdapter[] = [hunyuanImageAdapter];

/** 未知 api 返回 undefined → 上层走 openai 默认路径。 */
export function getAdapter(api: string | undefined): ProviderAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.api === api);
}

/** 按 id 查询内置预设；未知 id 返回 undefined。 */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}
