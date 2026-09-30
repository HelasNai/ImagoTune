import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { normalizeLegacyProgress } from "../lib/progress";

/** 进行中的进度事件集合，按 id 索引（同一 id 的后续事件原地替换）。 */
export type ProgressMap = Record<string, TaskProgressEvent>;

type ProgressContextValue = {
  events: ProgressMap;
  publish: (event: TaskProgressEvent) => void;
};

const ProgressContext = createContext<ProgressContextValue>({ events: {}, publish: () => {} });

/**
 * 统一进度源：订阅旧 image:progress 与新 progress:update 两路推送，
 * 归一化为同一个 Map，供各面板按 id 读取。渲染层本地进度（本地推理、反推前压缩）
 * 经 publish() 汇入同一 Map。
 *
 * 高频事件（worker 每分块/每张脸）经 requestAnimationFrame 合流后再 setState，
 * 避免重渲染风暴。
 */
export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ProgressMap>({});
  /** 旧通道载荷不带起始时间：同一个 id 首次出现时记录，供耗时秒表使用。 */
  const startedAtRef = useRef<Map<string, number>>(new Map());
  const pendingRef = useRef<ProgressMap>({});
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = {};
    setEvents((current) => ({ ...current, ...pending }));
  }, []);

  const publish = useCallback(
    (event: TaskProgressEvent) => {
      pendingRef.current[event.id] = event;
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(flush);
      }
    },
    [flush]
  );

  useEffect(() => {
    const offLegacy = window.imageStudio.onProgress((raw) => {
      let startedAt = startedAtRef.current.get(raw.requestId);
      if (startedAt === undefined) {
        startedAt = Date.now();
        startedAtRef.current.set(raw.requestId, startedAt);
      }
      publish(normalizeLegacyProgress(raw, startedAt));
    });
    const offUnified = window.imageStudio.onProgressUpdate((event) => publish(event));
    return () => {
      offLegacy();
      offUnified();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [publish]);

  const value = useMemo<ProgressContextValue>(() => ({ events, publish }), [events, publish]);
  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

/** 全部进度事件（按 id 索引）。 */
export function useProgressEvents(): ProgressMap {
  return useContext(ProgressContext).events;
}

/** 按 id 读取单个进度事件（id 缺省时返回 undefined）。 */
export function useProgressEvent(id: string | undefined): TaskProgressEvent | undefined {
  const { events } = useContext(ProgressContext);
  return id === undefined ? undefined : events[id];
}

/** 取得 publish：供渲染层本地进度源汇入统一 Map。 */
export function useProgressPublisher(): (event: TaskProgressEvent) => void {
  return useContext(ProgressContext).publish;
}

/** 每秒 tick 的"当前时刻"；仅在 running 且已知 startedAt 时启动计时器。 */
export function useElapsedNow(startedAt: number | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || startedAt === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  return now;
}
