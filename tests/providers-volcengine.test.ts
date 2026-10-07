import { describe, expect, it } from "vitest";
import { GenerationError } from "../electron/generation-error";
import type { GenerateContext } from "../electron/providers/types";
import { volcengineImageAdapter } from "../electron/providers/volcengine-image";

const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";

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
    model: "doubao-seedream-4-5-251128",
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

describe("volcengineImageAdapter generate", () => {
  it("请求 URL 精确、方法为 POST、Authorization 与 Content-Type 头正确（含 baseUrl 尾斜杠）", async () => {
    for (const baseUrl of [BASE_URL, BASE_URL + "/"]) {
      const { fetcher, calls } = makeFetcher(200, JSON.stringify({ data: [] }));
      await volcengineImageAdapter
        .generate(makeCtx({ baseUrl }), fetcher)
        .catch(() => undefined);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(ENDPOINT);
      expect(calls[0].init?.method).toBe("POST");
      expect(headerValue(calls[0].init, "Authorization")).toBe("Bearer sk-test-key-123");
      expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    }
  });

  it("请求体形状：model/prompt 直传；未提供 size 时不携带 size；参考图映射为 image 数组", async () => {
    const successBody = JSON.stringify({ data: [{ url: "https://cdn.example/x.png" }] });
    const { fetcher, calls } = makeFetcher(200, successBody);

    await volcengineImageAdapter.generate(
      makeCtx({ reference: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"] }),
      fetcher,
    );

    const body = bodyOf(calls[0]);
    expect(body.model).toBe("doubao-seedream-4-5-251128");
    expect(body.prompt).toBe("一只在草地上奔跑的柯基犬");
    expect(body.image).toEqual(["data:image/png;base64,AAA", "data:image/png;base64,BBB"]);
    // 未提供 size 时请求体不得携带 size 字段；无 n 字段（官方协议无此字段）
    expect("size" in body).toBe(false);
    expect("n" in body).toBe(false);
  });

  it("无参考图时请求体不携带 image 字段", async () => {
    const { fetcher, calls } = makeFetcher(200, JSON.stringify({ data: [{ url: "https://cdn.example/x.png" }] }));

    await volcengineImageAdapter.generate(makeCtx(), fetcher);

    expect("image" in bodyOf(calls[0])).toBe(false);
  });

  it("成功解析 data[0].url 为 ApiImage[]", async () => {
    const { fetcher } = makeFetcher(
      200,
      JSON.stringify({
        model: "doubao-seedream-4-5-251128",
        created: 1757321139,
        data: [{ url: "https://cdn.example/x.png", size: "2048x2048", output_format: "jpeg" }],
        usage: { generated_images: 1 },
      }),
    );

    await expect(volcengineImageAdapter.generate(makeCtx(), fetcher)).resolves.toEqual([
      { url: "https://cdn.example/x.png" },
    ]);
  });

  it("成功解析 data[0].b64_json 为 ApiImage[]（url 缺失时回落）", async () => {
    const { fetcher } = makeFetcher(200, JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));

    await expect(volcengineImageAdapter.generate(makeCtx(), fetcher)).resolves.toEqual([
      { b64_json: "aGVsbG8=" },
    ]);
  });

  it("url 优先于 b64_json；无图元素被跳过", async () => {
    const { fetcher } = makeFetcher(
      200,
      JSON.stringify({
        data: [
          { url: "https://cdn.example/x.png", b64_json: "aGVsbG8=" },
          { error: { code: "ContentFiltered" } },
        ],
      }),
    );

    await expect(volcengineImageAdapter.generate(makeCtx(), fetcher)).resolves.toEqual([
      { url: "https://cdn.example/x.png" },
    ]);
  });

  it("非 2xx（400）抛 GenerationError 且 info.status === 400", async () => {
    const { fetcher } = makeFetcher(400, JSON.stringify({ error: { code: "InvalidParameter", message: "invalid" } }));

    await expect(volcengineImageAdapter.generate(makeCtx(), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", status: 400 },
    });
  });

  it("HTTP 200 但 body 含 error 字段同样抛 GenerationError，绝不当作成功", async () => {
    const { fetcher, calls } = makeFetcher(
      200,
      JSON.stringify({ error: { code: "SomeInternalError", message: "boom" } }),
    );

    const error = await volcengineImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).info.category).toBe("unknown");
    expect(calls).toHaveLength(1);
  });

  it("n > 1 拒绝为 parameters/imageCount 且 fake fetcher 从未被调用（防重复计费）", async () => {
    const { fetcher, calls } = makeFetcher(200, JSON.stringify({ data: [] }));

    await expect(volcengineImageAdapter.generate(makeCtx({ n: 2 }), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", retryable: false, code: "parameters.imageCount", params: { max: "1" } },
    });
    expect(calls).toHaveLength(0);
  });

  it("size 哨兵：明显畸形拒绝且不发出请求，合法档位与尺寸逐字透传", async () => {
    for (const size of ["abc", "0x0", "-1x1024", "5K", "1.5K", "1024"]) {
      const { fetcher, calls } = makeFetcher(200, JSON.stringify({ data: [] }));
      await expect(volcengineImageAdapter.generate(makeCtx({ size }), fetcher)).rejects.toMatchObject({
        info: { category: "parameters", code: "parameters.size" },
      });
      expect(calls).toHaveLength(0);
    }

    for (const size of ["2K", "4k", "2048x2048"]) {
      const { fetcher, calls } = makeFetcher(200, JSON.stringify({ data: [{ url: "https://cdn.example/x.png" }] }));
      await volcengineImageAdapter.generate(makeCtx({ size }), fetcher);
      expect(bodyOf(calls[0]).size).toBe(size);
    }
  });

  it("无法解析的响应与缺少图片数据 → response.invalid", async () => {
    const broken = makeFetcher(200, "not-json");
    const parseError = await volcengineImageAdapter.generate(makeCtx(), broken.fetcher).catch((e) => e);
    expect((parseError as GenerationError).info.code).toBe("response.invalid");

    const noImage = makeFetcher(200, JSON.stringify({ data: [] }));
    const imageError = await volcengineImageAdapter.generate(makeCtx(), noImage.fetcher).catch((e) => e);
    expect((imageError as GenerationError).info.code).toBe("response.invalid");

    const noData = makeFetcher(200, JSON.stringify({ model: "doubao-seedream-4-5-251128", created: 1 }));
    const dataError = await volcengineImageAdapter.generate(makeCtx(), noData.fetcher).catch((e) => e);
    expect((dataError as GenerationError).info.code).toBe("response.invalid");
  });
});
