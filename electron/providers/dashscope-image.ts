// 阿里 DashScope（百炼）OpenAI 兼容模式 Qwen-Image 生图适配器。
// 纯逻辑、无 electron / Node 副作用，fetcher 可注入，供 vitest 直接导入。
// 契约：POST /images/generations，参数全部平铺在顶层（无 input/parameters 嵌套）；
// 图生图走同一端点的顶层 image 字段（字符串单图 / 字符串数组多图），不是 /images/edits；
// 不发送 response_format（服务端不支持，只返回 URL，有效期 24 小时）；
// n ∈ [1,6] 前置校验（零请求失败）；size 轻量哨兵（"auto" 或 "宽x高"）。
// 不实现 listModels（兼容模式平台级 /v1/models 可用）。

import type { ApiImage, GenerationErrorCode } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const ENDPOINT = "/images/generations";
const MIN_N = 1;
const MAX_N = 6;

function parameterError(
  message: string,
  details: string | undefined,
  code: GenerationErrorCode,
  params?: Record<string, string | number>,
): GenerationError {
  return new GenerationError({
    category: "parameters",
    title: "生成参数不兼容",
    message,
    suggestion: "请调整参数后重试；软件不会自动重复生成。",
    retryable: false,
    details,
    code,
    params,
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

/** 尺寸轻量哨兵：只认 "auto" 或 "宽x高"（字母 x、宽高为正整数）；畸形串一律拒绝，绝不改写或透传。 */
function assertSize(size: string): void {
  const trimmed = size.trim();
  if (trimmed === "auto") return;
  const match = /^(\d+)x(\d+)$/i.exec(trimmed);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw parameterError("该平台不支持所选尺寸。", size, "parameters.size");
  }
}

/** 读取 data[].url 列表（成功响应的图片地址，有效期 24 小时）；无有效条目返回空数组。 */
function extractImageUrls(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const urls: string[] = [];
  for (const item of data) {
    const url = (item as { url?: unknown } | null)?.url;
    if (typeof url === "string" && url.length > 0) urls.push(url);
  }
  return urls;
}

export const dashscopeImageAdapter: ProviderAdapter = {
  api: "dashscope-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // 张数前置校验：DashScope n ∈ [1,6]，越界在发请求之前拒绝（零请求 = 防重复计费），绝不自动重试。
    const n = ctx.n ?? 1;
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) {
      throw new GenerationError({
        category: "parameters",
        title: "生成张数超出范围",
        message: "该平台单次最多生成 6 张图片。",
        suggestion: "请将张数调整为 1 到 6 后再提交；软件不会自动重复生成。",
        retryable: false,
        code: "parameters.imageCount",
        params: { max: String(MAX_N) },
      });
    }

    // size 轻量哨兵：畸形串拒绝，合法值（含 "auto"）逐字透传。
    if (ctx.size !== undefined) {
      assertSize(ctx.size);
    }

    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
      n,
    };
    if (ctx.size !== undefined) {
      body.size = ctx.size;
    }
    // 图生图：顶层 image 字段，单图传字符串、多图传字符串数组（dataURL 或公网 URL）。
    const reference = ctx.reference ?? [];
    if (reference.length === 1) {
      body.image = reference[0];
    } else if (reference.length > 1) {
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

    // 非 2xx：经统一错误分类（400→parameters，401/403→authentication 等）。
    if (!response.ok) {
      throw new GenerationError(classifyHttpError(response.status, text));
    }

    // 防御性守卫：HTTP 200 也可能是错误体（{"error":{message,type,param,code}}），绝不当作成功。
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw unknownError("接口返回了无法解析的响应。", text.slice(0, 800), "response.invalid");
    }

    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      throw new GenerationError(classifyHttpError(200, text));
    }

    const urls = extractImageUrls(payload);
    if (urls.length === 0) {
      throw unknownError("接口未返回图片地址。", text.slice(0, 800), "response.invalid");
    }

    return urls.map((url) => ({ url }));
  },
};
