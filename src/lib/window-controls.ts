export type WindowControlIconName = "square" | "copy";

/** 窗口处于最大化（或等效还原态）时应显示的图标名 */
export function maximizeIconName(maximized: boolean): WindowControlIconName {
  return maximized ? "copy" : "square";
}

/** 窗口处于最大化（或等效还原态）时按钮的无障碍标签 */
export function maximizeAriaLabel(maximized: boolean): string {
  return maximized ? "还原窗口" : "最大化窗口";
}
