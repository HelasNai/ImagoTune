// 队列展示排序（渲染层纯逻辑，与持久层解耦）。
// 持久层（electron/queue-store.ts）的数组顺序是执行顺序（FIFO）契约，绝不能改动；
// 本模块只决定「队列页从上到下怎么显示」，不涉及 IPC / React。

const ACTIVE_QUEUE_STATUSES = new Set<QueueStatus>(["queued", "running"]);

/** 是否为活跃任务（排队中 / 运行中）。 */
export function isActiveQueueStatus(status: QueueStatus) {
  return ACTIVE_QUEUE_STATUSES.has(status);
}

/**
 * 展示排序：活跃任务保持入队顺序置顶（正在运行 / 下一个要执行的排最上），
 * 历史任务（已完成 / 失败 / 取消 / 中断）按时间倒序，**最新完成的在最上**。
 * 入参为持久层原序（早→晚），返回新数组，不修改入参。
 */
export function orderQueueForDisplay(items: QueueJob[]): QueueJob[] {
  const active = items.filter((item) => ACTIVE_QUEUE_STATUSES.has(item.status));
  const history = items.filter((item) => !ACTIVE_QUEUE_STATUSES.has(item.status));
  return [...active, ...history.reverse()];
}

/**
 * 某个排队任务前面还有几个活跃任务（含正在运行的那个）。
 * 按活跃任务的 FIFO 位置计算，与渲染顺序无关——即使列表倒序显示也不会错位。
 */
export function waitingAheadCount(items: QueueJob[], job: QueueJob): number {
  if (job.status !== "queued") return 0;
  const active = items.filter((item) => ACTIVE_QUEUE_STATUSES.has(item.status));
  const index = active.findIndex((item) => item.id === job.id);
  return index < 0 ? 0 : index;
}

/** 非活跃（历史）任务条数，用于「清空历史」按钮的可见性与文案。 */
export function historyQueueCount(items: QueueJob[]): number {
  return items.filter((item) => !ACTIVE_QUEUE_STATUSES.has(item.status)).length;
}
