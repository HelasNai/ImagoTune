import { describe, expect, it } from "vitest";
import { GenerationError } from "../electron/generation-error";
import { openRouterImageAdapter } from "../electron/providers/openrouter-image";
import type { GenerateContext } from "../electron/providers/types";

const BASE_URL = "https://openrouter.ai/api/v1";
const ENDPOINT = "https://openrouter.ai/api/v1/images";
const SUCCESS_BODY = JSON.stringify({ created: 1, data: [{ b64_json: "QUJD", media_type: "image/png" }] });

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
    model: "bytedance-seed/seedream-4.5",
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

describe("openRouterImageAdapter generate", () => {
  it("端点必须是 /images（不是 /images/generations）：URL 精确、POST、头正确（含 baseUrl 尾斜杠）", async () => {
    for (const baseUrl of [BASE_URL, BASE_URL + "/"]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await openRouterImageAdapter.generate(makeCtx({ baseUrl }), fetcher);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(ENDPOINT);
      expect(calls[0].url.endsWith("/images/generations")).toBe(false);
      expect(calls[0].init?.method).toBe("POST");
      expect(headerValue(calls[0].init, "Authorization")).toBe("Bearer sk-test-key-123");
      expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    }
  });

  it("请求体：model/prompt 必发；size 逐字透传且不发送 resolution/aspect_ratio（防 400 冲突）", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await openRouterImageAdapter.generate(makeCtx({ size: "2048x2048" }), fetcher);

    const body = bodyOf(calls[0]);
    expect(body.model).toBe("bytedance-seed/seedream-4.5");
    expect(body.prompt).toBe("一只在草地上奔跑的柯基犬");
    expect(body.size).toBe("2048x2048");
    expect("resolution" in body).toBe(false);
    expect("aspect_ratio" in body).toBe(false);
    expect("n" in body).toBe(false);
  });

  it("n 提供时透传（n=3 → body.n === 3）", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await openRouterImageAdapter.generate(makeCtx({ n: 3 }), fetcher);
    expect(bodyOf(calls[0]).n).toBe(3);
  });

  it("参考图映射为 input_references 数组（{type,image_url:{url}}）", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await openRouterImageAdapter.generate(
      makeCtx({ reference: ["data:image/png;base64,AAA", "https://cdn.example/ref.jpg"] }),
      fetcher,
    );

    expect(bodyOf(calls[0]).input_references).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      { type: "image_url", image_url: { url: "https://cdn.example/ref.jpg" } },
    ]);
  });

  it("成功解析 data[].b64_json 为 ApiImage[]（响应无 url 字段）", async () => {
    const { fetcher } = makeFetcher(200, SUCCESS_BODY);

    await expect(openRouterImageAdapter.generate(makeCtx(), fetcher)).resolves.toEqual([{ b64_json: "QUJD" }]);
  });

  it("非 2xx（400）抛 GenerationError 且 info.status === 400", async () => {
    const { fetcher } = makeFetcher(400, JSON.stringify({ error: { code: 400, message: "Invalid request parameters" } }));

    await expect(openRouterImageAdapter.generate(makeCtx(), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", status: 400 },
    });
  });

  it("HTTP 200 + error 体 → 仍抛 GenerationError，绝不当作成功", async () => {
    const { fetcher } = makeFetcher(200, JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }));

    const error = await openRouterImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
  });

  it("n 越界（0 与 11）拒绝为 parameters.imageCount 且零请求；n=10 通过", async () => {
    for (const n of [0, 11]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await expect(openRouterImageAdapter.generate(makeCtx({ n }), fetcher)).rejects.toMatchObject({
        info: { category: "parameters", code: "parameters.imageCount", params: { max: "10" } },
      });
      expect(calls).toHaveLength(0);
    }

    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await openRouterImageAdapter.generate(makeCtx({ n: 10 }), fetcher);
    expect(calls).toHaveLength(1);
  });

  it("无法解析的响应 / 无 b64_json → response.invalid", async () => {
    const broken = makeFetcher(200, "not-json");
    const parseError = await openRouterImageAdapter.generate(makeCtx(), broken.fetcher).catch((e) => e);
    expect((parseError as GenerationError).info.code).toBe("response.invalid");

    const noImage = makeFetcher(200, JSON.stringify({ data: [{ url: "https://cdn.example/only-url.png" }] }));
    const noImageError = await openRouterImageAdapter.generate(makeCtx(), noImage.fetcher).catch((e) => e);
    expect((noImageError as GenerationError).info.code).toBe("response.invalid");
  });
});
