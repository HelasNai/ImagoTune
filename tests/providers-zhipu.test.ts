import { describe, expect, it } from "vitest";
import { GenerationError } from "../electron/generation-error";
import { zhipuImageAdapter } from "../electron/providers/zhipu-image";
import type { GenerateContext } from "../electron/providers/types";

const BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/images/generations";
const SUCCESS_BODY = JSON.stringify({ created: 1, data: [{ url: "https://cdn.example/zhipu.png" }] });

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
    model: "glm-image",
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

describe("zhipuImageAdapter generate", () => {
  it("请求 URL 精确、方法为 POST、Authorization 与 Content-Type 头正确（含 baseUrl 尾斜杠）", async () => {
    for (const baseUrl of [BASE_URL, BASE_URL + "/"]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await zhipuImageAdapter.generate(makeCtx({ baseUrl }), fetcher);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(ENDPOINT);
      expect(calls[0].init?.method).toBe("POST");
      expect(headerValue(calls[0].init, "Authorization")).toBe("Bearer sk-test-key-123");
      expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    }
  });

  it("请求体只发 model/prompt/size：不携带 n/quality/response_format/reference 等字段", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await zhipuImageAdapter.generate(makeCtx({ size: "1280x1280" }), fetcher);

    const body = bodyOf(calls[0]);
    expect(body).toEqual({ model: "glm-image", prompt: "一只在草地上奔跑的柯基犬", size: "1280x1280" });
    expect("quality" in body).toBe(false);
    expect("n" in body).toBe(false);
    expect("response_format" in body).toBe(false);
    expect("seed" in body).toBe(false);
    expect("negative_prompt" in body).toBe(false);
  });

  it("成功解析 data[].url 为 ApiImage[]（多条目完整映射）", async () => {
    const { fetcher } = makeFetcher(
      200,
      JSON.stringify({ created: 1, data: [{ url: "https://cdn.example/a.png" }, { url: "https://cdn.example/b.png" }] }),
    );

    await expect(zhipuImageAdapter.generate(makeCtx(), fetcher)).resolves.toEqual([
      { url: "https://cdn.example/a.png" },
      { url: "https://cdn.example/b.png" },
    ]);
  });

  it("HTTP 200 + error 体（含不存在文案）→ endpoint/http.notFound", async () => {
    const { fetcher } = makeFetcher(200, JSON.stringify({ error: { code: "1211", message: "模型不存在" } }));

    const error = await zhipuImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).info.category).toBe("endpoint");
    expect((error as GenerationError).info.code).toBe("http.notFound");
    expect((error as GenerationError).info.retryable).toBe(false);
  });

  it("HTTP 200 + error 体但非接口不存在 → 仍抛 GenerationError（unknown），绝不当作成功", async () => {
    const { fetcher } = makeFetcher(200, JSON.stringify({ error: { code: "1301", message: "content filtered" } }));

    const error = await zhipuImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).info.category).not.toBe("parameters");
  });

  it("无法解析的响应 → response.invalid；缺少图片地址 → response.invalid", async () => {
    const broken = makeFetcher(200, "not-json");
    const parseError = await zhipuImageAdapter.generate(makeCtx(), broken.fetcher).catch((e) => e);
    expect((parseError as GenerationError).info.code).toBe("response.invalid");

    const noUrl = makeFetcher(200, JSON.stringify({ data: [] }));
    const urlError = await zhipuImageAdapter.generate(makeCtx(), noUrl.fetcher).catch((e) => e);
    expect((urlError as GenerationError).info.code).toBe("response.invalid");
  });

  it("非 2xx（400 含错误码）抛 GenerationError 且 info.status === 400", async () => {
    const { fetcher } = makeFetcher(400, JSON.stringify({ error: { code: "1213", message: "missing field" } }));

    await expect(zhipuImageAdapter.generate(makeCtx(), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", status: 400 },
    });
  });

  it("n > 1 拒绝为 parameters.imageCount 且 fake fetcher 从未被调用（防重复计费）", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await expect(zhipuImageAdapter.generate(makeCtx({ n: 2 }), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", retryable: false, code: "parameters.imageCount", params: { max: "1" } },
    });
    expect(calls).toHaveLength(0);
  });

  it("携带参考图拒绝为 parameters.referenceUnsupported 且零请求", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await expect(
      zhipuImageAdapter.generate(makeCtx({ reference: ["data:image/png;base64,AAA"] }), fetcher),
    ).rejects.toMatchObject({
      info: { category: "parameters", code: "parameters.referenceUnsupported" },
    });
    expect(calls).toHaveLength(0);
  });

  it("size 哨兵：畸形/越界拒绝且不发出请求，合法尺寸逐字透传", async () => {
    for (const size of ["abc", "0x0", "1024*1024", "10000x10000", "8192x8192"]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await expect(zhipuImageAdapter.generate(makeCtx({ size }), fetcher)).rejects.toMatchObject({
        info: { category: "parameters", code: "parameters.size" },
      });
      expect(calls).toHaveLength(0);
    }

    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await zhipuImageAdapter.generate(makeCtx({ size: "1280x1280" }), fetcher);
    expect(bodyOf(calls[0]).size).toBe("1280x1280");
  });
});
