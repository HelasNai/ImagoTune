// errors 分片：错误域（error.<code>.title|message|suggestion 生成错误词典 + lib 层错误文案）。
// code 定义见 shared/types.d.ts 的 GenerationErrorCode；值不含 `error.` 前缀。
// zh 不查本表——渲染层经 tCode 用主进程存储的中文原文回退；en 才命中此处。
export const errors = {
  "error.parameters.quality.title": "Unsupported quality setting",
  "error.parameters.quality.message": "The current endpoint does not support the selected quality setting.",
  "error.parameters.quality.suggestion": "Switch quality to Auto, then retry manually. The app will not regenerate automatically.",

  "error.content.rejected.title": "Content policy restriction",
  "error.content.rejected.message": "The service did not accept the current content request.",
  "error.content.rejected.suggestion": "Adjust the subject, description, or reference images that may trigger moderation, then submit again manually.",

  "error.http.balance.title": "Insufficient balance or credits",
  "error.http.balance.message": "Your account balance, subscription, quota, or credits may be insufficient.",
  "error.http.balance.suggestion": "Check the balance and subscription status on the API platform, add credits, then submit again.",

  "error.http.unauthorized.title": "Invalid API key or permission",
  "error.http.unauthorized.message": "The API key is invalid or has expired.",
  "error.http.unauthorized.suggestion": "Re-save a valid key in Settings and confirm the image model permission.",

  "error.http.forbidden.title": "Invalid API key or permission",
  "error.http.forbidden.message": "The current key does not have permission to call the image model.",
  "error.http.forbidden.suggestion": "Re-save a valid key in Settings and confirm the image model permission.",

  "error.upload.tooLarge.title": "Upload too large",
  "error.upload.tooLarge.message": "The uploaded image, mask, or request content exceeds the endpoint limit.",
  "error.upload.tooLarge.suggestion": "Compress the source image, use fewer reference images, or lower the target size, then submit again.",

  "error.http.timeout.title": "Request timed out",
  "error.http.timeout.message": "The image service did not respond within the time limit.",
  "error.http.timeout.suggestion": "Try 1K, a single image, and Auto detail, then retry manually later.",

  "error.http.rateLimit.title": "Too many requests",
  "error.http.rateLimit.message": "The service is busy or the concurrency limit has been reached.",
  "error.http.rateLimit.suggestion": "Wait a moment and retry manually; the task queue will keep running serially.",

  "error.http.notFound.title": "Model or endpoint not found",
  "error.http.notFound.message": "The server could not find the requested model or endpoint.",
  "error.http.notFound.suggestion": "Check the provider's API type, base URL, and model name.",

  "error.parameters.size.title": "Incompatible generation parameters",
  "error.parameters.size.message": "The size, ratio, quality, or edit parameters were not accepted by the endpoint.",
  "error.parameters.size.suggestion": "Try 1K, Auto detail, and a single image first, then check custom sizes and masks.",

  "error.http.server.title": "Image service temporarily unavailable",
  "error.http.server.message": "The image service or gateway cannot complete the request right now.",
  "error.http.server.suggestion": "Retry manually later; the app will not bill you again automatically.",

  "error.http.unknown.title": "Generation request failed",
  "error.http.unknown.message": "The endpoint returned an unrecognized error.",
  "error.http.unknown.suggestion": "Check the endpoint details and current parameters, then submit again.",

  "error.cancel.user.title": "Task cancelled",
  "error.cancel.user.message": "The request was cancelled by the user.",
  "error.cancel.user.suggestion": "Adjust the parameters and add it to the queue again.",

  "error.cancel.interrupt.title": "Task interrupted",
  "error.cancel.interrupt.message": "The task was still running when the app closed.",
  "error.cancel.interrupt.suggestion": "Confirm the parameters and retry manually; the app will not bill you again automatically.",

  "error.network.timeout.title": "Request timed out",
  "error.network.timeout.message": "The image service did not respond within {seconds} seconds.",
  "error.network.timeout.suggestion": "Lower to 1K, a single image, and retry manually later.",

  "error.archive.failed.title": "Failed to save the result image",
  "error.archive.failed.message": "The image service returned a result, but the temporary image link could not be saved as a local PNG.",
  "error.archive.failed.suggestion": "Check your network and retry manually; the app will not regenerate or bill you automatically.",

  "error.network.offline.title": "Network connection failed",
  "error.network.offline.message": "The client cannot connect to the current image service.",
  "error.network.offline.suggestion": "Check your network, proxy, and API address, then submit again manually.",

  "error.runtime.unknown.title": "Generation failed",
  "error.runtime.unknown.message": "The generation request failed for an unknown reason.",
  "error.runtime.unknown.suggestion": "Review the details and current parameters, then submit again.",

  // 腾讯混元适配器（T26）：适配器在 GenerationError 上直接携带 code，经 main.ts 的
  // classifyRuntimeError → GenerationErrorInfo 透传，渲染层 renderErrorInfo 本地化。
  "error.hunyuan.singleImage.title": "Single image limit",
  "error.hunyuan.singleImage.message": "This platform generates one image per request.",
  "error.hunyuan.singleImage.suggestion": "Set the number of images to 1 and submit again.",

  "error.hunyuan.sizeUnsupported.title": "Unsupported size for this platform",
  "error.hunyuan.sizeUnsupported.message": "This platform does not support the selected size.",
  "error.hunyuan.sizeUnsupported.suggestion": "Adjust the size and retry; the app will not regenerate automatically.",

  "error.hunyuan.invalidResponse.title": "Generation request failed",
  "error.hunyuan.invalidResponse.message": "The endpoint returned a response that could not be parsed.",
  "error.hunyuan.invalidResponse.suggestion": "Review the details and current parameters, then submit again.",

  "error.hunyuan.noImageUrl.title": "Generation request failed",
  "error.hunyuan.noImageUrl.message": "The endpoint did not return an image URL.",
  "error.hunyuan.noImageUrl.suggestion": "Review the details and current parameters, then submit again.",

  "error.hunyuan.endpointMissing.title": "Model or endpoint not found",
  "error.hunyuan.endpointMissing.message": "The server could not find the requested model or endpoint.",
  "error.hunyuan.endpointMissing.suggestion": "Check the provider's API type, base URL, and model name.",

  // ===================== T23：lib 层错误与 hooks 默认文案 =====================
  // key = 中文原文（重复中文词用 `|语境` 后缀消歧，zh 直通时后缀不进界面）。
  // 涉及并行分片已有词条时直接复用，不在此重复（如「图片已复制到剪贴板」在 shell 分片）。

  // --- lib 层：outpaint / media 错误与默认文案 ---
  "请输入目标宽 x 高，例如 1080x1920": "Enter a target width x height, for example 1080x1920",
  "扩图目标不能小于原图，智能扩图不会裁剪内容": "The outpaint target cannot be smaller than the source; smart outpaint never crops content",
  "请至少扩展一个方向": "Extend at least one direction",
  "无法读取扩图原图": "Could not read the outpaint source image",
  "无法创建扩图画布": "Could not create the outpaint canvas",
  "无法创建扩图蒙版": "Could not create the outpaint mask",
  "无法导出扩图画布": "Could not export the outpaint canvas",
  "无法读取图片|媒体": "Could not read the image",
  "无法读取图片尺寸": "Could not read the image dimensions",

  // --- hooks 默认文案：useCopy / useSaveImage ---
  // 注意：shell 分片另有导航/灯箱用的 "图片已复制到剪贴板"（无后缀）；本 hook 默认文案用
  // `|剪贴板` 后缀自持，避免与并行分片（T14）重复 key。
  "已复制到剪贴板": "Copied to clipboard",
  "图片已复制到剪贴板|剪贴板": "Image copied to clipboard",
  "复制失败": "Copy failed",
  "复制图片失败|剪贴板": "Copy image failed",
  "保存失败|图片": "Save failed",

  // --- 创作域 hook：清晰度选项 label（useComposer qualities；value 不译） ---
  "自动|质量": "Auto",
  "快速草图": "Fast draft",
  "标准": "Standard",
  "最高细节": "Max detail",

  // --- 创作域 hook：useComposer 错误 / 通知 / 默认名 ---
  "无法调整蒙版尺寸": "Could not resize the mask",
  "无法导出匹配尺寸的蒙版": "Could not export the size-matched mask",
  "参考图 {n}：借鉴风格 / 元素": "Reference image {n}: borrow style / elements",
  "主图：保持主体": "Main image: keep the subject",
  "无法读取提示词模板": "Could not load prompt templates",
  "请先输入负面提示词": "Enter a negative prompt first",
  "请先输入提示词再保存模板": "Enter a prompt before saving a template",
  "保存提示词模板": "Save prompt template",
  "我的负面词": "My negative prompt",
  "我的模板": "My template",
  "保存|模板": "Save",
  "模板保存失败": "Failed to save the template",
  "模板已更新": "Template updated",
  "模板已保存": "Template saved",
  "删除模板|标题": "Delete template",
  "删除模板“{title}”吗？": "Delete template “{title}”?",
  "删除|模板": "Delete",
  "模板删除失败": "Failed to delete the template",
  "请先输入提示词": "Enter a prompt first",
  "已应用本地提示词优化，不会产生额外 API 调用": "Applied the local prompt optimization; no extra API call was made",
  "AI 增强失败，原提示词未改变": "AI enhancement failed; the original prompt is unchanged",
  "已通过 {model} 增强提示词": "Prompt enhanced with {model}",
  "请先选择需要反推的图片": "Choose an image to reverse-engineer first",
  "请先到设置页保存 API 密钥": "Save an API key on the Settings page first",
  "图反推失败，原提示词未改变": "Prompt reverse-engineering failed; the original prompt is unchanged",
  "已生成中英文反推提示词，原提示词尚未改变": "Generated Chinese and English reversed prompts; the original prompt is unchanged",
  "反推提示词已追加": "Reversed prompt appended",
  "反推提示词已替换当前内容": "Reversed prompt replaced the current content",
  "请选择有效的图片文件": "Choose a valid image file",
  "最多使用 3 张参考图，超出的图片未导入": "Up to 3 reference images are used; extra images were not imported",
  "已添加 {n} 张参考图": "{n} reference image added|{n} reference images added",
  "剪贴板中没有可用图片": "No usable image in the clipboard",
  "参考图已复制到剪贴板": "Reference image copied to clipboard",
  "请先上传扩图原图": "Upload the outpaint source image first",
  "请先配置生图模型": "Configure an image generation model first",
  "智能扩图需要上传原图": "Smart outpaint needs a source image",
  "图片编辑需要上传原图": "Image editing needs a source image",
  "请设置有效的扩图范围": "Set a valid outpaint range",
  "局部蒙版暂不能与多参考图同时提交。请移除参考图或清空蒙版后再加入队列，避免接口因尺寸不一致而失败。": "A partial mask cannot be submitted together with multiple reference images yet. Remove the reference images or clear the mask before adding it to the queue, so the endpoint does not fail on mismatched sizes.",
  "准备进入队列": "Preparing to queue",
  "扩图尺寸无效": "Invalid outpaint size",
  "图片预处理失败": "Image preprocessing failed",
  "无法创建任务": "Could not create the task",
  "任务已加入队列，将按顺序生成": "Task added to the queue; it will be generated in order",
  "取消失败|任务": "Cancel failed",
  "已取消当前任务": "Current task cancelled",
  "快速预览：1K、自动细节、1 张": "Fast preview: 1K, auto detail, 1 image",
  "稳定创作：2K、自动细节、1 张": "Stable creation: 2K, auto detail, 1 image",
  "最终高清：4K、自动细节、1 张": "Final high-res: 4K, auto detail, 1 image",
  "已带入图片和参数，可局部涂抹蒙版后继续编辑": "Image and parameters loaded; paint a partial mask to continue editing",
  "已进入智能扩图，可选择快捷比例或分别设置四向扩展量": "Smart outpaint ready; choose a quick ratio or set the four directions separately",
} as const;
