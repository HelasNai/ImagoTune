// 提示词模板展示标签的纯逻辑映射（无 React/DOM/IPC）。
//
// 稳定标识 = 内置模板的 `id`（`electron/main.ts` 的 DEFAULT_TEMPLATES，形如 `builtin-poster`），
// 标题与分类都由 id 派生（不新增冗余字段）；`prompt` 是模型输入，永不翻译。
// 非内置（用户）模板的 title/category 是用户数据，冻结存储原值，绝不翻译。
import { t, type I18nKey } from "./i18n";

// 内置模板 id → 词典 key（title/category）。
const BUILTIN_TEMPLATE_LABELS: Record<string, { title: I18nKey; category: I18nKey }> = {
  "builtin-poster": { title: "科技产品海报", category: "海报" },
  "builtin-cover": { title: "内容平台封面", category: "封面" },
  "builtin-product": { title: "产品展示图", category: "产品" },
  "builtin-social": { title: "社交媒体配图", category: "社交媒体" },
  "builtin-negative-quality": { title: "通用高质量", category: "通用" },
  "builtin-negative-portrait": { title: "人像无畸变", category: "人像" },
  "builtin-negative-real": { title: "写实去 AI 感", category: "写实" },
  "builtin-negative-clean": { title: "干净背景", category: "背景" },
};

// 用户模板的默认分类码：新值 "custom"；历史值 "自定义" 精确匹配视同默认（不迁移，展示层本地化）。
const DEFAULT_CATEGORY_CODES = new Set(["custom", "自定义"]);

export type TemplateLabelSource = { id: string; title: string; category: string; builtin?: boolean };

function builtinLabelKeys(template: TemplateLabelSource): { title: I18nKey; category: I18nKey } | undefined {
  return template.builtin ? BUILTIN_TEMPLATE_LABELS[template.id] : undefined;
}

/** 内置模板标题按 id 映射；非内置（用户）模板标题是用户数据，冻结存储原值。 */
export function templateTitle(template: TemplateLabelSource): string {
  const keys = builtinLabelKeys(template);
  return keys ? t(keys.title) : template.title;
}

/**
 * 内置模板分类按 id 映射；用户模板的默认分类码（"custom" / 历史 "自定义"）本地化，
 * 其余分类是用户数据，冻结存储原值。
 */
export function templateCategory(template: TemplateLabelSource): string {
  const keys = builtinLabelKeys(template);
  if (keys) return t(keys.category);
  return DEFAULT_CATEGORY_CODES.has(template.category) ? t("自定义") : template.category;
}
