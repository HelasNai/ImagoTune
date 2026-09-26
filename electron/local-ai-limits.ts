// 本地 AI 高清放大输出上限常量（electron 侧单一来源）。
// 值与渲染层 src/lib/local-ai.ts 的同名具名常量一致，由 tests/local-ai-limits.test.ts 跨层一致性测试锁定。
// 注意：src/lib/local-ai.ts 保留同名常量——Worker（src/workers/local-ai.worker.ts）在无 IPC 的上下文调用
// validateUpscaleOutput，故不得把常量改为经 IPC 传递，也不改 Worker 消息协议。
export const LOCAL_AI_MAX_EDGE = 8192;
export const LOCAL_AI_MAX_PIXELS = 70_000_000;
