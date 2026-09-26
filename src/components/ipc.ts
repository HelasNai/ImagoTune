import { useCallback, useState } from "react";

// 渲染层统一 IPC 助手：所有需要用户反馈的 `window.imageStudio.*` 调用都经此路由，
// 取代各组件里逐字复制的 `if (!result.ok) 提示` 模式。
// best-effort 调用保持直连（不接入本助手）：事件订阅 `on*`、`windowControls.*`，
// 以及剪贴板写入 `clipboard.copyText` / `clipboard.copyImage`（其失败反馈由 useCopy 统一补足）。

/** 结构化 IPC 失败：message 为可展示文案，result 保留原始返回值供调用方按需读取。 */
export class IpcCallError extends Error {
  readonly result: unknown;

  constructor(message: string, result?: unknown) {
    super(message);
    this.name = "IpcCallError";
    this.result = result;
  }
}

/** 用户可见的错误上报函数（各组件注入自身机制：setError / onNotice / (m) => onNotice(m, true)）。 */
export type IpcErrorReporter = (message: string) => void;

function rejectionMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** 读取 IPC 返回值的 `ok` / `error`（部分只读接口没有 ok 字段，视为成功）。 */
function ipcOutcome(result: unknown): { failed: boolean; message: string } | null {
  if (!result || typeof result !== "object") return null;
  const value = result as { ok?: unknown; error?: unknown };
  if (value.ok !== false) return null;
  return { failed: true, message: typeof value.error === "string" && value.error ? value.error : "" };
}

/**
 * 统一调用 `window.imageStudio.*` 的异步 IPC。
 *
 * - 成功（`ok !== false`）：原样返回，**成功路径行为不变**。
 * - 返回 `{ ok: false }`：调用 `onError` 上报后仍返回结果（调用方可读 `error` 做分支）；
 *   未提供 `onError` 时抛出 `IpcCallError`，交由 `useIpcAction` 统一上报。
 * - promise 被 reject：调用 `onError` 上报后抛出 `IpcCallError`（保留原始原因）。
 *
 * @param promiseFactory 延迟调用的 IPC 工厂（如 `() => window.imageStudio.gallery.loadImage(id)`）。
 * @param options.fallbackError IPC 未返回 `error` 时的兜底文案。
 * @param options.onError 错误上报函数；省略则走抛出结构化失败的路径。
 */
export async function callIpc<T>(
  promiseFactory: () => Promise<T>,
  options: { fallbackError?: string; onError?: IpcErrorReporter } = {},
): Promise<T> {
  const fallbackError = options.fallbackError ?? "操作失败";
  let result: T;
  try {
    result = await promiseFactory();
  } catch (cause) {
    const message = rejectionMessage(cause, fallbackError);
    options.onError?.(message);
    throw new IpcCallError(message, cause);
  }
  const outcome = ipcOutcome(result);
  if (outcome) {
    const message = outcome.message || fallbackError;
    if (!options.onError) throw new IpcCallError(message, result);
    options.onError(message);
  }
  return result;
}

/**
 * 面向一次性动作（按钮）的 IPC action hook：管理 `pending` 并在失败时上报。
 *
 * `run` 内部以**无 onError** 方式调用 `callIpc`，因此 `{ ok: false }` 与 reject 都会抛出，
 * 被捕获后经 `onError`（省略时回退 `console.error`）上报，并返回 `undefined`，
 * 以便调用方区分成功（返回结果）与失败（undefined → 追加刷新/回滚）。
 */
export function useIpcAction(onError?: IpcErrorReporter) {
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T>(
      promiseFactory: () => Promise<T>,
      options: { fallbackError?: string; onError?: IpcErrorReporter } = {},
    ): Promise<T | undefined> => {
      const fallbackError = options.fallbackError ?? "操作失败";
      setPending(true);
      try {
        return await callIpc(promiseFactory, { fallbackError });
      } catch (cause) {
        const message = cause instanceof IpcCallError ? cause.message : rejectionMessage(cause, fallbackError);
        (options.onError ?? onError ?? ((value: string) => console.error("[ipc]", value)))(message);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [onError],
  );

  return { pending, run };
}
