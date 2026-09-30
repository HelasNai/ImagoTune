import React, { useState } from "react";
import { formatDateTime, formatDurationSeconds, queueStatusLabel } from "../lib/format";
import { historyQueueCount, orderQueueForDisplay, waitingAheadCount } from "../lib/queue";
import { recipeFromQueueInput, recipeModeLabel } from "./queue-utils";
import { NavIcon } from "./icons";
import { useIpcAction } from "./ipc";
import { useDialog } from "./Dialogs";
import { ProgressBar } from "./ProgressBar";
import { useProgressEvents } from "./ProgressContext";
import { useStudio } from "./StudioContext";

export function QueuePanel({ queueItems, onRefresh }: { queueItems: QueueJob[]; onRefresh: () => Promise<void> }) {
  const { setError, roles, providers } = useStudio();
  const { pending, run } = useIpcAction(setError);
  const { requestConfirm } = useDialog();
  // 运行中任务的实时进度（主进程按 requestId 推送；单一运行任务，直接按 job.requestId 命中）。
  const progressEvents = useProgressEvents();
  const currentImageBinding = roles.image;
  const [retryChoice, setRetryChoice] = useState<string | null>(null);
  // 展示排序：活跃（排队/运行）保持入队顺序置顶，历史倒序（最新完成的在最上）。
  const ordered = orderQueueForDisplay(queueItems);
  const historyCount = historyQueueCount(queueItems);

  // 快照供应商已删除时给出可读名称，避免选择行显示裸 id。
  const providerLabel = (id?: string) => id ? (providers.find((p) => p.id === id)?.name ?? "已删除的供应商") : "—";

  // 队列操作失败必须显式反馈并刷新列表（原先静默失败）；绝不自动重试任务。
  // 成功路径保持原样：只依赖队列推送更新，不额外刷新。
  const mutate = async (factory: () => Promise<{ ok: boolean; error?: string }>, fallbackError: string) => {
    const result = await run(factory, { fallbackError });
    if (!result) await onRefresh();
  };

  // 一键清空历史：仅移除非活跃记录；正在排队/运行的任务与图库图片都不受影响。
  const handleClear = async () => {
    const confirmed = await requestConfirm({
      title: "清空历史记录",
      message: "将移除所有已完成、失败、取消和中断的任务记录（正在排队与运行的任务会保留）。已归档到图库的图片不受影响。",
      confirmLabel: "清空历史",
      danger: true,
    });
    if (!confirmed) return;
    await mutate(() => window.imageStudio.queue.clear(), "清空失败");
  };

  // D3 对齐：无快照旧任务（执行期回退当前绑定）或快照与当前 image 绑定一致 → 直接重试，不打扰用户。
  const handleRetryClick = async (job: QueueJob) => {
    if (!job.providerId || (currentImageBinding && job.providerId === currentImageBinding.providerId)) {
      await mutate(() => window.imageStudio.queue.retry(job.id), "重试失败");
      return;
    }
    setRetryChoice((current) => (current === job.id ? null : job.id)); // toggle open
  };

  return (
    <section className="card queue-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">TASK QUEUE</span>
          <h2>生成任务队列</h2>
          <small>所有任务按顺序提交，避免并发限流和意外重复计费。</small>
        </div>
        <div className="queue-head-actions">
          {historyCount > 0 && (
            <button className="secondary" disabled={pending} onClick={() => void handleClear()}>清空历史</button>
          )}
          <button className="secondary" onClick={() => void onRefresh()}>刷新</button>
        </div>
      </div>
      {queueItems.length === 0 ? (
        <div className="empty"><span><NavIcon name="list-todo" size={40} /></span><p>队列为空</p><small>提交生成或变体后，任务会显示在这里。</small></div>
      ) : (
        <div className="queue-list">
          {ordered.map((job) => {
            const live = job.status === "running" ? progressEvents[job.requestId] : undefined;
            const waiting = waitingAheadCount(queueItems, job);
            return (
            <article key={job.id}>
              <div>
                <strong>{recipeModeLabel(recipeFromQueueInput(job.input, job.kind, "1024x1024"))} · {queueStatusLabel(job.status)}</strong>
                <small>{formatDateTime(job.createdAt)} · 尝试 {job.attempts} 次{job.status === "completed" && job.elapsedMs !== undefined ? ` · 用时 ${formatDurationSeconds(job.elapsedMs)}` : ""}{waiting > 0 ? ` · 前面还有 ${waiting} 个任务` : ""}</small>
                <p>{recipeFromQueueInput(job.input, job.kind, "1024x1024").prompt}</p>
                {live && live.state === "running" ? <ProgressBar event={live} /> : null}
                {job.errorInfo ? <div className="queue-error"><em>{job.errorInfo.title}：{job.errorInfo.message}</em><small>{job.errorInfo.suggestion}</small></div> : job.error && <em>{job.error}</em>}
              </div>
              <div className="queue-actions">
                {["failed", "interrupted", "cancelled"].includes(job.status) && (
                  <button disabled={pending} onClick={() => void handleRetryClick(job)}>重试</button>
                )}
                {["queued", "running"].includes(job.status) && (
                  <button disabled={pending} onClick={() => void mutate(() => window.imageStudio.queue.cancel(job.id), "取消失败")}>取消</button>
                )}
                {job.status !== "running" && (
                  <button disabled={pending} onClick={() => void mutate(() => window.imageStudio.queue.remove(job.id), "移除失败")}>移除</button>
                )}
              </div>
              {retryChoice === job.id && (
                <div className="retry-choice">
                  <small>重试使用哪个配置？原任务保存的是「{providerLabel(job.providerId)}」。</small>
                  <button disabled={pending} onClick={() => { setRetryChoice(null); void mutate(() => window.imageStudio.queue.retry(job.id), "重试失败"); }}>
                    原供应商（{providerLabel(job.providerId)}）
                  </button>
                  {currentImageBinding && (
                    <button disabled={pending} onClick={() => { setRetryChoice(null); void mutate(() => window.imageStudio.queue.retry(job.id, { useCurrentBinding: true }), "重试失败"); }}>
                      当前配置（{providerLabel(currentImageBinding.providerId)}）
                    </button>
                  )}
                  <button className="secondary" onClick={() => setRetryChoice(null)}>取消</button>
                </div>
              )}
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
