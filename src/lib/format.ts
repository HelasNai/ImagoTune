// 渲染层通用纯助手：数值 / 尺寸 / 时间 / 文案格式化。
// 本模块只使用平台内建能力与同层 i18n 运行时，不导入 components/、electron/ 或任何第三方包。
// locale 一律在调用时经 getLocale() 读取，绝不在模块加载期缓存。
import { getLocale, t } from "./i18n";
import type { I18nKey } from "./i18n";

/** 具备 name / size / lastModified 的文件结构（浏览器 File 可直接满足）。 */
export type CompositeFileLike = { name: string; size: number; lastModified: number };

/** 把数值钳制到 [min, max] 区间。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 向上取整到 16 的倍数，负数归零（原 src/lib/outpaint.ts:15）。 */
export function roundUp16(value: number): number {
  return Math.max(0, Math.ceil(value / 16) * 16);
}

/** 解析 "1024x768" / "1024×768"（支持前后空白）；非 NxN 形状返回 null（原 src/lib/outpaint.ts:17-20）。 */
export function parsePixelSize(value: string): { width: number; height: number } | null {
  const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(value);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

/** 宽高拼接为 "宽x高"（沿用 outpaint 布局的拼接风格，src/lib/outpaint.ts:56-72）。 */
export function formatPixelSize(width: number, height: number): string {
  return `${width}x${height}`;
}

/** 二进制（1024）文件大小格式化（迁移自 src/components/LocalAIToolbox.tsx:60-62，保留原语义）。 */
export function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** 毫秒 → "x.x 秒"（zh 逐字不变）/ "x.xs"（en）；key 为现状中文模板，en 词典值为 "{s}s"。 */
export function formatDurationSeconds(ms: number): string {
  return t("{s} 秒", { s: (ms / 1000).toFixed(1) });
}

/** 时间戳 / ISO 字符串 → 本地化时间文本；locale 显式传入（zh-CN / en-US）。 */
export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(getLocale() === "en" ? "en-US" : "zh-CN");
}

/** 侧栏紧凑时间：今天 → "14:22"；今年 → "9/28"；更早 → zh "2025/12/1" / en "12/1/2025"（now 参数可注入便于测试）。 */
export function formatShortDate(value: string | number | Date, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return getLocale() === "en"
    ? `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
    : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** modeLabel 的可选开关。 */
export type ModeLabelOptions = { referenceAware?: boolean; fallback?: string };

/**
 * 模式文案。分支优先级固定为：
 * outpaint > (referenceAware && referenceCount > 0) > fallback > 模式默认。
 * - 默认：文生图 / 图片编辑 / 智能扩图（src/lib/creative.ts:56）
 * - `{ referenceAware: true }`：额外含「参考图生成」（src/components/queue-utils.ts:24）
 * - `{ fallback: "新生成图片" }`：覆盖 generate 与 edit（src/components/ResultPanel.tsx:135）
 */
export function modeLabel(
  recipe: { mode: RecipeMode; referenceCount?: number },
  opts: ModeLabelOptions = {},
): string {
  if (recipe.mode === "outpaint") return t("智能扩图");
  if (opts.referenceAware && (recipe.referenceCount || 0) > 0) return t("参考图生成");
  if (opts.fallback) return opts.fallback;
  return recipe.mode === "edit" ? t("图片编辑") : t("文生图");
}

/** 标签数组 → 按 locale 以「，」（zh）/ ", "（en）拼接，与 parseTags（src/lib/creative.ts:41-43）对称。 */
export function formatTags(tags: readonly string[]): string {
  return tags.join(getLocale() === "en" ? ", " : "，");
}

/** 按 key 去重，保留首次出现的顺序。 */
export function uniqueBy<T>(items: readonly T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 当前时间的 ISO 字符串。 */
export function nowISO(): string {
  return new Date().toISOString();
}

/** 文件去重键：`${name}-${size}-${lastModified}`（useComposer / ComposerPanel 消费）。 */
export function compositeFileKey(file: CompositeFileLike): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

/** 队列任务状态 → 本地化文案（替换队列面板原先裸露的英文枚举）；未知状态回退原枚举。 */
export function queueStatusLabel(status: QueueStatus): string {
  const labels: Record<QueueStatus, I18nKey> = {
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
  };
  const key = labels[status];
  return key ? t(key) : status;
}
