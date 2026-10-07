export function parseReversePrompt(content: string) {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(clean) as { zh?: unknown; en?: unknown };
    const zh = typeof value.zh === "string" ? value.zh.trim() : "";
    const en = typeof value.en === "string" ? value.en.trim() : "";
    if (zh || en) return { zh, en };
  } catch {}
  const zhMatch = /(?:中文|zh)\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:英文|en)\s*[:：]|$)/i.exec(clean);
  const enMatch = /(?:英文|en)\s*[:：]\s*([\s\S]*)/i.exec(clean);
  return { zh: zhMatch?.[1]?.trim() || clean, en: enMatch?.[1]?.trim() || "" };
}

export function isVisionInputUnsupported(body: string) {
  return /(does not support|not supported|unsupported|unknown content type).{0,80}(image|vision|multimodal|image_url)|(image|vision|multimodal|image_url).{0,80}(does not support|not supported|unsupported)|不支持.{0,20}(图片|图像|多模态)|(图片|图像)输入.{0,20}不支持/i.test(body);
}

// 反推响应缺少可用 content 时的错误文案。推理型视觉模型（如 deepseek-flash）把思维链 token
// 计入 max_tokens，额度被推理耗尽时 finish_reason 为 "length"、content 为空或残缺——
// 据此区分「输出被截断」与「模型异常」，给出可操作提示而非含糊的「没有返回提示词」。
export function reverseContentError(finishReason: string | undefined) {
  return finishReason === "length"
    ? "图反推输出被截断（模型推理过长），请重试或更换模型。"
    : "图反推没有返回提示词";
}
