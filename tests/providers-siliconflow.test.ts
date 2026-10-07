import { describe, expect, it } from "vitest";
import { GenerationError } from "../electron/generation-error";
import { siliconflowImageAdapter } from "../electron/providers/siliconflow-image";
import type { GenerateContext } from "../electron/providers/types";

const BASE_URL = "https://api.siliconflow.cn/v1";
const ENDPOINT = "https://api.siliconflow.cn/v1/images/generations";

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
    apiKey: "sk-siliconflow-test",
    model: "Qwen/Qwen-Image",
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

function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

const SUCCESS_BODY = JSON.stringify({
  images: [{ url: "https://cdn.example/a.png" }],
  timings: { inference: 3.14 },
  seed: 123456,
});

describe("siliconflowImageAdapter generate", () => {
  it("请求 URL 精确、方法为 POST、Authorization 与 Content-Type 头正确（含 baseUrl 尾斜杠）", async () => {
    for (const baseUrl of [BASE_URL, BASE_URL + "/"]) {
      const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);
      await siliconflowImageAdapter.generate(makeCtx({ baseUrl }), fetcher);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(ENDPOINT);
      expect(calls[0].init?.method).toBe("POST");
      expect(headerValue(calls[0].init, "Authorization")).toBe("Bearer sk-siliconflow-test");
      expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    }
  });

  it("请求体字段重命名：size→image_size、n→batch_size，绝不出现原名", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await siliconflowImageAdapter.generate(makeCtx({ size: "1024x1024", n: 2 }), fetcher);

    const body = bodyOf(calls[0]);
    expect(body.model).toBe("Qwen/Qwen-Image");
    expect(body.prompt).toBe("一只在草地上奔跑的柯基犬");
    expect(body.image_size).toBe("1024x1024");
    expect(body.batch_size).toBe(2);
    expect("size" in body).toBe(false);
    expect("n" in body).toBe(false);
  });

  it("缺省 n 时 batch_size 为 1；未提供 size 时请求体不携带 image_size", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await siliconflowImageAdapter.generate(makeCtx(), fetcher);

    const body = bodyOf(calls[0]);
    expect(body.batch_size).toBe(1);
    expect("image_size" in body).toBe(false);
    expect("image" in body).toBe(false);
  });

  it("参考图映射：reference[0]→image、reference[1]→image2、reference[2]→image3", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await siliconflowImageAdapter.generate(
      makeCtx({ reference: ["data:image/png;base64,AAA", "data:image/png;base64,BBB", "data:image/png;base64,CCC"] }),
      fetcher,
    );

    const body = bodyOf(calls[0]);
    expect(body.image).toBe("data:image/png;base64,AAA");
    expect(body.image2).toBe("data:image/png;base64,BBB");
    expect(body.image3).toBe("data:image/png;base64,CCC");
  });

  it("成功解析 images[].url 为 ApiImage[]（非 OpenAI 的 data[] 形状）", async () => {
    const two = JSON.stringify({ images: [{ url: "https://cdn.example/a.png" }, { url: "https://cdn.example/b.png" }] });
    const { fetcher, calls } = makeFetcher(200, two);

    const result = await siliconflowImageAdapter.generate(makeCtx({ n: 2 }), fetcher);

    // 响应只有 images 键（无 data），解析成功即证明走的是 images[].url 路径
    expect(two).toContain('"images"');
    expect(two).not.toContain('"data"');
    expect(result).toEqual([{ url: "https://cdn.example/a.png" }, { url: "https://cdn.example/b.png" }]);
    expect(calls).toHaveLength(1);
  });

  it("非 2xx（400）抛 GenerationError 且 info.status === 400", async () => {
    const { fetcher } = makeFetcher(400, JSON.stringify({ code: 20012, message: "Bad request data", data: "bad" }));

    await expect(siliconflowImageAdapter.generate(makeCtx(), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", status: 400 },
    });
  });

  it("HTTP 200 但 body 含 error 字段 → GenerationError，绝不当作成功", async () => {
    const { fetcher, calls } = makeFetcher(200, JSON.stringify({ error: { code: "SomeError" } }));

    const error = await siliconflowImageAdapter.generate(makeCtx(), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect(calls).toHaveLength(1);
  });

  it("n > 4 拒绝为 parameters/imageCount 且 fake fetcher 从未被调用（防重复计费）", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    const error = await siliconflowImageAdapter.generate(makeCtx({ n: 5 }), fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).info).toMatchObject({
      category: "parameters",
      code: "parameters.imageCount",
      retryable: false,
      params: { max: 4 },
    });
    expect(calls).toHaveLength(0);
  });

  it("n < 1 同样拒绝为 parameters/imageCount 且零请求", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await expect(siliconflowImageAdapter.generate(makeCtx({ n: 0 }), fetcher)).rejects.toMatchObject({
      info: { category: "parameters", code: "parameters.imageCount" },
    });
    expect(calls).toHaveLength(0);
  });

  it("n = 4 为合法上限，正常发出一次请求", async () => {
    const { fetcher, calls } = makeFetcher(200, SUCCESS_BODY);

    await siliconflowImageAdapter.generate(makeCtx({ n: 4 }), fetcher);

    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0]).batch_size).toBe(4);
  });

  it("无法解析的响应与缺少 images 的响应均抛 response.invalid", async () => {
    const broken = makeFetcher(200, "not-json");
    const parseError = await siliconflowImageAdapter.generate(makeCtx(), broken.fetcher).catch((e) => e);
    expect((parseError as GenerationError).info.code).toBe("response.invalid");

    const noImages = makeFetcher(200, JSON.stringify({ timings: { inference: 1 } }));
    const urlError = await siliconflowImageAdapter.generate(makeCtx(), noImages.fetcher).catch((e) => e);
    expect((urlError as GenerationError).info.code).toBe("response.invalid");

    const emptyImages = makeFetcher(200, JSON.stringify({ images: [] }));
    const emptyError = await siliconflowImageAdapter.generate(makeCtx(), emptyImages.fetcher).catch((e) => e);
    expect((emptyError as GenerationError).info.code).toBe("response.invalid");
  });

  it("畸形尺寸拒绝为 parameters.size 且零请求；合法尺寸逐字透传为 image_size", async () => {
    const bad = makeFetcher(200, SUCCESS_BODY);
    await expect(siliconflowImageAdapter.generate(makeCtx({ size: "abc" }), bad.fetcher)).rejects.toMatchObject({
      info: { category: "parameters", code: "parameters.size" },
    });
    expect(bad.calls).toHaveLength(0);

    const good = makeFetcher(200, SUCCESS_BODY);
    await siliconflowImageAdapter.generate(makeCtx({ size: "1328x1328" }), good.fetcher);
    expect(bodyOf(good.calls[0]).image_size).toBe("1328x1328");
  });
});
