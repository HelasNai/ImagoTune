import { createRecipe } from "../lib/creative";
import { modeLabel } from "../lib/format";

export function recipeFromQueueInput(input: Record<string, unknown>, kind: "generate" | "edit", fallbackSize: string): ImageRecipeV1 {
  if (input.recipe && typeof input.recipe === "object") return input.recipe as ImageRecipeV1;
  return createRecipe({
    prompt: String(input.userPrompt || input.prompt || ""),
    negativePrompt: String(input.negativePrompt || ""),
    model: input.model ? String(input.model) : undefined,
    size: String(input.size || fallbackSize),
    ratio: typeof input.ratio === "string" ? input.ratio : undefined,
    resolution: typeof input.resolution === "string" ? input.resolution : undefined,
    quality: typeof input.quality === "string" ? input.quality : undefined,
    n: Number(input.n) || 1,
    mode: kind,
    projectId: input.projectId ? String(input.projectId) : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    sourceId: typeof input.sourceId === "string" ? input.sourceId : undefined,
    variationLabel: typeof input.variationLabel === "string" ? input.variationLabel : undefined,
    referenceCount: Number(input.referenceCount) || undefined,
  });
}

export function recipeModeLabel(recipe: ImageRecipeV1) {
  return modeLabel(recipe, { referenceAware: true });
}
