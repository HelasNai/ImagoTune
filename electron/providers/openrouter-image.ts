// OpenRouter 专用生图适配器：官方 Image API `POST /api/v1/images`（注意：不是 /images/generations）。
// 纯逻辑、无 electron / Node 副作用，fetcher 可注入，供 vitest 直接导入。
// 契约：①端点固定 /images；②n ∈ [1,10] 前置校验（零请求失败，防重复计费）；
// ③显式 size 为权威——绝不与 resolution/aspect_ratio 混发（文档：冲突会 400）；
// ④图生图经 input_references（{type:"image_url",image_url:{url}} 数组，最多 16 条；应用侧参考图上限 3）；
// ⑤响应只有 data[].b64_json（必需字段，无 url），由上层归一化，本适配器绝不自行落盘。
// 不实现 listModels（平台级 /v1/models 可用）。

import type { ApiImage } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const ENDPOINT = "/images";
const MAX_IMAGES = 10;

/** 张数越界：n ∈ [1, 10]，请求前拒绝（零请求，防重复计费）。 */
function imageCountError(): GenerationError {
  return new GenerationError({
    category: "parameters",
    title: "张数超出限制",
    message: "该平台单次生成 1 到 10 张图片。",
    suggestion: "请将张数调整到 1 到 10 之间后再提交。",
    retryable: false,
    code: "parameters.imageCount",
    params: { max: String(MAX_IMAGES) },
  });
}

/** 响应不可用：无法解析或没有任何图片数据。 */
function invalidResponseError(message: string, details: string | undefined): GenerationError {
  return new GenerationError({
    category: "unknown",
    title: "生成请求失败",
    message,
    suggestion: "查看详情并检查当前参数后再提交。",
    retryable: false,
    details,
    code: "response.invalid",
  });
}

export const openRouterImageAdapter: ProviderAdapter = {
  api: "openrouter-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // 前置校验（在 fetcher 之前失败 = 零请求 = 防重复计费）：n ∈ [1, 10]。
    const n = ctx.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGES) {
      throw imageCountError();
    }

    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
    };
    if (ctx.n !== undefined) {
      body.n = n;
    }
    // 显式像素 size 为权威；文档明确与 resolution/aspect_ratio 冲突会 400，故只发 size 一个。
    if (ctx.size !== undefined) {
      body.size = ctx.size;
    }
    // 图生图：input_references 数组（URL 或 base64 dataURL），最多 16 条（应用侧参考图上限 3，天然不会触顶）。
    const reference = ctx.reference ?? [];
    if (reference.length > 0) {
      body.input_references = reference.map((url) => ({ type: "image_url", image_url: { url } }));
    }

    // 请求按 joinBase(ctx.baseUrl, ENDPOINT) 同源发出，Authorization 只发到该 baseUrl；
    // 返回图片数据的落盘与同源守卫在上层管线，本适配器绝不自行下载图片。
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

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw invalidResponseError("接口返回了无法解析的响应。", text.slice(0, 800));
    }

    // 防御：HTTP 200 也可能是错误体（{"error":{code,message}}），绝不当作成功。
    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      throw new GenerationError(classifyHttpError(200, text));
    }

    // 成功响应：data[].b64_json 为必需字段（默认返回 base64，无 url 字段）。
    const data = (payload as { data?: unknown } | null)?.data;
    const images: ApiImage[] = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        const b64 = (item as { b64_json?: unknown } | null)?.b64_json;
        if (typeof b64 === "string" && b64.length > 0) images.push({ b64_json: b64 });
      }
    }
    if (images.length === 0) {
      throw invalidResponseError("接口未返回图片数据。", text.slice(0, 800));
    }

    return images;
  },
};
