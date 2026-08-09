export type ImageResponse = { b64_json?: string; url?: string; seed?: string | number };

function rawBase64(value: string) {
  return value.replace(/^data:image\/[^;]+;base64,/i, "").trim();
}

function keyOf(image: ImageResponse) {
  if (image.b64_json) return "b64:" + rawBase64(image.b64_json);
  if (image.url) return "url:" + image.url.trim();
  return "";
}

/** Prefer durable Base64 results over transient URLs from progress events. */
export function prioritizeImageResponses(images: ImageResponse[], count: number) {
  const ordered = [
    ...images.filter((image) => Boolean(image.b64_json)),
    ...images.filter((image) => !image.b64_json && Boolean(image.url)),
  ];
  const seen = new Set<string>();
  return ordered.filter((image) => {
    const key = keyOf(image);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(0, count));
}

export function normalizeImageBase64(value: string) {
  return rawBase64(value);
}
