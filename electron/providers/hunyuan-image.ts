// 腾讯混元生图适配器：v3.5 专用端点（非标准 OpenAI 协议）。
// 纯逻辑、无 electron / Node 副作用，fetcher 可注入，供 vitest 直接导入。
// 契约（plan K4/K5/K6）：单张限制、size 哨兵校验、messages 协议、200+error 检测。
// 不实现 listModels（K2：平台级 /v1/models 可用）。

import type { ApiImage, GenerationErrorCode } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const ENDPOINT = "/wand/hunyuan-image/v35-generation";
const MIN_EDGE = 256;
const MAX_EDGE = 8192;
const MAX_AREA = 16777216;

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

/** HTTP 200 错误体中「接口/模型不存在」的判定（实测混元返回 200 + ResourceUnavailable.InterfaceNotExist）。 */
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
    code: "hunyuan.endpointMissing",
  });
}

/** 校验 "WxH" 尺寸：必须是整数、宽高 ∈ [256, 8192]、面积 ≤ 16777216；否则抛 parameters。 */
function assertSize(size: string): void {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) {
    throw parameterError("该平台不支持所选尺寸。", size, "hunyuan.sizeUnsupported");
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
    throw parameterError("该平台不支持所选尺寸。", size, "hunyuan.sizeUnsupported");
  }
}

/** 读取 choices[0].delta.image.url（成功响应的图片地址）。 */
function extractImageUrl(payload: unknown): string | undefined {
  const url = (payload as { choices?: Array<{ delta?: { image?: { url?: unknown } } }> } | null)?.choices?.[0]
    ?.delta?.image?.url;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

export const hunyuanImageAdapter: ProviderAdapter = {
  api: "hunyuan-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // K6：单张限制，绝不静默降级/循环多张（防重复计费）。
    const n = ctx.n ?? 1;
    if (n > 1) {
      throw new GenerationError({
        category: "parameters",
        title: "单张限制",
        message: "该平台单次生成一张图片。",
        suggestion: "请将张数调整为 1 后再提交。",
        retryable: false,
        code: "hunyuan.singleImage",
      });
    }

    // K4：size 直传前先哨兵校验，越界/畸形一律拒绝，绝不缩放或透传。
    if (ctx.size !== undefined) {
      assertSize(ctx.size);
    }

    const reference = ctx.reference ?? [];
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ctx.prompt },
            ...reference.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
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

    // HTTP 200 也可能是错误体（实测 ResourceUnavailable.InterfaceNotExist 返回 200）。
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw unknownError("接口返回了无法解析的响应。", text.slice(0, 800), "hunyuan.invalidResponse");
    }

    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      // 200 错误体先在本适配器内识别「接口/模型不存在」，不改动 classifyHttpError 的通用语义
      // （其 endpoint 分支要求 400/404，而混元实测以 200 返回 ResourceUnavailable.InterfaceNotExist）。
      if (MISSING_INTERFACE_PATTERN.test(text)) {
        throw endpointError(text.replace(/\s+/g, " ").trim().slice(0, 800));
      }
      throw new GenerationError(classifyHttpError(200, text));
    }

    const url = extractImageUrl(payload);
    if (!url) {
      throw unknownError("接口未返回图片地址。", text.slice(0, 800), "hunyuan.noImageUrl");
    }

    return [{ url }];
  },
};
