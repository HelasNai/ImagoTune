// 火山方舟（Volcengine Ark / ByteDance Seedream）生图适配器：标准 REST 端点，但请求体/响应体与 openai 默认路径有差异。
// 纯逻辑、无 electron / Node 副作用，fetcher 可注入，供 vitest 直接导入。
// 契约：官方请求体无 `n`（批量靠 sequential_image_generation，v1 不支持）→ 单张限制发请求前显式拒绝；
// 图生图复用同一 /images/generations 端点的 image 字段（非独立 edits 端点），image 接受 URL 或 dataURL 数组；
// size 逐字透传（"1K"/"2K"/"3K"/"4K" 或 "WxH"），仅哨兵拦截明显畸形，绝不缩放。
// 不实现 listModels（平台级 /api/v3/models 可用，测试连接统一走它）。

import type { ApiImage, GenerationErrorCode } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const ENDPOINT = "/images/generations";

function parameterError(message: string, details: string | undefined, code: GenerationErrorCode): GenerationError {
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

function unknownError(message: string, details: string | undefined, code: GenerationErrorCode): GenerationError {
  return new GenerationError({
    category: "unknown",
    title: "生成请求失败",
    message,
    suggestion: "查看详情并检查当前参数后再提交。",
    retryable: false,
    details,
    code,
  });
}

/** 尺寸哨兵：仅放行档位串 "1K"/"2K"/"3K"/"4K" 或正整数 "WxH"；明显畸形一律抛 parameters，绝不透传。 */
function assertSize(size: string): void {
  const trimmed = size.trim();
  if (/^[1-4]K$/i.test(trimmed)) {
    return;
  }
  const match = /^(\d+)x(\d+)$/i.exec(trimmed);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw parameterError("该平台不支持所选尺寸。", size, "parameters.size");
  }
}

/** 读取 data[] 中每个元素的图片数据：url 优先，其次 b64_json；跳过两者皆缺的元素（组图中单张失败的情形）。 */
function extractImages(payload: unknown): ApiImage[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const images: ApiImage[] = [];
  for (const item of data) {
    const entry = item as { url?: unknown; b64_json?: unknown } | null;
    if (typeof entry?.url === "string" && entry.url.length > 0) {
      images.push({ url: entry.url });
    } else if (typeof entry?.b64_json === "string" && entry.b64_json.length > 0) {
      images.push({ b64_json: entry.b64_json });
    }
  }
  return images;
}

export const volcengineImageAdapter: ProviderAdapter = {
  api: "volcengine-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // 官方请求体没有 `n` 字段：多张限制在发请求之前显式拒绝，绝不静默降级或循环多张（防重复计费）。
    const n = ctx.n ?? 1;
    if (n > 1) {
      throw new GenerationError({
        category: "parameters",
        title: "单张限制",
        message: "该平台单次生成一张图片。",
        suggestion: "请将张数调整为 1 后再提交。",
        retryable: false,
        params: { max: "1" },
        code: "parameters.imageCount",
      });
    }

    // size 直传前哨兵校验：明显畸形一律拒绝，合法值逐字透传（各模型尺寸范围不同，交给服务端判定）。
    if (ctx.size !== undefined) {
      assertSize(ctx.size);
    }

    const reference = ctx.reference ?? [];
    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
    };
    if (ctx.size !== undefined) {
      body.size = ctx.size;
    }
    // 图生图路径：同一 /images/generations 端点的 image 字段，Ark 接受 URL 或 data:image/...;base64 的 string/string[]。
    if (reference.length > 0) {
      body.image = reference;
    }

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

    // 非 2xx：经统一错误分类（400/422→parameters，401/403→authentication 等）。
    if (!response.ok) {
      throw new GenerationError(classifyHttpError(response.status, text));
    }

    // HTTP 200 也可能是错误体（防御性守卫，同混元模式）。
    // 待实测：官方图片生成页未贴逐字错误 JSON，按方舟统一 {error:{code,message}} 结构防御处理。
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw unknownError("接口返回了无法解析的响应。", text.slice(0, 800), "response.invalid");
    }

    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      throw new GenerationError(classifyHttpError(200, text));
    }

    const images = extractImages(payload);
    if (images.length === 0) {
      throw unknownError("接口未返回图片数据。", text.slice(0, 800), "response.invalid");
    }

    return images;
  },
};
