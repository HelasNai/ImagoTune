import { useCallback } from "react";
import { t } from "../lib/i18n";
import { callIpc } from "./ipc";
import type { StudioNotify } from "./StudioContext";

/** 图片保存请求：`suggestedName` 的取值规则由调用方决定，hook 只负责透传，不改变既有文件名规则。 */
export type SaveImageRequest = { dataUrl: string; suggestedName: string; recipe?: ImageRecipeV1 };

/**
 * 统一的图片保存：经 `callIpc` 调用 `saveImage`，统一 `canceled` 判定与失败反馈。
 * - 用户取消保存（`canceled`）返回 false，且不触发 `onSaved`；
 * - 已保存返回 true，并把 `path`（可能为空串）交给 `onSaved` 决定成功文案。
 */
export function useSaveImage(notify: StudioNotify) {
  return useCallback(
    async (
      request: SaveImageRequest,
      options: { fallbackError?: string; onSaved?: (path: string) => void } = {},
    ): Promise<boolean> => {
      const result = await callIpc(() => window.imageStudio.saveImage(request), {
        fallbackError: options.fallbackError ?? t("保存失败|图片"),
        onError: (message) => notify(message, true),
      });
      if (result.canceled) return false;
      options.onSaved?.(result.path || "");
      return true;
    },
    [notify],
  );
}
