// localai 分片：本地 AI 工具箱（LocalAIToolbox / QuickModelSwitcher / localai.* code）。
export const localai = {
  "本地 AI 工具箱": "Local AI toolbox",

  // --- src/lib/local-ai.ts 校验 / 仿射错误（T23；key = 中文原文，逐调用求值） ---
  "图片尺寸无效": "Invalid image dimensions",
  "输出最长边 {n} px，超过 8192 px 限制": "The longest output edge is {n} px, exceeding the 8192 px limit",
  "输出约 {n} 百万像素，超过 7000 万像素限制": "The output is about {n} megapixels, exceeding the 70-megapixel limit",
  "至少需要三个匹配点": "At least three matching points are required",
  "人脸关键点无法对齐": "Face landmarks could not be aligned",
} as const;
