// 预设平台 → 供应商草稿映射：设置页「添加供应商」预设态使用（K1/K7）。
// 本模块为纯逻辑，不导入 components/、electron/ 或任何第三方包；预设数据经
// settings:get 快照到达渲染层（K8），渲染层绝不 import electron/。

import { t, type I18nKey } from "./i18n";

// 预设 keyHelp 的渲染层本地化映射：key = preset.id，value = 中文原文 key
// （zh 直通即原文，en 查 en/settings.ts 译文）。主进程仍下发原中文 keyHelp 作未命中回退。
const PRESET_KEY_HELP_KEYS: Record<string, I18nKey> = {
  hunyuan: "在腾讯云控制台 → TokenHub → API Key 创建",
  "hunyuan-intl": "在腾讯云国际站控制台 → TokenHub → API Key 创建",
  zhipu: "在智谱开放平台（bigmodel.cn）创建 API Key",
  "zhipu-intl": "在 Z.AI 控制台（z.ai）创建 API Key",
  volcengine: "在火山引擎控制台 → 火山方舟 → API Key 创建",
  "volcengine-intl": "在 BytePlus 控制台 → ModelArk → API Key 创建",
  dashscope: "在阿里云百炼控制台创建 API-KEY",
  "dashscope-intl": "在 Alibaba Cloud Model Studio 控制台创建 API-KEY",
  siliconflow: "在硅基流动控制台创建 API 密钥",
  "siliconflow-intl": "在 SiliconFlow 控制台创建 API 密钥",
  xai: "在 x.ai 控制台创建 API Key",
  openrouter: "在 OpenRouter 控制台创建 API Key",
};

/** 预设平台 keyHelp 的本地化文本：命中映射走 t()（zh 原文 / en 译文），未命中回退原文。 */
export function presetKeyHelp(id: string, fallback: string): string {
  const key = PRESET_KEY_HELP_KEYS[id];
  return key ? t(key) : fallback;
}

/** 把内置预设平台转换为供应商草稿（K1/K7）：name=label、api/presetModels 原样带入；预置模型深拷贝，避免 UI 编辑污染预设表。 */
export function presetToProviderDraft(preset: ProviderPreset, id: string, apiKey?: string): ProviderConfig & { apiKey?: string } {
  const trimmedKey = apiKey?.trim() ?? "";
  return {
    id,
    name: preset.label,
    baseUrl: preset.baseUrl,
    api: preset.api,
    // 深拷贝：presetModels 是跨层共享的模块级常量，草稿会在 UI 中被编辑
    // （角色标注/刷新合并），浅引用会反向污染预设表；roles 数组同样复制。
    models: preset.presetModels.map((model) => ({ ...model, roles: [...model.roles] })),
    // apiKey 仅在去空白后非空时写入；空/纯空白 = 稍后填写，不产生 apiKey 键。
    ...(trimmedKey ? { apiKey: trimmedKey } : {}),
  };
}
