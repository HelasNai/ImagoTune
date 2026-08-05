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
  return /image|vision|multimodal|image_url|不支持图片|图片输入/i.test(body);
}

