// xAI Grok Imagine 生图适配器：标准 /images/generations（文生图）与 /images/edits（图生图，JSON 非 multipart）。
// 纯逻辑、无 electron / Node 副作用，fetcher 可注入，供 vitest 直接导入。
// 契约：端点按有无参考图切换；n ∈ [1,10] 前置校验（失败零请求，防重复计费）；
// ctx.size 推导为 aspect_ratio（精确命中枚举才携带）+ resolution（长边 >1024 → 2k 否则 1k）；
// xAI 不支持 size/style 直传；quality 仅 grok-imagine-image-2.0 支持且文档枚举冲突（low/medium vs low/medium/high），暂不发送（待实测）。

import type { ApiImage } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const GENERATIONS_ENDPOINT = "/images/generations";
const EDITS_ENDPOINT = "/images/edits";
const MAX_IMAGES = 10;

// 文档登记的 aspect_ratio 枚举（另有 "auto"，由缺省省略表达，不在此集合）。
// 整数比按 gcd 约分后精确匹配；9:19.5 / 19.5:9 等非整数比无法由整数 WxH 约分得到，留档对齐文档。
const ASPECT_RATIOS = new Set([
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "21:9",
  "5:2",
]);

/** 由 ctx.size 推导出的 xAI 专属字段；未命中/未提供时对应键省略。 */
export interface XaiSizeHints {
  aspectRatio?: string;
  resolution?: "1k" | "2k";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 由 "WxH" 推导 aspect_ratio 与 resolution：
 * - aspect_ratio：宽高按 gcd 约分后精确命中文档枚举才携带，否则省略（交给平台默认 auto）；
 * - resolution：长边 > 1024 → "2k"，否则 "1k"（1K=1024²、2K=2048²）；
 * - size 缺省或无法解析时两者都省略，绝不改写或缩放。
 */
export function deriveXaiSizeHints(size?: string): XaiSizeHints {
  if (size === undefined) return {};
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return {};
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return {};
  const divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  const hints: XaiSizeHints = { resolution: Math.max(width, height) > 1024 ? "2k" : "1k" };
  if (ASPECT_RATIOS.has(ratio)) {
    hints.aspectRatio = ratio;
  }
  return hints;
}

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

export const xaiImageAdapter: ProviderAdapter = {
  api: "xai-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // 前置校验（在 fetcher 之前失败 = 零请求 = 防重复计费）：n ∈ [1, 10]。
    const n = ctx.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGES) {
      throw imageCountError();
    }

    const hints = deriveXaiSizeHints(ctx.size);
    const reference = ctx.reference ?? [];
    // 端点切换：无参考图 → 文生图 /images/generations；有参考图 → /images/edits（JSON 体，非 multipart）。
    // v1 只取第一张参考图映射为 image 字段；xAI 另支持多图 `images` 数组（最多 3 张，
    // prompt 内用 <IMAGE_0>/<IMAGE_1> 引用）与 `mask`，与 `image` 互斥，本适配器暂不支持。
    const editing = reference.length > 0;

    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
    };
    if (ctx.n !== undefined) {
      body.n = n;
    }
    if (editing) {
      body.image = { url: reference[0], type: "image_url" };
      // 编辑端点无 aspect_ratio；size/style 文档明确 Not supported，绝不透传。
      if (hints.resolution) {
        body.resolution = hints.resolution;
      }
    } else {
      if (hints.aspectRatio) {
        body.aspect_ratio = hints.aspectRatio;
      }
      if (hints.resolution) {
        body.resolution = hints.resolution;
      }
    }
    // response_format 缺省即 url，不显式发送；quality 暂不发送（枚举冲突，待实测）。

    // 请求按 joinBase(ctx.baseUrl, endpoint) 同源发出，Authorization 只发到该 baseUrl；
    // 返回图片 URL 的下载同源守卫在 main 的 materializeImageResponse，密钥不会外泄到第三方 CDN。
    const response = await fetcher(joinBase(ctx.baseUrl, editing ? EDITS_ENDPOINT : GENERATIONS_ENDPOINT), {
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

    // 防御：HTTP 200 但 body 含 error（xAI 错误体形态官方未贴逐字 JSON，待实测；
    // 按 OpenAI 风格 {"error":{...}} 检测，绝不当作成功）。
    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      throw new GenerationError(classifyHttpError(200, text));
    }

    // 成功响应：data[] 每项优先 url（response_format=url 或缺省），否则 b64_json（不含 data-URI 前缀，
    // 与 openai 默认路径一致，由上层 normalizeImageBase64 归一化）。本适配器绝不自行下载图片。
    const data = (payload as { data?: unknown } | null)?.data;
    const images: ApiImage[] = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        const record = item as { url?: unknown; b64_json?: unknown } | null;
        const url =
          record && typeof record.url === "string" && record.url.length > 0 ? record.url : undefined;
        const b64 =
          record && typeof record.b64_json === "string" && record.b64_json.length > 0
            ? record.b64_json
            : undefined;
        if (url) {
          images.push({ url });
        } else if (b64) {
          images.push({ b64_json: b64 });
        }
      }
    }
    if (images.length === 0) {
      throw invalidResponseError("接口未返回图片。", text.slice(0, 800));
    }

    return images;
  },
};
