// 统一进度反馈的纯逻辑：旧事件归一化、本地推理阶段进度映射、耗时格式化。
// 本模块只依赖 src/lib/format，不含 React / IPC / 副作用，供 vitest 直接导入。

import { formatDurationSeconds } from "./format";

/** 把数值钳制到 [0, 100]；非有限数（NaN / Infinity）归零。 */
export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * 云生图旧通道（image:progress 的 AppProgress）→ 统一进度事件。
 * startedAt 由调用方在首次见到该 id 时提供（纯函数不读取时钟）。
 */
export function normalizeLegacyProgress(event: AppProgress, startedAt?: number): TaskProgressEvent {
  return {
    id: event.requestId,
    scope: "generate",
    message: event.message ? `${event.status} · ${event.message}` : event.status,
    progress: event.progress,
    startedAt,
    state: event.progress === 100 ? "done" : "running",
  };
}

/**
 * 本地 AI 推理：把 worker 的「当前阶段局部进度」换算为整条流水线的全局进度。
 * 按阶段等分（不猜权重），保证单调不减；单阶段任务的全局值即局部值。
 */
export function mapLocalAIProgress(local: number, stageIndex: number, totalStages: number): number {
  const stages = Math.max(1, Math.floor(totalStages));
  const index = Math.max(0, Math.min(stages - 1, Math.floor(stageIndex)));
  return clampProgress(((index + clampProgress(local) / 100) / stages) * 100);
}

/**
 * 终态优先用 elapsedMs；进行中用 startedAt 与当前时刻差；两者都缺省返回 null（不显示耗时）。
 */
export function formatElapsed(startedAt: number | undefined, now: number, elapsedMs?: number): string | null {
  const ms = elapsedMs !== undefined ? elapsedMs : startedAt !== undefined ? Math.max(0, now - startedAt) : undefined;
  return ms === undefined ? null : formatDurationSeconds(ms);
}
