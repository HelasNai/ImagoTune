// 供应商/模型角色选项纯逻辑：设置页「模型分配」与侧栏快捷模型切换器共用。
// 本模块为纯逻辑，不导入 components/、electron/ 或任何第三方包；两处消费方须保持同步。

import type { ModelRole, ProviderConfig, RoleBinding, SettingsSavePayload } from "../../shared/types";
import { t } from "./i18n";

/** 下拉候选项：value 为实际 id，label 为展示文本（失效态带 ⚠ 前缀）。 */
export type RoleOption = { value: string; label: string };

// 角色列表与显示名（顺序 = 复选框/批量按钮渲染顺序）。
export const MODEL_ROLES: ModelRole[] = ["image", "reverse", "enhance"];

// 角色显示名：as-const 中文 key 映射 + t() 运行时求值（语言切换后随重渲染更新，禁止模块加载期求值）。
const ROLE_LABEL_KEYS = { image: "生图", reverse: "图反推", enhance: "提示词增强" } as const;

/** 取角色显示名（生图 / 图反推 / 提示词增强），经 i18n 运行时解析。 */
export function modelRoleLabel(role: ModelRole): string {
  return t(ROLE_LABEL_KEYS[role]);
}

/**
 * 供应商下拉：全部供应商映射为 {value: id, label: name}；
 * 当前绑定指向已不存在的供应商 → 置顶注入「⚠ 已删除的供应商」失效项（其余顺序不变）。
 */
export function roleProviderOptions(providers: ProviderConfig[], binding: RoleBinding | null): RoleOption[] {
  const options = providers.map((provider) => ({ value: provider.id, label: provider.name }));
  if (binding && !providers.some((provider) => provider.id === binding.providerId)) {
    options.unshift({ value: binding.providerId, label: t("⚠ 已删除的供应商") });
  }
  return options;
}

/**
 * 模型下拉：仅该供应商「已标注本角色」的模型映射为 {value: id, label: id}；
 * 绑定为空 → []；供应商不存在 → 仅显示绑定模型 ⚠；绑定模型未标注 → 置顶 ⚠ 可见项。
 */
export function roleModelOptions(
  providers: ProviderConfig[],
  binding: RoleBinding | null,
  role: ModelRole,
): RoleOption[] {
  if (!binding) return [];
  const provider = providers.find((item) => item.id === binding.providerId);
  if (!provider) return [{ value: binding.model, label: binding.model + " " + t("⚠ 未标注") }];
  const annotated = provider.models.filter((model) => model.roles.includes(role));
  const options = annotated.map((model) => ({ value: model.id, label: model.id }));
  if (!annotated.some((model) => model.id === binding.model)) {
    options.unshift({ value: binding.model, label: binding.model + " " + t("⚠ 未标注") });
  }
  return options;
}

/** 取指定供应商首个标注了该角色的模型 id；供应商不存在或无标注 → null。 */
export function firstAnnotatedModel(providers: ProviderConfig[], providerId: string, role: ModelRole): string | null {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return null;
  const annotated = provider.models.find((model) => model.roles.includes(role));
  return annotated?.id ?? null;
}

/** 侧栏快捷切换的保存载荷：剥离 hasKey 等展示字段，仅保留可提交的 ProviderConfig 形状。 */
export function buildQuickSwitchPayload(
  providers: Array<ProviderConfig & { hasKey?: boolean }>,
  roles: Record<ModelRole, RoleBinding | null>,
  autoArchive: boolean,
): SettingsSavePayload {
  return {
    providers: providers.map(({ hasKey: _h, ...rest }) => {
      void _h;
      return rest;
    }),
    removedProviderIds: [],
    roles,
    autoArchive,
  };
}
