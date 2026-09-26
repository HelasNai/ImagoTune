// 网络请求通用助手：基础地址拼接、超时封装、错误消息归一。
// 纯逻辑、无 electron / Node 副作用，可被 vitest 直接导入。

/**
 * 拼接基础地址与路径：去掉 baseUrl 末尾斜杠、去掉 path 开头斜杠，
 * 再以单个 `/` 连接，避免出现重复斜杠或漏斜杠。
 * 例：joinBase("https://a/v1/", "models") === "https://a/v1/models"。
 */
export function joinBase(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/** withTimeout 返回的句柄：signal 传给 fetch，clear 应在 finally 中调用。 */
export type TimeoutHandle = { signal: AbortSignal; clear: () => void };

/**
 * 创建 AbortController 并在 ms 毫秒后触发超时：
 * 先调用 onTimeout（用于记录"是超时而非用户取消"），再 abort()。
 * 返回的 clear() 必须由调用方在 finally 中执行，避免请求已结束后定时器仍然触发。
 */
export function withTimeout(ms: number, onTimeout?: () => void): TimeoutHandle {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    onTimeout?.();
    controller.abort();
  }, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** 提取错误消息，空消息回退到 fallback（等价于 `(error as Error).message || fallback`）。 */
export function errorMessage(error: unknown, fallback: string): string {
  return (error as Error).message || fallback;
}
