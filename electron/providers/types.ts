// 平台适配器层：纯逻辑、无 electron / Node 副作用，可被 vitest 直接导入。
// 上层（main.ts）按 ProviderApiStyle 分派：命中注册表走适配器，未命中走 openai 默认路径。

import type { ApiImage, ProviderApiStyle } from "../../shared/types";

/** 一次生图请求的上下文；适配器只依赖这些字段，不读配置、不碰 keytar。 */
export interface GenerateContext {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: string; // 形如 "1024x1024"；适配器自行解析校验
  n?: number; // 缺省 1
  quality?: string;
  reference?: string[]; // 参考图的 dataURL 列表（形如 data:image/png;base64,...）
  signal?: AbortSignal;
}

/** 平台适配器：只强制 generate；listModels 可选（缺省时上层走平台级 /v1/models）。 */
export interface ProviderAdapter {
  api: ProviderApiStyle;
  generate(ctx: GenerateContext, fetcher?: typeof fetch): Promise<ApiImage[]>;
  listModels?(ctx: GenerateContext): Promise<string[]>;
}
