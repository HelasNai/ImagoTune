// queue 分片：队列与结果域（QueuePanel / ResultPanel / ProgressBar / QueueChip）。
// key = 中文文案（重复串加 `|语境` 后缀消歧）；value = 英文（复数用 `one|other` 分段）。
export const queue = {
  任务队列: "Queue",

  // ===================== T21：队列 / 结果 / 进度 =====================
  // 队列状态词（format.ts queueStatusLabel）已由 en/core.ts 承载，此处不重复。
  // 按钮复用已有 key：取消→core.ts；复制图片 / 图片已复制到剪贴板 / 智能扩图 /
  // 高清放大 / 智能抠图 → en/shell.ts；取消失败→en/errors.ts（`|任务` 后缀）。

  // --- QueuePanel ---
  "已删除的供应商|队列": "Deleted provider",
  清空历史记录: "Clear history",
  "将移除所有已完成、失败、取消和中断的任务记录（正在排队与运行的任务会保留）。已归档到图库的图片不受影响。":
    "This removes all completed, failed, cancelled, and interrupted task records (queued and running tasks are kept). Images already archived to the gallery are not affected.",
  清空历史: "Clear history",
  清空失败: "Failed to clear the history",
  "刷新|队列": "Refresh",
  生成任务队列: "Generation task queue",
  "所有任务按顺序提交，避免并发限流和意外重复计费。":
    "All tasks are submitted in order to avoid concurrency rate limits and accidental duplicate charges.",
  队列为空: "Queue is empty",
  "提交生成或变体后，任务会显示在这里。":
    "Tasks will appear here after you submit a generation or variation.",
  "尝试 {n} 次": "{n} attempt|{n} attempts",
  "用时 {duration}": "Elapsed {duration}",
  "前面还有 {n} 个任务": "{n} task ahead|{n} tasks ahead",
  "重试|队列": "Retry",
  "重试失败|队列": "Retry failed",
  "移除|队列": "Remove",
  "移除失败|队列": "Remove failed",
  "生成结果|结果": "Generated results",
  "重试使用哪个配置？原任务保存的是「{provider}」。":
    "Which configuration should the retry use? The original task saved \"{provider}\".",
  "原供应商（{provider}）": "Original provider ({provider})",
  "当前配置（{provider}）": "Current configuration ({provider})",

  // --- ResultPanel ---
  "1:1 方图": "1:1 square",
  "4:5 竖图": "4:5 portrait",
  "16:9 横图": "16:9 landscape",
  "9:16 竖图": "9:16 portrait",
  导出尺寸无效: "Invalid export size",
  无法创建导出画布: "Could not create the export canvas",
  "已保存：{path}": "Saved: {path}",
  "导出失败|结果": "Export failed",
  "社交平台成品已保存：{path}": "Social export saved: {path}",
  "{n} 张图片 · 点击查看大图": "{n} image · click to view|{n} images · click to view",
  生成后的图片会显示在这里: "Generated images will appear here",
  "队列、项目、变体与交付工具会保留你的创作过程。":
    "The queue, projects, variations, and delivery tools keep your creative process.",
  "新生成图片|结果": "New image",
  "Seed：{seed} · 点击复制": "Seed: {seed} · click to copy",
  "Seed 已复制": "Seed copied",
  "保存 PNG|结果": "Save PNG",
  "提示词已复制|结果": "Prompt copied",
  "复制提示词|结果": "Copy prompt",
  "完整参数已复制|结果": "Full parameters copied",
  "复制参数|结果": "Copy parameters",
  "再生成|结果": "Generate again",
  "继续编辑|结果": "Continue editing",
  "社媒导出|结果": "Social export",
  "人脸优化|结果": "Face restore",
  社交平台画布适配: "Social canvas fit",
  待导出图片: "Image to export",
  "目标尺寸|结果": "Target size",
  "背景填充|结果": "Background fill",
  浅色留白: "Light padding",
  模糊延展: "Blur extension",
  "导出 PNG|结果": "Export PNG",

  // --- ProgressBar ---
  "阶段 {i}/{n}": "Stage {i}/{n}",
  "已用时 {t}": "Elapsed {t}",

  // ipc.queue.* — 主进程队列 IPC 失败码（T24；zh 走 handler 中文 error 回退）。
  "ipc.queue.noBinding": "No image model configured yet",
  "ipc.queue.enqueueFailed": "Could not create the task",
  "ipc.queue.notRetryable": "This task cannot be retried",
  "ipc.queue.notCancellable": "This task cannot be cancelled",
  "ipc.queue.runningNotRemovable": "A running task cannot be removed",
  "ipc.queue.clearFailed": "Failed to clear the history",
} as const;
