// data URL 前缀处理的唯一实现（electron 侧）。
//
// 统一为超集语义 `/^data:image\/[^;]+;base64,/i`：
// - 大小写不敏感（`DATA:IMAGE/PNG` 亦被识别）。
// - 匹配任意 image 子类型（含 `image/svg+xml`）。
// 渲染层对应实现为 `src/lib/media.ts` 的 `b64FromDataUrl`，两端行为一致性由
// `tests/data-url.test.ts` 锁住。
//
// 说明：本模块为无副作用纯模块（仅一个纯函数），可被 Vitest 直接导入。
// 不带 trim，保留各调用点原有的裁剪语义。

/** 去除 data URL 的 `data:image/<mime>;base64,` 前缀；不匹配时原样返回。 */
export function stripDataUrlPrefix(value: string): string {
  return value.replace(/^data:image\/[^;]+;base64,/i, "");
}
