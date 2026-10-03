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
} as const;
