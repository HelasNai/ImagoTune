export type RecipeMode = "generate" | "edit" | "outpaint";

export type OutpaintRecipe = {
  sourceSize: string;
  targetSize: string;
  top: number;
  right: number;
  bottom: number;
  left: number;
  preset?: string;
};

export type ImageRecipeV1 = {
  version: 1;
  prompt: string;
  negativePrompt: string;
  model: string;
  size: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  n: number;
  mode: RecipeMode;
  projectId: string;
  tags: string[];
  createdAt: string;
  sourceId?: string;
  variationLabel?: string;
  seed?: string;
  outpaint?: OutpaintRecipe;
};

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function tagsValue(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 20)
    : [];
}

export function normalizeRecipe(
  input: Record<string, unknown>,
  fallbackMode: RecipeMode = "generate",
): ImageRecipeV1 {
  const nested = input.recipe && typeof input.recipe === "object"
    ? input.recipe as Record<string, unknown>
    : input;
  const modeValue = stringValue(nested.mode, fallbackMode);
  const mode: RecipeMode = modeValue === "outpaint" || modeValue === "edit" ? modeValue : "generate";
  const prompt = stringValue(nested.prompt, stringValue(input.userPrompt, stringValue(input.prompt)));
  const outpaint = nested.outpaint && typeof nested.outpaint === "object"
    ? nested.outpaint as OutpaintRecipe
    : undefined;
  const seedValue = nested.seed;
  return {
    version: 1,
    prompt,
    negativePrompt: stringValue(nested.negativePrompt),
    model: stringValue(nested.model, "gpt-image-2"),
    size: stringValue(nested.size, "1024x1024"),
    ratio: stringValue(nested.ratio) || undefined,
    resolution: stringValue(nested.resolution) || undefined,
    quality: stringValue(nested.quality) || undefined,
    n: Math.max(1, Math.min(4, Number(nested.n) || 1)),
    mode,
    projectId: stringValue(nested.projectId, "inbox"),
    tags: tagsValue(nested.tags),
    createdAt: stringValue(nested.createdAt, new Date().toISOString()),
    sourceId: stringValue(nested.sourceId) || undefined,
    variationLabel: stringValue(nested.variationLabel) || undefined,
    seed: seedValue === undefined || seedValue === null || String(seedValue).trim() === ""
      ? undefined
      : String(seedValue),
    outpaint,
  };
}

export function composeImagePrompt(recipe: ImageRecipeV1) {
  const sections = [recipe.prompt.trim()];
  if (recipe.negativePrompt.trim()) {
    sections.push("必须避免以下内容或缺陷：" + recipe.negativePrompt.trim() + "。不要在画面中呈现这些元素。");
  }
  if (recipe.ratio) {
    sections.push(
      "构图要求：严格使用 " + recipe.ratio + " 画面比例（" + recipe.size +
      " 像素画布）进行原生构图；不要生成正方形或在生成后裁切；主体、文字和边缘内容必须完整适配画布。",
    );
  }
  return sections.filter(Boolean).join("\n\n");
}

