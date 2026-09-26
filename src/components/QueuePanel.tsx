import React from "react";
import { formatDateTime } from "../lib/format";
import { recipeFromQueueInput, recipeModeLabel } from "./queue-utils";
import { NavIcon } from "./icons";
import { useIpcAction } from "./ipc";
import { useStudio } from "./StudioContext";

export function QueuePanel({ queueItems, onRefresh }: { queueItems: QueueJob[]; onRefresh: () => Promise<void> }) {
  const { setError } = useStudio();
  const { pending, run } = useIpcAction(setError);

  // 队列操作失败必须显式反馈并刷新列表（原先静默失败）；绝不自动重试任务。
  // 成功路径保持原样：只依赖队列推送更新，不额外刷新。
  const mutate = async (factory: () => Promise<{ ok: boolean; error?: string }>, fallbackError: string) => {
    const result = await run(factory, { fallbackError });
    if (!result) await onRefresh();
  };

  return (
    <section className="card queue-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">TASK QUEUE</span>
          <h2>生成任务队列</h2>
          <small>所有任务按顺序提交，避免并发限流和意外重复计费。</small>
        </div>
        <button className="secondary" onClick={() => void onRefresh()}>刷新</button>
      </div>
      {queueItems.length === 0 ? (
        <div className="empty"><span><NavIcon name="list-todo" size={40} /></span><p>队列为空</p><small>提交生成或变体后，任务会显示在这里。</small></div>
      ) : (
        <div className="queue-list">
          {queueItems.map((job) => (
            <article key={job.id}>
              <div>
                <strong>{recipeModeLabel(recipeFromQueueInput(job.input, job.kind, "1024x1024"))} · {job.status}</strong>
                <small>{formatDateTime(job.createdAt)} · 尝试 {job.attempts} 次</small>
                <p>{recipeFromQueueInput(job.input, job.kind, "1024x1024").prompt}</p>
                {job.errorInfo ? <div className="queue-error"><em>{job.errorInfo.title}：{job.errorInfo.message}</em><small>{job.errorInfo.suggestion}</small></div> : job.error && <em>{job.error}</em>}
              </div>
              <div className="queue-actions">
                {["failed", "interrupted", "cancelled"].includes(job.status) && (
                  <button disabled={pending} onClick={() => void mutate(() => window.imageStudio.queue.retry(job.id), "重试失败")}>重试</button>
                )}
                {["queued", "running"].includes(job.status) && (
                  <button disabled={pending} onClick={() => void mutate(() => window.imageStudio.queue.cancel(job.id), "取消失败")}>取消</button>
                )}
                {job.status !== "running" && (
                  <button disabled={pending} onClick={() => void mutate(() => window.imageStudio.queue.remove(job.id), "移除失败")}>移除</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
