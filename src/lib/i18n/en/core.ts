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
} as const;
