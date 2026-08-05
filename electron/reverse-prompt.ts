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
