import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavIcon } from "./icons";
import { resolveTooltipLayout, type TooltipLayout } from "../lib/tooltip";

/** 把节点赋给函数式或对象式 ref（两者皆可）。 */
function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(node);
    return;
  }
  (ref as { current: T | null }).current = node;
}

/** 触发器上可被注入的属性集合（DOM 元素语义）。 */
type TooltipChildProps = React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> };

export interface TooltipProps {
  content: string;
  /** 单个触发元素；mouse/focus 处理器与 aria 经 cloneElement 注入（不额外增加 DOM）。 */
  children: React.ReactElement;
  /** 悬停延迟（毫秒）；默认 300。聚焦时无视延迟立即显示。 */
  delay?: number;
}

/**
 * 悬浮提示：包裹单个触发器，portal 到 `.app` 并以 fixed 定位渲染气泡。
 * - 悬停延迟显示（默认 300ms），移出取消 / 立即隐藏；聚焦立即显示，失焦隐藏。
 * - 打开时 Escape / 任意滚动（捕获阶段）/ 窗口缩放均立即隐藏，不重新定位。
 * - 先以 visibility:hidden 挂载并测量，useLayoutEffect 算出位置后再显示，无位置闪烁。
 * - 关闭时 aria-describedby 不注入；打开时注入 useId 生成的气泡 id。
 * - StrictMode 安全：定时器 / 监听器在卸载时全部清理。
 */
export function Tooltip({ content, children, delay = 300 }: TooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<TooltipLayout | null>(null);

  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const bubbleId = useId();

  const clearTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setLayout(null);
  }, [clearTimer]);

  const showNow = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer]);

  const scheduleShow = useCallback(() => {
    clearTimer();
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      setOpen(true);
    }, delay);
  }, [clearTimer, delay]);

  // 打开期间：Escape / 任意滚动（捕获覆盖 .app 与全部滚动容器）/ 窗口缩放 → 立即隐藏。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const handleLayoutChange = () => hide();
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleLayoutChange, true);
    window.addEventListener("resize", handleLayoutChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleLayoutChange, true);
      window.removeEventListener("resize", handleLayoutChange);
    };
  }, [open, hide]);

  // 卸载时清理悬停定时器。
  useEffect(() => clearTimer, [clearTimer]);

  // 气泡以 hidden 挂载后测量实测尺寸并计算位置；浏览器绘制前同步完成，无闪烁。
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const rect = trigger.getBoundingClientRect();
    setLayout(
      resolveTooltipLayout({
        trigger: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        bubble: { width: bubble.offsetWidth, height: bubble.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [open, content]);

  const childProps = (children.props ?? {}) as TooltipChildProps;
  const childRef = childProps.ref;

  // 合并（而非覆盖）子元素已有的 ref 与 mouse / focus 处理器。
  const setTriggerRef = useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childRef, node);
    },
    [childRef],
  );
  const callChild = <E,>(handler: ((event: E) => void) | undefined, event: E): void => {
    if (handler) handler(event);
  };

  const mergedProps: TooltipChildProps = {
    ...childProps,
    ref: setTriggerRef,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      callChild(childProps.onMouseEnter, event);
      scheduleShow();
    },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
      callChild(childProps.onMouseLeave, event);
      hide();
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      callChild(childProps.onFocus, event);
      showNow();
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      callChild(childProps.onBlur, event);
      hide();
    },
    "aria-describedby": open ? bubbleId : childProps["aria-describedby"],
  };

  return (
    <>
      {React.cloneElement(children as React.ReactElement<TooltipChildProps>, mergedProps)}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={bubbleId}
            className="tooltip-bubble"
            role="tooltip"
            style={
              layout
                ? { top: layout.top, left: layout.left }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            {content}
          </div>,
          document.querySelector(".app") ?? document.body,
        )}
    </>
  );
}

export interface InfoHintProps {
  content: string;
  /** ⓘ 按钮的 aria-label；默认「说明」。 */
  label?: string;
}

/** 信息提示按钮：16px 圆形问号（Lucide circle-question-mark），悬停 / 聚焦显示 Tooltip。 */
export function InfoHint({ content, label = "说明" }: InfoHintProps): React.ReactElement {
  return (
    <Tooltip content={content}>
      <button type="button" className="tooltip-hint" aria-label={label}>
        <NavIcon name="circle-question-mark" size={13} />
      </button>
    </Tooltip>
  );
}
