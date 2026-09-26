import { useEffect } from "react";

type KeyHandler = (event: KeyboardEvent) => void;

/**
 * 在 `window` 上监听原生 keydown；`enabled` 为 false 时不挂载监听器。
 * 处理器身份变化会重新绑定（因此传入 useCallback 或内联函数均可保持最新闭包）。
 */
export function useGlobalKeyDown(handler: KeyHandler, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, handler]);
}

/** Escape 键监听；仅当按键为 Escape 时调用 handler（enabled 为 false 时不挂载）。 */
export function useEscapeKey(handler: KeyHandler, enabled = true) {
  useGlobalKeyDown((event) => {
    if (event.key !== "Escape") return;
    handler(event);
  }, enabled);
}
