// core 分片：跨域通用文案（按钮/通用提示/计数模板等）。
// key = 中文文案（重复串加 `|语境` 后缀消歧）；value = 英文（复数用 `one|other` 分段）。
export const core = {
  取消: "Cancel",
  确定: "OK",
  关闭对话框: "Close dialog",
  说明: "Help",
  无匹配项: "No matches",
  "删除|标题": "Delete",
  "已选择 {n} 张": "{n} image selected|{n} images selected",
  // 时长模板（format.ts）：en 输出 "12.3s"。
  "{s} 秒": "{s}s",
  // 队列状态（format.ts queueStatusLabel）。
  排队中: "Queued",
  运行中: "Running",
  已完成: "Completed",
  失败: "Failed",
  已取消: "Cancelled",
  已中断: "Interrupted",
  // 模式文案（format.ts modeLabel）：仅登记本分片唯一键；
  // 图片编辑 / 智能扩图 已由 en/shell.ts 承载（main.tsx 导航标签同键），此处不得重复。
  文生图: "Text to image",
  参考图生成: "Reference generation",
} as const;
