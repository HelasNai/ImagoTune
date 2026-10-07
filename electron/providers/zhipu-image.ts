// 智谱 BigModel 生图适配器：官方 OpenAPI `POST /paas/v4/images/generations`。
// 纯逻辑、无 electron / Node 副作用，fetcher 可注入，供 vitest 直接导入。
// 契约：①请求体只发 { model, prompt, size? }——OpenAPI schema 仅定义 model/prompt/quality/
// size/watermark_enabled/user_id 六字段，不发送 n/seed/negative_prompt/response_format/reference；
// ②quality 不发送（枚举 hd/standard 与应用的 low/medium/high 冲突，glm-image 默认 hd）；
// ③单张限制（schema 无批量字段）、不支持参考图（schema 无任何 image 输入字段）均在发请求前拒绝；
// ④size 仅做格式哨兵，模型级范围交服务端。不实现 listModels（平台级 /models 可用）。

import type { ApiImage, GenerationErrorCode } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const ENDPOINT = "/images/generations";
// size 通用哨兵边界（非模型级约束）：模型级范围（glm-image 宽高 1024–2048 且为 32 的倍数、
// 像素 ≤ 2^22；其它模型 512–2048 且为 16 的倍数、像素 ≤ 2^21）留给服务端判定
//（服务端拒绝时 400 → classifyHttpError 归 parameters.size）。待实测。
const MIN_EDGE = 1;
const MAX_EDGE = 8192;
const MAX_AREA = 14745600; // 与应用画布像素上限一致（3840²），仅防明显荒谬值

function parameterError(
  title: string,
  message: string,
  suggestion: string,
  details: string | undefined,
  code: GenerationErrorCode,
  params?: Record<string, string | number>,
): GenerationError {
  return new GenerationError({
    category: "parameters",
    title,
    message,
    suggestion,
    retryable: false,
    details,
    code,
    params,
  });
}

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

/** HTTP 200 错误体中「接口/模型不存在」的判定（防御性保留：官方称错误一律非 2xx，实测待验证）。 */
const MISSING_INTERFACE_PATTERN = /(does not exist|not exist|notexists?\b|not found|不存在)/i;

function endpointError(details: string): GenerationError {
  return new GenerationError({
    category: "endpoint",
    title: "模型或接口不存在",
    message: "服务端未找到所请求的模型或接口。",
    suggestion: "请检查供应商的接口类型、Base URL 与模型名是否正确。",
    retryable: false,
    status: 200,
    details,
    code: "http.notFound",
  });
}

/** size 格式哨兵：必须匹配 "宽x高"、宽高为正整数且在通用边界内；模型级范围交服务端（待实测）。 */
function sizeError(size: string): GenerationError {
  return parameterError(
    "生成参数不兼容",
    "该平台不支持所选尺寸。",
    "请调整参数后重试；软件不会自动重复生成。",
    size,
    "parameters.size",
  );
}

function assertSize(size: string): void {
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!match) {
    throw sizeError(size);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < MIN_EDGE ||
    height < MIN_EDGE ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    width * height > MAX_AREA
  ) {
    throw sizeError(size);
  }
}

/** 收集 data[].url 中的全部图片地址（官方注释：目前数组中只包含一张图片；仍按数组完整映射）。 */
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

export const zhipuImageAdapter: ProviderAdapter = {
  api: "zhipu-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // 单张限制：schema 无批量字段，绝不静默降级/循环多张（防重复计费）。
    const n = ctx.n ?? 1;
    if (n > 1) {
      throw parameterError(
        "单张限制",
        "该平台单次生成一张图片。",
        "请将张数调整为 1 后再提交。",
        undefined,
        "parameters.imageCount",
        { max: "1" },
      );
    }

    // 不支持参考图：schema 无任何 image 输入字段（纯文生图），发请求前显式拒绝。
    if ((ctx.reference ?? []).length > 0) {
      throw parameterError(
        "参数不兼容",
        "该平台图片生成接口不接受参考图输入。",
        "请移除参考图，或改用支持图片输入的供应商后重试。",
        undefined,
        "parameters.referenceUnsupported",
      );
    }

    // size 直传前仅做格式哨兵；模型级范围交服务端。
    if (ctx.size !== undefined) {
      assertSize(ctx.size);
    }

    // 请求体只发 schema 定义的字段；quality 不发送（见文件头契约②）。
    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
    };
    if (ctx.size !== undefined) {
      body.size = ctx.size;
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

    // 防御性：HTTP 200 也可能是错误体（官方称不会，但照混元经验保留检测）。
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw invalidResponseError("接口返回了无法解析的响应。", text.slice(0, 800));
    }

    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      // 200 错误体先在本适配器内识别「接口/模型不存在」，不改动 classifyHttpError 的通用语义
      //（其 endpoint 分支要求 400/404，200 场景会落 unknown）。
      if (MISSING_INTERFACE_PATTERN.test(text)) {
        throw endpointError(text.replace(/\s+/g, " ").trim().slice(0, 800));
      }
      throw new GenerationError(classifyHttpError(200, text));
    }

    const urls = extractImageUrls(payload);
    if (urls.length === 0) {
      throw invalidResponseError("接口未返回图片地址。", text.slice(0, 800));
    }

    return urls.map((url) => ({ url }));
  },
};
