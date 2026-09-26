// 渲染层通用纯助手：数值 / 尺寸 / 时间 / 文案格式化。
// 本模块只使用平台内建能力，不导入 components/、electron/ 或任何第三方包。

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

/** 毫秒 → "x.x 秒"（统一 src/main.tsx:199 与 src/components/LocalAIToolbox.tsx:251 的 (ms/1000).toFixed(1)+" 秒"）。 */
export function formatDurationSeconds(ms: number): string {
  return (ms / 1000).toFixed(1) + " 秒";
}

/** 时间戳 / ISO 字符串 → 本地化时间文本（替换 new Date(...).toLocaleString()）。 */
export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString();
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
  if (recipe.mode === "outpaint") return "智能扩图";
  if (opts.referenceAware && (recipe.referenceCount || 0) > 0) return "参考图生成";
  if (opts.fallback) return opts.fallback;
  return recipe.mode === "edit" ? "图片编辑" : "文生图";
}

/** 标签数组 → 以「，」拼接，与 parseTags（src/lib/creative.ts:41-43）对称。 */
export function formatTags(tags: readonly string[]): string {
  return tags.join("，");
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
