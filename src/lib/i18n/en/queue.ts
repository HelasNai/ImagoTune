// queue 分片：队列与结果域（QueuePanel / ResultPanel / ProgressBar / QueueChip）。
export const queue = {
  任务队列: "Queue",

  // ipc.queue.* — 主进程队列 IPC 失败码（T24；zh 走 handler 中文 error 回退）。
  "ipc.queue.noBinding": "No image model configured yet",
  "ipc.queue.enqueueFailed": "Could not create the task",
  "ipc.queue.notRetryable": "This task cannot be retried",
  "ipc.queue.notCancellable": "This task cannot be cancelled",
  "ipc.queue.runningNotRemovable": "A running task cannot be removed",
  "ipc.queue.clearFailed": "Failed to clear the history",
} as const;
