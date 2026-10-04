// 图库展示纯逻辑：把持久化数据（收件箱 id、recovery 标记、本地 AI 动作 code）映射为当前语言文案。
// 关键约定：用户内容（项目名、用户标题）永不翻译；只翻译系统默认名与动作 code。
// 无 React/DOM 依赖；动态 key 只经既有的 t()（本文件不新增 `as I18nKey` cast）。
import { INBOX_PROJECT_ID } from "./constants";
import { t } from "./i18n";
import { localAIArchiveLabel } from "./local-ai";

type ProjectLike = { id: string; name: string };
type GalleryItemLike = { title: string; recipe: { recovered?: boolean; variationLabel?: string } };

/**
 * 恢复路径写入的系统默认标题哨兵（`electron/gallery-store.ts` 的 `rebuildFromPngFiles`：
 * `title: recipe.prompt || "恢复的历史图片"`）。存储层始终写这个中文默认值，渲染层只在标题
 * 仍等于它时才按语言翻译；用户重命名后标题不再等于哨兵，原样冻结用户内容。
 */
const RECOVERED_DEFAULT_TITLE = "恢复的历史图片";

/**
 * 项目显示名：收件箱按 `id === INBOX_PROJECT_ID` 渲染，忽略存储 name（历史 name="收件箱" 等自动受益，
 * 无需迁移）；其余项目保持存储 name（用户内容）。求值点在渲染期，语言切换后随重渲染更新。
 */
export function projectDisplayName(project: ProjectLike): string {
  return project.id === INBOX_PROJECT_ID ? t("收件箱") : project.name;
}

/**
 * 图库条目展示标题：
 * - recovery 标记且标题仍等于恢复默认哨兵 → `t("恢复的历史图片")`（系统默认名按语言重渲染）；
 *   用户重命名后标题不再是哨兵 → 冻结用户标题，标记不覆盖重命名；
 * - 本地 AI 归档（`variationLabel` 为动作 code）：
 *   - 标题恰为 code（旧「title=code」写法）→ 返回当前语言标签；
 *   - 标题尾部为 ` - <code>`（正常归档）→ 用当前语言标签替换后缀，保留用户源标题；
 *   - 其余（用户重命名）→ 冻结用户标题；
 * - 其余（用户标题 / 历史本地化值 / 无标记）→ 冻结原样。
 */
export function galleryItemTitle(item: GalleryItemLike): string {
  if (item.recipe.recovered) {
    return item.title === RECOVERED_DEFAULT_TITLE ? t("恢复的历史图片") : item.title;
  }
  const code = item.recipe.variationLabel;
  const label = localAIArchiveLabel(code);
  if (label === undefined) return item.title;
  const raw = String(code);
  if (item.title === raw) return label;
  const suffix = ` - ${raw}`;
  return item.title.endsWith(suffix) ? `${item.title.slice(0, -suffix.length)} - ${label}` : item.title;
}
