export type PromptAction = "refine" | "detail" | "poster" | "social" | "realistic" | "premium";

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

export function validateCanvasSize(value: string) {
  const match = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/i.exec(value);
  if (!match) return { ok: false, message: "请输入宽 x 高，例如 1536x1024" } as const;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  if (width % 16 || height % 16) return { ok: false, message: "宽高需要是 16 的倍数" } as const;
  if (longEdge > 3840) return { ok: false, message: "最长边不能超过 3840 px" } as const;
  if (longEdge / shortEdge > 3) return { ok: false, message: "长宽比不能超过 3:1" } as const;
  if (pixels < 655_360 || pixels > 8_294_400) {
    return { ok: false, message: "总像素需在 65 万到 829 万之间" } as const;
  }
  return {
    ok: true,
    width,
    height,
    size: String(width) + "x" + String(height),
    message: String(width) + " × " + String(height) + "，约 " + (pixels / 1_000_000).toFixed(2) + " MP",
  } as const;
}

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
    "模式：" + (recipe.mode === "outpaint" ? "智能扩图" : recipe.mode === "edit" ? "图片编辑" : "文生图"),
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
