import React from "react";
import { t } from "../lib/i18n";
import { formatElapsed } from "../lib/progress";
import { useElapsedNow } from "./ProgressContext";

/**
 * 统一进度条（纯展示）。
 * progress 有值 = 确定进度（填充 + 百分比）；缺省 = 不确定进度（流光条，不谎报百分比）。
 */
export function ProgressBar({ event }: { event: TaskProgressEvent }) {
  const running = event.state === "running";
  const now = useElapsedNow(event.startedAt, running);
  const elapsed = formatElapsed(event.startedAt, now, event.elapsedMs);
  const progressValue = event.progress;

  return (
    <div className="progress" data-state={event.state}>
      <div className={progressValue === undefined ? "progress-track indeterminate" : "progress-track"}>
        {progressValue !== undefined && <div style={{ width: `${progressValue}%` }} />}
      </div>
      <span>
        {event.message}
        {event.detail ? ` · ${event.detail.toUpperCase()}` : ""}
        {event.totalStages !== undefined && event.totalStages > 1 ? ` · ${t("阶段 {i}/{n}", { i: (event.stageIndex ?? 0) + 1, n: event.totalStages })}` : ""}
        {progressValue === undefined ? "" : ` · ${Math.round(progressValue)}%`}
        {elapsed ? ` · ${t("已用时 {t}", { t: elapsed })}` : ""}
      </span>
    </div>
  );
}
