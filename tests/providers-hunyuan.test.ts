import { describe, expect, it } from "vitest";
import { GenerationError } from "../electron/generation-error";
import { hunyuanImageAdapter } from "../electron/providers/hunyuan-image";
import type { GenerateContext } from "../electron/providers/types";

const BASE_URL = "https://tokenhub.tencentmaas.com/v1";
const ENDPOINT = "https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v35-generation";

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
    model: "hy-image-v3.5-preview",
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

describe("hunyuanImageAdapter generate", () => {
  it("请求 URL 精确、方法为 POST、Authorization 与 Content-Type 头正确（含 baseUrl 尾斜杠）", async () => {
    for (const baseUrl of [BASE_URL, BASE_URL + "/"]) {
      const { fetcher, calls } = makeFetcher(200, JSON.stringify({ choices: [] }));
      await hunyuanImageAdapter
        .generate(makeCtx({ baseUrl }), fetcher)
        .catch(() => undefined);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(ENDPOINT);
      expect(calls[0].init?.method).toBe("POST");
      expect(headerValue(calls[0].init, "Authorization")).toBe("Bearer sk-test-key-123");
      expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    }
  });

  it("请求体形状：model 直传、messages 协议与参考图 dataURL 映射", async () => {
    const successBody = JSON.stringify({ choices: [{ delta: { image: { url: "https://cdn.example/x.png" } } }] });
    const { fetcher, calls } = makeFetcher(200, successBody);

    await hunyuanImageAdapter.generate(
      makeCtx({ reference: ["data:image/png;base64,AAA"] }),
      fetcher,
    );

    const body = bodyOf(calls[0]);
    expect(body.model).toBe("hy-image-v3.5-preview");
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "一只在草地上奔跑的柯基犬" });
    expect(body.messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA" },
    });
    // 未提供 size 时请求体不得携带 size 字段
    expect("size" in body).toBe(false);
  });

  it("成功解析 choices[0].delta.image.url 为 ApiImage[]", async () => {
    const { fetcher } = makeFetcher(
      200,
      JSON.stringify({ choices: [{ delta: { image: { url: "https://cdn.example/x.png" } } }] }),
    );

    await expect(hunyuanImageAdapter.generate(makeCtx(), fetcher)).resolves.toEqual([
      { url: "https://cdn.example/x.png" },
    ]);
  });

  it("HTTP 200 但 body 含 error 字段同样抛 GenerationError（ResourceUnavailable.InterfaceNotExist）", async () => {
    const { fetcher } = makeFetcher(
      200,
      JSON.stringify({ error: { code: "ResourceUnavailable.InterfaceNotExist" } }),
    );

    const error = await hunyuanImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    // 真实观测形态（200 + InterfaceNotExist）必须归类为 endpoint，而非 unknown
    expect((error as GenerationError).info.category).toBe("endpoint");
    expect((error as GenerationError).info.retryable).toBe(false);
  });

  it("HTTP 200 + error 字段但非接口不存在 → 仍抛 GenerationError（unknown），绝不当作成功", async () => {
    const { fetcher, calls } = makeFetcher(200, JSON.stringify({ error: { code: "SomeOtherError" } }));

    const error = await hunyuanImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).info.category).toBe("unknown");
    expect(calls).toHaveLength(1);
  });

  it("非 2xx（400 含 400004）抛 GenerationError 且 info.status === 400", async () => {
    const { fetcher } = makeFetcher(400, JSON.stringify({ code: 400004, message: "invalid" }));

    await expect(hunyuanImageAdapter.generate(makeCtx(), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", status: 400 },
    });
  });

  it("n > 1 拒绝为 parameters 且 fake fetcher 从未被调用（防重复计费）", async () => {
    const { fetcher, calls } = makeFetcher(200, JSON.stringify({ choices: [] }));

    await expect(hunyuanImageAdapter.generate(makeCtx({ n: 2 }), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", retryable: false },
    });
    expect(calls).toHaveLength(0);
  });

  it("size 哨兵：越界/畸形拒绝且不发出请求，合法尺寸逐字透传", async () => {
    for (const size of ["10000x10000", "100x100", "abc", "0x0", "-1x1024"]) {
      const { fetcher, calls } = makeFetcher(200, JSON.stringify({ choices: [] }));
      await expect(hunyuanImageAdapter.generate(makeCtx({ size }), fetcher)).rejects.toMatchObject({
        info: { category: "parameters" },
      });
      expect(calls).toHaveLength(0);
    }

    const { fetcher, calls } = makeFetcher(
      200,
      JSON.stringify({ choices: [{ delta: { image: { url: "https://cdn.example/x.png" } } }] }),
    );
    await hunyuanImageAdapter.generate(makeCtx({ size: "1024x1024" }), fetcher);
    expect(bodyOf(calls[0]).size).toBe("1024x1024");
  });
});
