import { DEFAULT_IMAGE_MODEL, INBOX_PROJECT_ID } from "./constants";
import { clamp, modeLabel, nowISO } from "./format";

export type PromptAction = "refine" | "detail" | "poster" | "social" | "realistic" | "premium";

/** recipe 各受控字段的上限（与 electron/image-recipe.ts 的归一化语义一致）。 */
const RECIPE_MAX_N = 4;
const RECIPE_MAX_TAGS = 20;
const RECIPE_MAX_REFERENCES = 3;

/**
 * 统一构造 ImageRecipeV1：补齐默认值并钳制受控字段。
 * - `version` 固定 1；`n` 钳制到 1..4；`tags` 截断到最多 20 条；
 * - `referenceCount` 钳制到最多 3（0 / 缺省 → undefined）；
 * - `projectId` 默认 INBOX_PROJECT_ID；`createdAt` 默认 nowISO()；
 * - `model` 默认 DEFAULT_IMAGE_MODEL（调用方显式传入时以传入值为准）。
 * 不改变字段名、版本号与 mode 语义。
 */
export function createRecipe(partial: Partial<ImageRecipeV1> = {}): ImageRecipeV1 {
  const rawReferenceCount = partial.referenceCount;
  const referenceCount = typeof rawReferenceCount === "number" && rawReferenceCount > 0
    ? clamp(rawReferenceCount, 0, RECIPE_MAX_REFERENCES)
    : undefined;
  return {
    version: 1,
    prompt: String(partial.prompt || ""),
    negativePrompt: String(partial.negativePrompt || ""),
    model: String(partial.model || DEFAULT_IMAGE_MODEL),
    size: String(partial.size || ""),
    ratio: typeof partial.ratio === "string" ? partial.ratio : undefined,
    resolution: typeof partial.resolution === "string" ? partial.resolution : undefined,
    quality: typeof partial.quality === "string" ? partial.quality : undefined,
    n: clamp(Number(partial.n) || 1, 1, RECIPE_MAX_N),
    mode: partial.mode || "generate",
    projectId: String(partial.projectId || INBOX_PROJECT_ID),
    tags: Array.isArray(partial.tags) ? partial.tags.map(String).slice(0, RECIPE_MAX_TAGS) : [],
    createdAt: partial.createdAt || nowISO(),
    sourceId: typeof partial.sourceId === "string" ? partial.sourceId : undefined,
    variationLabel: typeof partial.variationLabel === "string" ? partial.variationLabel : undefined,
    referenceCount,
    seed: partial.seed,
    outpaint: partial.outpaint,
    postProcessing: partial.postProcessing,
  };
}

export const resolutionOptions = [
  { value: "1k", label: "1K（标准）" },
  { value: "2k", label: "2K（高清）" },
  { value: "4k", label: "4K（超清）" },
];

export const ratioOptions = [
  { value: "1:1", label: "1:1 正方形" },
  { value: "4:3", label: "4:3 横向" },
  { value: "3:4", label: "3:4 竖向" },
  { value: "3:2", label: "3:2 横向" },
  { value: "2:3", label: "2:3 竖向" },
  { value: "16:9", label: "16:9 宽屏" },
  { value: "9:16", label: "9:16 手机" },
  { value: "4:5", label: "4:5 人像" },
  { value: "5:4", label: "5:4 横幅" },
  { value: "21:9", label: "21:9 超宽" },
];

export const sizeMatrix: Record<string, Record<string, string>> = {
  "1k": {
    "1:1": "1280x1280", "4:3": "1280x960", "3:4": "960x1280",
    "3:2": "1280x848", "2:3": "848x1280", "16:9": "1280x720",
    "9:16": "720x1280", "4:5": "1024x1280", "5:4": "1280x1024",
    "21:9": "1280x544",
  },
  "2k": {
    "1:1": "2048x2048", "4:3": "2048x1536", "3:4": "1536x2048",
    "3:2": "2048x1360", "2:3": "1360x2048", "16:9": "2048x1152",
    "9:16": "1152x2048", "4:5": "1632x2048", "5:4": "2048x1632",
    "21:9": "2048x880",
  },
  "4k": {
    "1:1": "3840x3840", "4:3": "3840x2880", "3:4": "2880x3840",
    "3:2": "3840x2560", "2:3": "2560x3840", "16:9": "3840x2160",
    "9:16": "2160x3840", "4:5": "3072x3840", "5:4": "3840x3072",
    "21:9": "3840x1648",
  },
};

/** 扩图页快捷比例：显式具名子集，顺序与 ratioOptions 前 4 项不同，勿改用 slice。 */
export const outpaintQuickRatios = ["1:1", "4:5", "16:9", "9:16"];

/** 图库清晰度筛选项：渲染时以 value.toUpperCase() 显示为 1K/2K/4K。 */
export const resolutionLevels = ["1k", "2k", "4k"];

const promptSuffix: Record<PromptAction, string> = {
  refine: "主体明确，构图聚焦，画面干净，避免无关元素。",
  detail: "补充清晰的材质、光线、空间层次和可执行的视觉细节，主体边缘完整。",
  poster: "商业海报级构图，视觉中心明确，保留标题与文案安全区域，具有强烈层级和传播感。",
  social: "适合社交媒体快速浏览，第一眼主体醒目，色彩鲜明，画面简洁有记忆点。",
  realistic: "真实摄影质感，自然光影，材质可信，细节清晰，避免塑料感与过度磨皮。",
  premium: "高级克制的视觉语言，精致材质与灯光，留白得体，整体统一且具有品牌感。",
};

export function applyLocalPromptAction(prompt: string, action: PromptAction) {
  const source = prompt.trim();
  if (!source) return "";
  return source + "\n\n创作要求：" + promptSuffix[action];
}

/** 画布尺寸上限（与 electron/outpaint-limits.ts 一致，由跨层一致性测试锁定）。
 *  像素上限 = 最长边的平方（3840² = 14,745,600）——允许 3840×3840 方形用满上限；
 *  4K 档改为「长边口径」后，面积检查退化为边长约束的推论（不再限制形状）。 */
export const CANVAS_MULTIPLE = 16;
export const CANVAS_MAX_EDGE = 3840;
export const CANVAS_MAX_PIXELS = 14_745_600;

export function validateCanvasSize(value: string) {
  const match = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/i.exec(value);
  if (!match) return { ok: false, message: "请输入宽 x 高，例如 1536x1024" } as const;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  if (width % CANVAS_MULTIPLE || height % CANVAS_MULTIPLE) return { ok: false, message: "宽高需要是 16 的倍数" } as const;
  if (longEdge > CANVAS_MAX_EDGE) return { ok: false, message: "最长边不能超过 3840 px" } as const;
  if (longEdge / shortEdge > 3) return { ok: false, message: "长宽比不能超过 3:1" } as const;
  if (pixels < 655_360 || pixels > CANVAS_MAX_PIXELS) {
    return { ok: false, message: "总像素需在 65 万到 1475 万之间" } as const;
  }
  return {
    ok: true,
    width,
    height,
    size: String(width) + "x" + String(height),
    message: String(width) + " × " + String(height) + "，约 " + (pixels / 1_000_000).toFixed(2) + " MP",
  } as const;
}

// 分隔符同时接受中文逗号「，」、英文逗号 "," 与换行；每段 trim 后去重、上限 20。
export function parseTags(value: string) {
  return [...new Set(value.split(/[，,\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export function formatGenerationParameters(
  recipe: ImageRecipeV1,
) {
  return [
    "正面提示词：" + recipe.prompt,
    "负面提示词：" + (recipe.negativePrompt || "无"),
    "模型：" + recipe.model,
    "尺寸：" + recipe.size,
    "比例：" + (recipe.ratio || "未记录"),
    "清晰度：" + (recipe.resolution || "未记录"),
    "细节质量：" + (recipe.quality || "自动"),
    "模式：" + modeLabel(recipe),
    "Seed：" + (recipe.seed || "接口未返回"),
    "标签：" + (recipe.tags.join("、") || "无"),
    "项目：" + recipe.projectId,
  ].join("\n");
}

export const variationOptions = [
  { id: "premium", label: "更高级", suffix: "版本方向：提升高级感、统一性与材质质感，保持原主题。" },
  { id: "realistic", label: "更写实", suffix: "版本方向：提升真实摄影感、自然光线与可信细节，保持原主题。" },
  { id: "minimal", label: "更简洁", suffix: "版本方向：减少次要元素，保留核心主体和清晰留白，保持原主题。" },
  { id: "impact", label: "更有视觉冲击力", suffix: "版本方向：强化视觉焦点、对比、动态感和第一眼吸引力，保持原主题。" },
] as const;
