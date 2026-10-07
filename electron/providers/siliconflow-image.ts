// SiliconFlow 生图适配器：标准 /images/generations 端点，但字段与响应形状非 OpenAI 协议。
// 纯逻辑、无 electron / Node 副作用，fetcher 可注入，供 vitest 直接导入。
// 关键差异（见 docs/spec 汇总）：请求体 `size`→`image_size`、`n`→`batch_size`（范围 1–4）；
// 成功响应为 `{ images: [{ url }], timings?, seed? }`（非 `data[]`），URL 有效期 1 小时。
// 错误体形态不一（JSON `{code,message,data}` 或纯字符串如 "Invalid token"），
// 统一交 classifyHttpError(status, text) 归类。
// 不实现 listModels（平台级 /v1/models 可用）。

import type { ApiImage } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const ENDPOINT = "/images/generations";
const MAX_BATCH = 4;

function parameterError(message: string, details: string | undefined, code: "parameters.imageCount" | "parameters.size"): GenerationError {
  return new GenerationError({
    category: "parameters",
    title: "生成参数不兼容",
    message,
    suggestion: "请调整参数后重试；软件不会自动重复生成。",
    retryable: false,
    details,
    code,
  });
}

function imageCountError(n: number): GenerationError {
  const error = parameterError("该平台单次最多生成 4 张图片。", `batch_size=${n}`, "parameters.imageCount");
  error.info.params = { max: MAX_BATCH };
  return error;
}

function invalidResponseError(message: string, text: string): GenerationError {
  return new GenerationError({
    category: "unknown",
    title: "生成请求失败",
    message,
    suggestion: "查看详情并检查当前参数后再提交。",
    retryable: false,
    details: text.replace(/\s+/g, " ").trim().slice(0, 800),
    code: "response.invalid",
  });
}

/** 宽松尺寸哨兵：仅挡明显畸形串（合法值逐字透传为 image_size，不做缩放）。 */
function assertSize(size: string): void {
  if (!/^(\d+)x(\d+)$/i.exec(size.trim())) {
    throw parameterError("该平台不支持所选尺寸。", size, "parameters.size");
  }
}

/** 读取 images[].url（SiliconFlow 成功响应的非 OpenAI 形状）。 */
function extractImageUrls(payload: unknown): string[] {
  const images = (payload as { images?: unknown } | null)?.images;
  if (!Array.isArray(images)) return [];
  return images
    .map((item) => (item as { url?: unknown } | null)?.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

export const siliconflowImageAdapter: ProviderAdapter = {
  api: "siliconflow-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // 张数哨兵：batch_size 范围 1–4，越界在发请求前拒绝（零请求 = 防重复计费）。
    const n = ctx.n ?? 1;
    if (n < 1 || n > MAX_BATCH) {
      throw imageCountError(n);
    }

    if (ctx.size !== undefined) {
      assertSize(ctx.size);
    }

    // 图生图：reference[0]→image、reference[1]→image2、reference[2]→image3。
    // 注意：image2/image3 多图编辑按官方文档仅 Qwen/Qwen-Image-Edit-2509 支持（待实测）；
    // 其余模型带 image2/image3 的行为未验证，由服务端报错兜底。
    const reference = ctx.reference ?? [];
    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
      batch_size: n,
    };
    if (ctx.size !== undefined) {
      body.image_size = ctx.size;
    }
    if (reference[0] !== undefined) body.image = reference[0];
    if (reference[1] !== undefined) body.image2 = reference[1];
    if (reference[2] !== undefined) body.image3 = reference[2];

    const response = await fetcher(joinBase(ctx.baseUrl, ENDPOINT), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    const text = await response.text();

    // 非 2xx：错误体可能是 JSON（{code,message,data}）或纯字符串，统一分类。
    if (!response.ok) {
      throw new GenerationError(classifyHttpError(response.status, text));
    }

    // 防御：HTTP 200 也可能带错误体（{error:...} 形态），绝不当作成功。
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw invalidResponseError("接口返回了无法解析的响应。", text);
    }
    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      throw new GenerationError(classifyHttpError(200, text));
    }

    const urls = extractImageUrls(payload);
    if (urls.length === 0) {
      throw invalidResponseError("接口未返回图片地址。", text);
    }

    // 只返回 ApiImage[]；URL 有效期 1 小时，下载/转存交上层 materializeImageResponse。
    return urls.map((url) => ({ url }));
  },
};
