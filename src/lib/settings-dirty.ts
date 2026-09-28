// 设置页脏检测：比较内存草稿与已保存快照，驱动设置页底栏保存状态。
// 本模块为纯逻辑，不导入 components/、electron/ 或任何第三方包。

// 三个模型角色固定枚举（与 shared/types.d.ts 的 ModelRole 一致）。
const MODEL_ROLES: ModelRole[] = ["image", "reverse", "enhance"];

/**
 * 判断设置草稿相对已保存快照是否存在未保存的更改。
 * 比较范围：autoArchive、removedProviderIds、三角色绑定、供应商内容（按 id 查找，不看顺序）。
 * 刻意不比较：快照的 hasKey（草稿不回显已存密钥）、供应商数组顺序。
 * 模型数组按索引顺序敏感比较。
 */
export function isSettingsDirty(
  draft: SettingsSavePayload,
  snapshot: Pick<SettingsSnapshot, "providers" | "roles" | "autoArchive">,
): boolean {
  // 1. 自动归档开关翻转
  if (draft.autoArchive !== snapshot.autoArchive) return true;
  // 2. 存在待删除供应商
  if (draft.removedProviderIds.length > 0) return true;

  // 3. 角色绑定：providerId 与 model 逐个比较（null 只在双方都为 null 时相等）
  for (const role of MODEL_ROLES) {
    const a = draft.roles[role];
    const b = snapshot.roles[role];
    if (a === null || b === null) {
      if (a !== b) return true;
      continue;
    }
    if (a.providerId !== b.providerId || a.model !== b.model) return true;
  }

  // 4a. 任何草稿供应商填入了非空白新密钥（表示要覆盖已存密钥）
  for (const provider of draft.providers) {
    if (provider.apiKey?.trim()) return true;
  }

  // 4c. 数量不同直接判脏
  if (draft.providers.length !== snapshot.providers.length) return true;

  const savedById = new Map(snapshot.providers.map((provider) => [provider.id, provider]));

  // 4d. 逐草稿供应商按 id 查找快照并比较内容；快照 hasKey 刻意忽略
  for (const provider of draft.providers) {
    const saved = savedById.get(provider.id);
    if (!saved) return true;
    if (provider.name !== saved.name || provider.baseUrl !== saved.baseUrl) return true;
    if ((provider.api ?? "openai") !== (saved.api ?? "openai")) return true;
    if ((provider.modelsUpdatedAt ?? "") !== (saved.modelsUpdatedAt ?? "")) return true;
    if (!providerModelsEqual(provider.models, saved.models)) return true;
  }

  // 4e. 快照中存在草稿没有的供应商 id（等长替换守卫）
  for (const saved of snapshot.providers) {
    if (!draft.providers.some((provider) => provider.id === saved.id)) return true;
  }

  return false;
}

/** 模型数组按索引顺序敏感比较：id、roles 逐项、source、missing。 */
function providerModelsEqual(a: ProviderModel[], b: ProviderModel[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id) return false;
    if (x.roles.length !== y.roles.length) return false;
    for (let j = 0; j < x.roles.length; j++) {
      if (x.roles[j] !== y.roles[j]) return false;
    }
    if ((x.source ?? "") !== (y.source ?? "")) return false;
    if (Boolean(x.missing) !== Boolean(y.missing)) return false;
  }
  return true;
}
