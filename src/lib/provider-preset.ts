// 预设平台 → 供应商草稿映射：设置页「添加供应商」预设态使用（K1/K7）。
// 本模块为纯逻辑，不导入 components/、electron/ 或任何第三方包；预设数据经
// settings:get 快照到达渲染层（K8），渲染层绝不 import electron/。

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
