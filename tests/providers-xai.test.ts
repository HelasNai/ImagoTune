import { describe, expect, it } from "vitest";
import { GenerationError } from "../electron/generation-error";
import { deriveXaiSizeHints, xaiImageAdapter } from "../electron/providers/xai-image";
import type { GenerateContext } from "../electron/providers/types";

const BASE_URL = "https://api.x.ai/v1";
const GENERATIONS_ENDPOINT = "https://api.x.ai/v1/images/generations";
const EDITS_ENDPOINT = "https://api.x.ai/v1/images/edits";
const SUCCESS_URL_BODY = JSON.stringify({ data: [{ url: "https://cdn.example/xai.png", mime_type: "image/png" }] });
const SUCCESS_B64_BODY = JSON.stringify({ data: [{ b64_json: "QUJD" }] });

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** 注入式 fake fetcher：记录收到的 URL 与 init，并返回固定响应体。 */
function makeFetcher(status: number, body: string) {
  const calls: RecordedCall[] = [];
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function makeCtx(over: Partial<GenerateContext> = {}): GenerateContext {
  return {
    baseUrl: BASE_URL,
    apiKey: "sk-test-key-123",
    model: "grok-imagine-image-2.0",
    prompt: "一只在草地上奔跑的柯基犬",
    ...over,
  };
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => String(key).toLowerCase() === name.toLowerCase());
    return hit ? hit[1] : undefined;
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? record[key] : undefined;
}

function bodyOf(call: RecordedCall): Record<string, any> {
  return JSON.parse(String(call.init?.body));
}

describe("xaiImageAdapter generate", () => {
  it("无参考图走 /images/generations：URL 精确、POST、头正确（含 baseUrl 尾斜杠）", async () => {
    for (const baseUrl of [BASE_URL, BASE_URL + "/"]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_URL_BODY);
      await xaiImageAdapter.generate(makeCtx({ baseUrl }), fetcher);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(GENERATIONS_ENDPOINT);
      expect(calls[0].init?.method).toBe("POST");
      expect(headerValue(calls[0].init, "Authorization")).toBe("Bearer sk-test-key-123");
      expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    }
  });

  it("有参考图走 /images/edits（JSON 非 multipart）且 image 字段映射为 {url,type}", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_URL_BODY);
    await xaiImageAdapter.generate(makeCtx({ reference: ["data:image/png;base64,AAA"] }), fetcher);

    expect(calls[0].url).toBe(EDITS_ENDPOINT);
    const body = bodyOf(calls[0]);
    expect(body.image).toEqual({ url: "data:image/png;base64,AAA", type: "image_url" });
    expect("aspect_ratio" in body).toBe(false);
  });

  it("文生图 body：size 1024x1024 推导 aspect_ratio 1:1 与 resolution 1k；size 缺省时两者皆不携带", async () => {
    const withSize = makeFetcher(200, SUCCESS_URL_BODY);
    await xaiImageAdapter.generate(makeCtx({ size: "1024x1024" }), withSize.fetcher);
    const body = bodyOf(withSize.calls[0]);
    expect(body.aspect_ratio).toBe("1:1");
    expect(body.resolution).toBe("1k");
    expect("size" in body).toBe(false);
    expect("quality" in body).toBe(false);

    const noSize = makeFetcher(200, SUCCESS_URL_BODY);
    await xaiImageAdapter.generate(makeCtx(), noSize.fetcher);
    const empty = bodyOf(noSize.calls[0]);
    expect("aspect_ratio" in empty).toBe(false);
    expect("resolution" in empty).toBe(false);
  });

  it("n 提供时透传：n=3 → body.n === 3；缺省时不携带 n", async () => {
    const withN = makeFetcher(200, SUCCESS_URL_BODY);
    await xaiImageAdapter.generate(makeCtx({ n: 3 }), withN.fetcher);
    expect(bodyOf(withN.calls[0]).n).toBe(3);

    const withoutN = makeFetcher(200, SUCCESS_URL_BODY);
    await xaiImageAdapter.generate(makeCtx(), withoutN.fetcher);
    expect("n" in bodyOf(withoutN.calls[0])).toBe(false);
  });

  it("成功解析 data[].url；data[].b64_json 同样可解析", async () => {
    const url = makeFetcher(200, SUCCESS_URL_BODY);
    await expect(xaiImageAdapter.generate(makeCtx(), url.fetcher)).resolves.toEqual([
      { url: "https://cdn.example/xai.png" },
    ]);

    const b64 = makeFetcher(200, SUCCESS_B64_BODY);
    await expect(xaiImageAdapter.generate(makeCtx(), b64.fetcher)).resolves.toEqual([{ b64_json: "QUJD" }]);
  });

  it("非 2xx（400）抛 GenerationError 且 info.status === 400", async () => {
    const { fetcher } = makeFetcher(400, JSON.stringify({ error: { message: "invalid" } }));

    await expect(xaiImageAdapter.generate(makeCtx(), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", status: 400 },
    });
  });

  it("HTTP 200 + error 体 → 仍抛 GenerationError，绝不当作成功", async () => {
    const { fetcher } = makeFetcher(200, JSON.stringify({ error: { code: "blocked", message: "moderation" } }));

    const error = await xaiImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
  });

  it("n 越界（0 与 11）拒绝为 parameters.imageCount 且零请求；n=10 通过", async () => {
    for (const n of [0, 11]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_URL_BODY);
      await expect(xaiImageAdapter.generate(makeCtx({ n }), fetcher)).rejects.toMatchObject({
        info: { category: "parameters", code: "parameters.imageCount", params: { max: "10" } },
      });
      expect(calls).toHaveLength(0);
    }

    const { fetcher, calls } = makeFetcher(200, SUCCESS_URL_BODY);
    await xaiImageAdapter.generate(makeCtx({ n: 10 }), fetcher);
    expect(calls).toHaveLength(1);
  });

  it("无法解析的响应 / 无任何图片数据 → response.invalid", async () => {
    const broken = makeFetcher(200, "not-json");
    const parseError = await xaiImageAdapter.generate(makeCtx(), broken.fetcher).catch((e) => e);
    expect((parseError as GenerationError).info.code).toBe("response.invalid");

    const noImage = makeFetcher(200, JSON.stringify({ data: [] }));
    const noImageError = await xaiImageAdapter.generate(makeCtx(), noImage.fetcher).catch((e) => e);
    expect((noImageError as GenerationError).info.code).toBe("response.invalid");
  });
});

describe("deriveXaiSizeHints", () => {
  it("整数比命中枚举时携带 aspect_ratio，resolution 按长边判定", () => {
    expect(deriveXaiSizeHints("1024x1024")).toEqual({ aspectRatio: "1:1", resolution: "1k" });
    expect(deriveXaiSizeHints("2048x1152")).toEqual({ aspectRatio: "16:9", resolution: "2k" });
    expect(deriveXaiSizeHints("1024x1536")).toEqual({ aspectRatio: "2:3", resolution: "2k" });
  });

  it("无法约分为枚举比例的尺寸省略 aspect_ratio，仅保留 resolution", () => {
    expect(deriveXaiSizeHints("1000x999")).toEqual({ resolution: "1k" });
  });

  it("resolution 边界：长边 1024 → 1k，1025 → 2k", () => {
    expect(deriveXaiSizeHints("1024x1024").resolution).toBe("1k");
    expect(deriveXaiSizeHints("1025x1024").resolution).toBe("2k");
  });

  it("缺省或畸形尺寸返回空对象，绝不猜测", () => {
    expect(deriveXaiSizeHints(undefined)).toEqual({});
    expect(deriveXaiSizeHints("abc")).toEqual({});
    expect(deriveXaiSizeHints("0x0")).toEqual({});
    expect(deriveXaiSizeHints("1024*1024")).toEqual({});
  });
});
