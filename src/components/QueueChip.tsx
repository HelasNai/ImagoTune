import React from "react";
import { t } from "../lib/i18n";
import { useProgressEvents } from "./ProgressContext";
import { Tooltip } from "./Tooltip";

/**
 * 顶栏任务队列入口（增强态 v3.6）。
 * - 空闲：仅「任务队列 N」；有活跃任务（queued/running）时：脉冲点 + 活跃数 + 运行中实时进度；
 * - 进度仅在事件存在且明确时显示，绝不用时间映射伪造百分比（沿用统一进度契约）;
 * - 点击跳转队列页；不承载任何队列操作。
 */
export function QueueChip({ queueItems, onOpen }: { queueItems: QueueJob[]; onOpen: () => void }) {
  const progressEvents = useProgressEvents();
  const activeCount = queueItems.filter((job) => job.status === "queued" || job.status === "running").length;
  const running = queueItems.find((job) => job.status === "running");
  const live = running ? progressEvents[running.requestId] : undefined;
  const percent = live && live.state === "running" && live.progress !== undefined ? Math.round(live.progress) : undefined;
  return (
    <Tooltip content={t("任务队列")}>
      <button className={activeCount > 0 ? "queue-chip queue-chip-active" : "queue-chip"} onClick={onOpen}>
        {activeCount > 0 && <i className="queue-chip-pulse" aria-hidden="true" />}
        {t("任务队列")} <strong>{activeCount}</strong>
        {percent !== undefined && <span className="queue-chip-percent">{percent}%</span>}
      </button>
    </Tooltip>
  );
}
