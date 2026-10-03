// errors 分片：错误域（error.* 前缀的生成错误 code 与 lib 层错误文案）。
export const errors = {
  "error.network.timeout.title": "Request timed out",
  "error.network.timeout.message": "The image service did not respond within {seconds} seconds.",
} as const;
