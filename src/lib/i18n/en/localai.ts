// localai 分片：本地 AI 工具箱（LocalAIToolbox / QuickModelSwitcher / localai.* code）。
export const localai = {
  "本地 AI 工具箱": "Local AI toolbox",

  // --- src/lib/local-ai.ts 校验 / 仿射错误（T23；key = 中文原文，逐调用求值） ---
  "图片尺寸无效": "Invalid image dimensions",
  "输出最长边 {n} px，超过 8192 px 限制": "The longest output edge is {n} px, exceeding the 8192 px limit",
  "输出约 {n} 百万像素，超过 7000 万像素限制": "The output is about {n} megapixels, exceeding the 70-megapixel limit",
  "至少需要三个匹配点": "At least three matching points are required",
  "人脸关键点无法对齐": "Face landmarks could not be aligned",

  // ipc.localai.* — 主进程本地 AI IPC 失败码（T24；zh 走 handler 中文 error 回退）。
  "ipc.localai.notInstalled": "The model is not installed yet",
  "ipc.localai.downloadFailed": "Model download failed",
  "ipc.localai.deleteFailed": "Could not delete the model",
  "ipc.localai.emptyResult": "The local processing result is empty",
  "ipc.localai.archiveFailed": "Failed to archive the local processing result",

  // --- LocalAIToolbox（T20；动作标签 高清放大/智能抠图/人脸优化 Beta/本地组合处理 已由 en/shell.ts 承载，此处不重复） ---
  // 动作引导（actionGuides getter；title 复用 shell 键，summary/output/badge 为本分片）
  "补足纹理与边缘细节，适合放大生成图、插画和产品图。":
    "Restores texture and edge detail; ideal for upscaling generated images, illustrations, and product shots.",
  "输出 2× 或 4× PNG，透明区域保持不变": "Outputs 2× or 4× PNG; transparent areas are preserved",
  正式功能: "Stable",
  "识别主体并移除背景，适合人物、商品和视觉素材。":
    "Detects the subject and removes the background; ideal for portraits, products, and visual assets.",
  "输出透明 PNG，可预览边缘与不同底色": "Outputs a transparent PNG; preview edges against different backgrounds",
  人脸优化: "Face restore",
  "检测并修复模糊或轻微畸变的人脸，原脸按强度混合以降低身份漂移。":
    "Detects and restores blurry or slightly distorted faces, blending the original face by strength to reduce identity drift.",
  "最多处理 10 张人脸，侧脸和遮挡可能无法识别": "Handles up to 10 faces; profiles and occlusions may not be detected",
  一键优化: "One-click enhance",
  "依次执行人脸优化、2× 高清放大和智能抠图。": "Runs face restore, 2× upscaling, and background removal in sequence.",
  "只归档最终成品，任一步失败都不会覆盖原图": "Archives only the final result; a failed step never overwrites the original",
  组合流程: "Pipeline",

  // 页头 / 布局
  "本地 AI 后期工具箱": "Local AI post-processing toolbox",
  "图片只在本机处理（可离线运行），不读取 API 密钥，也不会上传到任何服务。":
    "Images are processed entirely on this device (works offline); no API keys are read and nothing is uploaded to any service.",
  "WebGPU 优先": "WebGPU preferred",
  "本地工具箱能力说明": "Local toolbox capabilities",
  待处理图片: "Source image",
  导入一张图片: "Import an image",
  "点击选择、拖放或从剪贴板粘贴": "Click to choose, drag and drop, or paste from the clipboard",
  "{size} · 原图始终保留": "{size} · the original is always kept",
  导入文件: "Import file",
  粘贴图片: "Paste image",
  "{tool}适合什么？": "What is {tool} for?",

  // 工具参数
  放大倍率: "Upscale factor",
  "2× 原生模型": "2× native model",
  "4× 原生模型": "4× native model",
  "自动分块并保留透明通道；输出最长边不超过 8192 px。":
    "Automatically tiles and preserves the alpha channel; the longest output edge stays within 8192 px.",
  边缘羽化: "Edge feather",
  轻度边缘优化: "Light edge refinement",
  "Beta：侧脸、遮挡和过小人脸可能无法处理；默认混合原脸以降低身份漂移。":
    "Beta: profiles, occlusions, and very small faces may fail; the original face is blended by default to reduce identity drift.",
  修复强度: "Restore strength",
  "处理全部人脸（最多 10 张）": "Process all faces (up to 10)",
  "处理顺序：人脸优化 → 2× 超分 → 智能抠图。任一步失败即停止，不保存中间结果。":
    "Order: face restore → 2× upscale → background removal. Stops at the first failure and saves no intermediate results.",
  "正在本地处理…": "Processing locally…",

  // 结果对比
  "原图 / 处理图": "Original / Result",
  适应窗口: "Fit to window",
  "100% 细节": "100% detail",
  "原图|对比": "Original",
  "处理图|对比": "Result",
  对比位置: "Compare position",
  处理结果会显示在这里: "The result will appear here",
  "完成后自动生成新的图库记录，绝不覆盖原图。":
    "A new gallery record is created on completion; the original is never overwritten.",
  "保存 PNG": "Save PNG",
  背景预览: "Background preview",
  "棋盘格|背景": "Checkerboard",
  "白色|背景": "White",
  "浅灰|背景": "Light gray",
  "自定义|背景": "Custom",

  // 模型管理
  本地模型管理: "Local model manager",
  "模型目录与软件安装位置、图库位置相互独立。更换目录时会复制已安装模型和未完成下载；原目录会保留。":
    "The model folder is independent of the app install location and gallery folder. Changing it copies installed models and unfinished downloads; the original folder is kept.",
  "更换位置|模型": "Change location",
  "打开目录|模型": "Open folder",
  "刷新状态|模型": "Refresh status",
  来源与许可证: "Source & license",
  "已安装|模型": "Installed",
  "已下载 {n}%": "Downloaded {n}%",
  "下载中 {n}%": "Downloading {n}%",
  "校验中|模型": "Verifying",
  "未安装|模型": "Not installed",
  "暂停|模型": "Pause",
  "继续|模型": "Resume",
  "下载|模型": "Download",
  "删除|模型": "Delete",

  // 通知 / 错误 / 进度
  "无法读取图片像素": "Could not read the image pixels",
  "无法打开待处理图片": "Could not open the source image",
  "无法创建结果画布": "Could not create the result canvas",
  "无法读取本地模型状态": "Could not read the local model status",
  "无法读取本地 AI 能力": "Could not read the local AI capabilities",
  "剪贴板中没有图片": "No image in the clipboard",
  "处理完成，但归档失败：{message}": "Processing finished, but archiving failed: {message}",
  "请选择 PNG、JPEG 或 WebP 图片": "Choose a PNG, JPEG, or WebP image",
  "本地图片|源": "Local image",
  "剪贴板图片|源": "Clipboard image",
  等待开始: "Waiting to start",
  "正在检查本地模型": "Checking local models",
  "首次使用需要下载 {name}，完成后可离线使用":
    "First use requires downloading {name}; it works offline once finished",
  "{id} 下载失败": "{id} download failed",
  "{id} 未安装": "{id} is not installed",
  "本地处理已取消，原图未改变": "Local processing was cancelled; the original is unchanged",
  "处理完成，用时 {elapsed}": "Completed in {elapsed}",
  "本地处理完成，成品已作为新图片归档": "Local processing complete; the result is archived as a new image",
  "本地推理 Worker 异常": "Local inference worker error",
  "本地处理失败": "Local processing failed",
  "正在下载 {name}": "Downloading {name}",
  "暂停下载失败": "Could not pause the download",
  "下载失败|模型": "Download failed",
  "删除本地模型": "Delete local model",
  "删除后再次使用该功能需要重新下载模型，确定继续吗？":
    "Using this feature again will require re-downloading the model. Continue?",
  "模型删除失败": "Could not delete the model",
  "无法更换模型位置": "Could not change the model location",
  "模型保存位置已更换；已有模型和未完成下载已复制到新目录":
    "Model location changed; existing models and unfinished downloads were copied to the new folder",
  "无法恢复默认模型位置": "Could not restore the default model location",
  "已恢复系统默认模型位置": "Restored the system default model location",
  "无法打开模型目录": "Could not open the model folder",
  "本地处理结果": "Local processing result",
  "PNG 已保存：{path}": "PNG saved: {path}",
  "已完成|保存": "Done",
  "处理结果已复制到剪贴板": "Result copied to clipboard",

  // --- QuickModelSwitcher（T20；角色名 生图/图反推/提示词增强、{role}供应商/{role}模型、未分配/选择模型/清除/尚未添加供应商。 已在 en/settings.ts 承载） ---
  "模型切换保存失败": "Could not save the model switch",
  "已切换「{role}」模型": "Switched the “{role}” model",
  "「{name}」尚未标注「{role}」模型，请先到设置页标注":
    "“{name}” has no model tagged for “{role}”; tag one on the Settings page first",
  未绑定: "Not bound",
  "未绑定：点击卡片选择": "Not bound: click the card to choose",
  "绑定的供应商已不存在 · {model}": "The bound provider no longer exists · {model}",
  "当前生图模型：{title}（点击快捷切换）": "Current image model: {title} (click to switch)",
  当前模型: "Current models",
  "点击卡片快捷切换模型。图片与数据均保存在本机。":
    "Click a card to switch models. Images and data stay on this device.",
  快捷切换模型: "Quick model switch",
  "关闭|模型面板": "Close",
  去设置添加供应商: "Add a provider in Settings",
  "选择后立即保存；模型需先在设置页标注对应角色。":
    "Saved immediately on selection; models must be tagged for the role on the Settings page first.",
  // 注："正在保存…" 复用 en/settings.ts 既有键（T13），本分片不重复登记。
} as const;
