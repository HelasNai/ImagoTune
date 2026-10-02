// 扩图目标尺寸上限常量（单一来源）。
// 值与渲染层 src/lib/creative.ts 的同名具名常量一致，由 tests/outpaint-limits.test.ts 跨层一致性测试锁定。
// 注意：本模块只提供常量，不统一两端的校验函数——creative 侧含最小像素与 3:1 语义，outpaint 侧含“目标≥源”语义。
export const CANVAS_MULTIPLE = 16;
export const CANVAS_MAX_EDGE = 3840;
export const CANVAS_MAX_PIXELS = 14_745_600;
