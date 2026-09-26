import { useCallback } from "react";
import type { StudioNotify } from "./StudioContext";

type CopyResponse = { ok: boolean; error?: string };

/**
 * 统一的剪贴板写入：检查 `{ ok }`，成功/失败都经 notify 反馈。
 * 旧内联站点仅在 `.then` 里提示成功、不检查 `{ ok: false }`，失败会静默冒充成功——此处补齐失败路径。
 */
async function copyWithFeedback(
  action: () => Promise<CopyResponse>,
  successMessage: string,
  failureMessage: string,
  notify: StudioNotify,
): Promise<boolean> {
  try {
    const response = await action();
    if (!response.ok) {
      notify(response.error || failureMessage, true);
      return false;
    }
    notify(successMessage);
    return true;
  } catch (cause) {
    notify(cause instanceof Error && cause.message ? cause.message : failureMessage, true);
    return false;
  }
}

/** 复制文本：成功提示 successMessage；失败优先展示 IPC 返回的 error，其次 failureMessage。 */
export function useCopyText(notify: StudioNotify) {
  return useCallback(
    (value: string, successMessage = "已复制到剪贴板", failureMessage = "复制失败") =>
      copyWithFeedback(
        () => window.imageStudio.clipboard.copyText(value),
        successMessage,
        failureMessage,
        notify,
      ),
    [notify],
  );
}

/** 复制图片（base64）：成功提示 successMessage；失败优先展示 IPC 返回的 error，其次 failureMessage。 */
export function useCopyImage(notify: StudioNotify) {
  return useCallback(
    (b64: string, successMessage = "图片已复制到剪贴板", failureMessage = "复制图片失败") =>
      copyWithFeedback(
        () => window.imageStudio.clipboard.copyImage(b64),
        successMessage,
        failureMessage,
        notify,
      ),
    [notify],
  );
}
