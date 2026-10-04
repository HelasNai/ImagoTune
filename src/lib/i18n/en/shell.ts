// shell 分片：应用壳层（main.tsx 导航/灯箱/toast/StudioContext 与 update.* code）。
// key = 中文文案（重复串加 `|语境` 后缀消歧）；value = 英文（复数用 `one|other` 分段）。
export const shell = {
  // 侧栏导航标签（data-mode 锚点见 T5；字符串本身为用户可见文案）。
  创作生成: "Create",
  图片编辑: "Edit image",
  智能扩图: "Outpaint",
  项目图库: "Gallery",
  本地工具箱: "Local tools",
  设置: "Settings",

  // header 品牌副标题 / 状态
  "本地创作工作台 · 提示词助手 · 项目图库 · 局部重绘 · 批量交付":
    "Local creation workbench · Prompt assistant · Project gallery · Local redraw · Batch delivery",
  已配置: "Configured",
  未配置密钥: "No API key",

  // 通知弹窗（.feedback-toast）外壳
  需要处理: "Action needed",
  操作成功: "Done",
  查看接口详情: "View API details",
  关闭提示: "Dismiss notification",

  // 运行期错误 / 读取失败（经 setError / callIpc fallbackError 进入 toast）
  本地图库读取失败: "Failed to read the local gallery",
  "本地图库读取失败：{message}": "Failed to read the local gallery: {message}",
  请检查保存目录: "Check the save directory",
  队列读取失败: "Failed to read the queue",
  无法读取设置: "Failed to read settings",
  无法读取版本信息: "Failed to read version info",
  任务失败: "Task failed",
  未知错误: "Unknown error",
  "队列任务失败：{message}": "Queue task failed: {message}",
  无法定位文件: "Could not locate the file",
  无法打开文件: "Could not open the file",

  // 队列 / 生成完成通知（模板化）
  "队列任务已完成：{n} 张图片":
    "Queue task completed: {n} image|Queue task completed: {n} images",
  "生成完成，用时 {seconds}。": "Generation complete in {seconds}.",
  "生成完成，用时 {seconds}。已归档到本地图库。":
    "Generation complete in {seconds}. Archived to the local gallery.",
  "生成完成，用时 {seconds}。自动归档已关闭，请按需手动保存 PNG。":
    "Generation complete in {seconds}. Auto-archive is off; save the PNG manually if needed.",
  "生成完成，用时 {seconds}。{warning}": "Generation complete in {seconds}. {warning}",
  "已复用历史参数，可修改提示词后生成": "Reused the saved parameters; edit the prompt and generate",

  // 灯箱 / 右键菜单
  大图预览: "Image preview",
  关闭预览: "Close preview",
  点击空白处或右上角关闭: "Click outside or the top-right corner to close",
  复制图片: "Copy image",
  图片已复制到剪贴板: "Image copied to clipboard",
  用系统应用打开: "Open with system app",
  在文件夹中显示: "Show in folder",
  右键点击图片可复制: "Right-click the image to copy",
  高清放大: "Upscale",
  智能抠图: "Background removal",
  "人脸优化 Beta": "Face restore Beta",
  本地组合处理: "Local pipeline",

  // StudioContext 不变量错误
  "useStudio 必须在 StudioProvider 内使用": "useStudio must be used within StudioProvider",

  // ipc.clipboard.* — 主进程剪贴板 IPC 失败码（T24；zh 走 handler 中文 error 回退）。
  "ipc.clipboard.copyImageFailed": "Invalid image data",
  "ipc.clipboard.noImage": "No usable image in the clipboard",
  "ipc.clipboard.readImageFailed": "Could not read the clipboard image",

  // ipc.updates.* / ipc.directory.* / ipc.png.* — T25（zh 走 handler 中文 error 回退）。
  "ipc.updates.alphaLocked": "The Alpha test channel is not unlocked yet",
  "ipc.updates.channelSaveFailed": "Could not save the update channel setting",
  "ipc.updates.alphaUnlockSaveFailed": "Could not save the Alpha test channel unlock state",
  "ipc.updates.autoUpdateSaveFailed": "Could not save the auto-update setting",
  "ipc.directory.saveDirBusy": "A task is currently generating; wait for it to finish before changing the save location",
  "ipc.directory.modelDirBusy": "A model is currently downloading; pause it or wait for it to finish",
  "ipc.directory.saveChooseFailed": "Could not use the selected save location",
  "ipc.directory.modelChooseFailed": "Could not use the selected model location",
  "ipc.directory.saveResetFailed": "Could not restore the system default save location",
  "ipc.directory.modelResetFailed": "Could not restore the default model location",
  "ipc.png.noRecipe": "No ImagoTune recipe metadata in the PNG",
  "ipc.png.readFailed": "Could not read the PNG metadata",
} as const;
