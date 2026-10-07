import { describe, expect, it } from "vitest";
import { GenerationError } from "../electron/generation-error";
import { dashscopeImageAdapter } from "../electron/providers/dashscope-image";
import type { GenerateContext } from "../electron/providers/types";

const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations";

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
    model: "qwen-image-3.0-pro",
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

const SUCCESS_BODY = JSON.stringify({
  created: 1788339600,
  data: [{ url: "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/x.png" }],
});

describe("dashscopeImageAdapter generate", () => {
  it("请求 URL 精确、方法为 POST、Authorization 与 Content-Type 头正确（含 baseUrl 尾斜杠）", async () => {
    for (const baseUrl of [BASE_URL, BASE_URL + "/"]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await dashscopeImageAdapter
        .generate(makeCtx({ baseUrl }), fetcher)
        .catch(() => undefined);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(ENDPOINT);
      expect(calls[0].init?.method).toBe("POST");
      expect(headerValue(calls[0].init, "Authorization")).toBe("Bearer sk-test-key-123");
      expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    }
  });

  it("请求体形状：model/prompt/n 平铺顶层、size 逐字透传、绝不发送 response_format", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await dashscopeImageAdapter.generate(makeCtx({ size: "1024x1024", n: 2 }), fetcher);

    const body = bodyOf(calls[0]);
    expect(body.model).toBe("qwen-image-3.0-pro");
    expect(body.prompt).toBe("一只在草地上奔跑的柯基犬");
    expect(body.size).toBe("1024x1024");
    expect(body.n).toBe(2);
    expect("response_format" in body).toBe(false);
    // 未提供参考图时请求体不得携带 image 字段
    expect("image" in body).toBe(false);
  });

  it("size 缺省时不带该键；\"auto\" 逐字透传", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await dashscopeImageAdapter.generate(makeCtx(), fetcher);
    expect("size" in bodyOf(calls[0])).toBe(false);

    const auto = makeFetcher(200, SUCCESS_BODY);
    await dashscopeImageAdapter.generate(makeCtx({ size: "auto" }), auto.fetcher);
    expect(bodyOf(auto.calls[0]).size).toBe("auto");
  });

  it("参考图映射：单张为字符串、多张为字符串数组（顶层 image 字段，同一端点）", async () => {
    const single = makeFetcher(200, SUCCESS_BODY);
    await dashscopeImageAdapter.generate(makeCtx({ reference: ["data:image/png;base64,AAA"] }), single.fetcher);
    expect(bodyOf(single.calls[0]).image).toBe("data:image/png;base64,AAA");

    const multi = makeFetcher(200, SUCCESS_BODY);
    await dashscopeImageAdapter.generate(
      makeCtx({ reference: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"] }),
      multi.fetcher,
    );
    expect(bodyOf(multi.calls[0]).image).toEqual(["data:image/png;base64,AAA", "data:image/png;base64,BBB"]);
  });

  it("成功解析 data[].url 为 ApiImage[]（多图全部返回）", async () => {
    const { fetcher } = makeFetcher(
      200,
      JSON.stringify({
        created: 1788339600,
        data: [
          { url: "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/a.png" },
          { url: "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/b.png" },
        ],
        usage: { output_image_count: 2 },
      }),
    );

    await expect(dashscopeImageAdapter.generate(makeCtx({ n: 2 }), fetcher)).resolves.toEqual([
      { url: "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/a.png" },
      { url: "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/b.png" },
    ]);
  });

  it("非 2xx（400 参数非法）抛 GenerationError 且 info.status === 400", async () => {
    const { fetcher } = makeFetcher(
      400,
      JSON.stringify({ error: { message: "invalid size", type: "invalid_request_error", param: "size", code: null } }),
    );

    await expect(dashscopeImageAdapter.generate(makeCtx(), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", status: 400 },
    });
  });

  it("HTTP 200 但 body 含 error 字段同样抛 GenerationError，绝不当作成功", async () => {
    const { fetcher, calls } = makeFetcher(
      200,
      JSON.stringify({ error: { message: "Incorrect API key provided.", type: "invalid_request_error", code: "invalid_api_key" } }),
    );

    const error = await dashscopeImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect(calls).toHaveLength(1);
  });

  it("n=0 与 n=7 拒绝为 parameters.imageCount 且 fake fetcher 从未被调用（防重复计费）", async () => {
    for (const n of [0, 7]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await expect(dashscopeImageAdapter.generate(makeCtx({ n }), fetcher)).rejects.toMatchObject({
        info: { category: "parameters", retryable: false, code: "parameters.imageCount", params: { max: "6" } },
      });
      expect(calls).toHaveLength(0);
    }
  });

  it("n=6（上限边界）正常发出请求", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
    await dashscopeImageAdapter.generate(makeCtx({ n: 6 }), fetcher);
    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0]).n).toBe(6);
  });

  it("size 畸形串拒绝为 parameters.size 且零请求", async () => {
    for (const size of ["abc", "1024*1024", "0x0", "1024"]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await expect(dashscopeImageAdapter.generate(makeCtx({ size }), fetcher)).rejects.toMatchObject({
        info: { category: "parameters", code: "parameters.size" },
      });
      expect(calls).toHaveLength(0);
    }
  });

  it("无法解析的响应 → response.invalid；data 为空或无 url → response.invalid", async () => {
    const broken = makeFetcher(200, "not-json");
    const parseError = await dashscopeImageAdapter.generate(makeCtx(), broken.fetcher).catch((e) => e);
    expect((parseError as GenerationError).info.code).toBe("response.invalid");

    const emptyData = makeFetcher(200, JSON.stringify({ created: 1788339600, data: [] }));
    const emptyError = await dashscopeImageAdapter.generate(makeCtx(), emptyData.fetcher).catch((e) => e);
    expect((emptyError as GenerationError).info.code).toBe("response.invalid");

    const noUrl = makeFetcher(200, JSON.stringify({ created: 1788339600, data: [{ b64_json: null }] }));
    const urlError = await dashscopeImageAdapter.generate(makeCtx(), noUrl.fetcher).catch((e) => e);
    expect((urlError as GenerationError).info.code).toBe("response.invalid");
  });
});
