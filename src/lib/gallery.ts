// 图库展示纯逻辑：把持久化数据（收件箱 id、recovery 标记、本地 AI 动作 code）映射为当前语言文案。
// 关键约定：用户内容（项目名、用户标题）永不翻译；只翻译系统默认名与动作 code。
// 无 React/DOM 依赖；动态 key 只经既有的 t()（本文件不新增 `as I18nKey` cast）。
import { INBOX_PROJECT_ID } from "./constants";
import { t } from "./i18n";
import { localAIArchiveLabel } from "./local-ai";

type ProjectLike = { id: string; name: string };
type GalleryItemLike = { title: string; recipe: { recovered?: boolean; variationLabel?: string } };

/**
 * 项目显示名：收件箱按 `id === INBOX_PROJECT_ID` 渲染，忽略存储 name（历史 name="收件箱" 等自动受益，
 * 无需迁移）；其余项目保持存储 name（用户内容）。求值点在渲染期，语言切换后随重渲染更新。
 */
export function projectDisplayName(project: ProjectLike): string {
  return project.id === INBOX_PROJECT_ID ? t("收件箱") : project.name;
}

/**
 * 图库条目展示标题：
 * - recovery 标记 → `t("恢复的历史图片")`（系统默认名按语言重渲染；无标记的历史记录冻结原样）；
 * - 本地 AI 归档（`variationLabel` 为动作 code）→ 把标题尾部的 ` - <code>` 替换为当前语言标签，
 *   保留标题中的用户源文本；若标题本身就是 code（无 ` - ` 前缀）则直接返回标签；
 * - 其余（用户标题 / 历史本地化值）冻结原样。
 */
export function galleryItemTitle(item: GalleryItemLike): string {
  if (item.recipe.recovered) return t("恢复的历史图片");
  const label = localAIArchiveLabel(item.recipe.variationLabel);
  if (label === undefined) return item.title;
  const suffix = ` - ${String(item.recipe.variationLabel)}`;
  return item.title.endsWith(suffix) ? `${item.title.slice(0, -suffix.length)} - ${label}` : label;
}
