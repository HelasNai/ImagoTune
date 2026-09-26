// 兼容层：媒体助手已迁至 src/lib/media.ts（消除 lib 反向依赖 components 的旧结构）。
// 保留既有导出名（dataUrlFor / b64ToFile / readImage / drawContain 等），调用点无需改动。

export {
  b64FromDataUrl,
  b64ToDataUrl,
  b64ToFile,
  canvasToBlob,
  canvasToPngFile,
  dataUrlFor,
  drawContain,
  fileToDataUrl,
  imageSizeFromFile,
  readImage,
} from "../lib/media";
