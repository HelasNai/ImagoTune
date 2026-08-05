export type GenerationErrorCategory =
  | "network"
  | "authentication"
  | "balance"
  | "parameters"
  | "upload"
  | "content"
  | "rate_limit"
  | "timeout"
  | "server"
  | "cancelled"
  | "unknown";

export type GenerationErrorInfo = {
  category: GenerationErrorCategory;
  title: string;
  message: string;
  suggestion: string;
  retryable: boolean;
  status?: number;
  details?: string;
};

export class GenerationError extends Error {
  info: GenerationErrorInfo;

  constructor(info: GenerationErrorInfo) {
    super(info.message);
    this.name = "GenerationError";
    this.info = info;
  }
}

function bodyDetail(body: string) {
  return body.replace(/\s+/g, " ").trim().slice(0, 800);
}

export function classifyHttpError(status: number, body: string): GenerationErrorInfo {
  const details = bodyDetail(body);
  const contentPattern = /(content|safety|policy|moderation|blocked|prohibited|违规|合规|审核|敏感)/i;
  const balancePattern = /(balance|credit|quota|billing|subscription|余额|额度|权益|订阅)/i;
  if (contentPattern.test(details)) {
    return { category: "content", title: "内容合规限制", message: "服务端未接受当前内容请求。", suggestion: "调整可能触发审核的主体、描述或参考图片后再手动提交。", retryable: false, status, details };
  }
  if (status === 402 || balancePattern.test(details)) {
    return { category: "balance", title: "余额或权益不足", message: "账户余额、订阅、额度或卡密权益可能不足。", suggestion: "请到 PinAI 检查余额与订阅状态，补充权益后再提交。", retryable: false, status, details };
  }
  if (status === 401 || status === 403) {
    return { category: "authentication", title: "密钥或权限异常", message: status === 401 ? "API 密钥无效或已失效。" : "当前密钥没有调用图片模型的权限。", suggestion: "请在设置中重新保存有效密钥，并确认图片模型权限。", retryable: false, status, details };
  }
  if (status === 413) {
    return { category: "upload", title: "上传文件过大", message: "上传图片、蒙版或请求内容超过接口限制。", suggestion: "压缩原图、减少参考图或降低目标尺寸后再提交。", retryable: false, status, details };
  }
  if (status === 408 || status === 504) {
    return { category: "timeout", title: "生成响应超时", message: "图片服务未能在限定时间内完成响应。", suggestion: "建议切换到 1K、单张和自动细节，稍后手动重试。", retryable: true, status, details };
  }
  if (status === 429) {
    return { category: "rate_limit", title: "请求过于频繁", message: "服务繁忙或已达到并发限制。", suggestion: "等待片刻后手动重试；任务队列会继续保持串行。", retryable: true, status, details };
  }
  if (status === 400 || status === 422) {
    return { category: "parameters", title: "生成参数不兼容", message: "尺寸、比例、质量或编辑参数未被接口接受。", suggestion: "先改为 1K、自动细节、单张，并检查自定义尺寸和蒙版。", retryable: false, status, details };
  }
  if (status >= 500) {
    return { category: "server", title: "图片服务暂时异常", message: "PinAI 图片服务或网关暂时无法完成请求。", suggestion: "稍后手动重试；软件不会自动再次计费。", retryable: true, status, details };
  }
  return { category: "unknown", title: "生成请求失败", message: "接口返回了未识别的错误。", suggestion: "检查接口详情和当前参数后再提交。", retryable: false, status, details };
}

export function classifyRuntimeError(error: unknown, options: { timedOut?: boolean; cancelled?: boolean } = {}): GenerationErrorInfo {
  if (error instanceof GenerationError) return error.info;
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  if (options.cancelled) return { category: "cancelled", title: "任务已取消", message: "请求已由用户取消。", suggestion: "修改参数后可重新加入队列。", retryable: false };
  if (options.timedOut || /timeout|timed out|超时/i.test(message)) return { category: "timeout", title: "生成响应超时", message: "请求超过 300 秒仍未完成。", suggestion: "建议降低到 1K、单张并稍后手动重试。", retryable: true, details: message };
  if (/fetch failed|network|dns|socket|econn|enotfound|offline|网络/i.test(message)) return { category: "network", title: "网络连接失败", message: "客户端无法连接 PinAI 图片服务。", suggestion: "检查网络、代理和 API 地址后再手动提交。", retryable: true, details: message };
  return { category: "unknown", title: "生成失败", message, suggestion: "查看详情并检查当前参数后再提交。", retryable: false, details: message };
}

export function errorInfoMessage(info: GenerationErrorInfo) {
  return info.title + "：" + info.message;
}

