import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavIcon } from "./icons";
import { useEscapeKey } from "./useKeyboard";
import { t } from "../lib/i18n";

export type TextDialogOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  danger?: boolean;
};

export type ConfirmDialogOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type TextRequest = { id: number; kind: "text"; options: TextDialogOptions; resolve: (value: string | null) => void };
type ConfirmRequest = { id: number; kind: "confirm"; options: ConfirmDialogOptions; resolve: (value: boolean) => void };
type DialogRequest = TextRequest | ConfirmRequest;

type DialogApi = {
  requestText: (options: TextDialogOptions) => Promise<string | null>;
  requestConfirm: (options: ConfirmDialogOptions) => Promise<boolean>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog() {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useDialog 必须在 DialogProvider 内使用");
  return api;
}

function DialogModal({ request, onDone }: { request: DialogRequest; onDone: (value: string | null | boolean) => void }) {
  // key={request.id} 保证每个请求都是全新实例，初始值不会串场。
  const [value, setValue] = useState(request.kind === "text" ? request.options.defaultValue ?? "" : "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 文本对话框打开时聚焦输入框并全选文本（StrictMode 双执行幂等）。
  useEffect(() => {
    if (request.kind !== "text") return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [request]);

  // Escape 取消两种对话框（输入法组合态不响应）；Enter 由输入框自身处理。
  useEscapeKey(useCallback((event: KeyboardEvent) => {
    if (event.isComposing) return;
    event.preventDefault();
    onDone(request.kind === "text" ? null : false);
  }, [request, onDone]));

  const cancel = () => onDone(request.kind === "text" ? null : false);
  const confirm = () => onDone(request.kind === "text" ? value : true);
  const cancelLabel = request.kind === "confirm" ? request.options.cancelLabel ?? t("取消") : t("取消");
  const confirmLabel = request.options.confirmLabel ?? t("确定");
  const danger = Boolean(request.options.danger);

  return (
    <div className="dialog-modal" role="dialog" aria-modal="true" aria-label={request.options.title} onClick={cancel}>
      <section onClick={(event) => event.stopPropagation()}>
        <button className="lightbox-close" onClick={cancel} aria-label={t("关闭对话框")}><NavIcon name="x" size={20} /></button>
        <h2>{request.options.title}</h2>
        {request.options.message && <p>{request.options.message}</p>}
        {request.kind === "text" && (
          <input
            ref={inputRef}
            value={value}
            placeholder={request.options.placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              confirm();
            }}
          />
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={cancel}>{cancelLabel}</button>
          <button className={danger ? "primary danger" : "primary"} onClick={confirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<DialogRequest[]>([]);
  const queueRef = useRef<DialogRequest[]>([]);
  const nextIdRef = useRef(1);

  const enqueue = useCallback((request: DialogRequest) => {
    queueRef.current = [...queueRef.current, request];
    setRequests(queueRef.current);
  }, []);

  const requestText = useCallback(
    (options: TextDialogOptions) => new Promise<string | null>((resolve) => {
      enqueue({ id: nextIdRef.current++, kind: "text", options, resolve });
    }),
    [enqueue],
  );

  const requestConfirm = useCallback(
    (options: ConfirmDialogOptions) => new Promise<boolean>((resolve) => {
      enqueue({ id: nextIdRef.current++, kind: "confirm", options, resolve });
    }),
    [enqueue],
  );

  // 逐个结算队首：resolve 后立即移出队列，后续请求依次展示；快速重复点击只消费一次队首，不丢 Promise。
  const settle = useCallback((value: string | null | boolean) => {
    const [active, ...rest] = queueRef.current;
    if (!active) return;
    queueRef.current = rest;
    setRequests(rest);
    if (active.kind === "text") active.resolve(typeof value === "string" || value === null ? value : null);
    else active.resolve(value === true);
  }, []);

  const api = useMemo<DialogApi>(() => ({ requestText, requestConfirm }), [requestText, requestConfirm]);
  const active = requests[0];

  return (
    <DialogContext.Provider value={api}>
      {children}
      {/* 与 ResultPanel 导出弹层同理，经 portal 挂到 .app 根级：modal 作为 .page-transition 后代时，
          其 opacity 动画会创建 stacking context，弹层会被 header(z-index:40) 反盖。
          无对话框时不查询 DOM —— DialogProvider 包住 App，首帧 .app 尚不存在。 */}
      {active && createPortal(
        <DialogModal key={active.id} request={active} onDone={settle} />,
        document.querySelector(".app") ?? document.body,
      )}
    </DialogContext.Provider>
  );
}
