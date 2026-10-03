// 渲染层共享媒体助手（base64 字符串 / Canvas 导出 / 图片读取）。
// 约束：只使用平台内建能力，不导入 components/、electron/ 或任何第三方包；
// Output 若需要仅以结构类型内联（沿用原 media-utils.ts 做法），避免跨模块类型依赖/循环引用。
import { t } from "./i18n";

/** base64 字符串 → data URL（默认 PNG；JPEG 等其它格式须显式传入 MIME）。 */
export function b64ToDataUrl(b64: string, mime = "image/png"): string {
  return `data:${mime};base64,${b64}`;
}

/**
 * 去除 data URL 的 `data:image/<mime>;base64,` 前缀。
 * 统一为超集语义：大小写不敏感，支持 `image/svg+xml` 等任意 image 子类型。
 */
export function b64FromDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/[^;]+;base64,/i, "");
}

/** 生成结果（结构类型，避免依赖 components/types）→ PNG data URL。 */
export function dataUrlFor(output: { b64: string }): string {
  return b64ToDataUrl(output.b64);
}

/** base64 字符串 → PNG File。 */
export function b64ToFile(b64: string, name: string): File {
  const bytes = Uint8Array.from(atob(b64), (value) => value.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
}

// 全仓唯一的 FileReader 使用点。
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 读取图片为 HTMLImageElement；失败文案可参数化以保留调用点原有措辞。 */
export function readImage(file: File, message = t("无法读取图片|媒体")): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(message));
    };
    image.src = url;
  });
}

/** 读取图片的原始宽高（原 MaskPainter.tsx 的 readDimensions）。 */
export function imageSizeFromFile(
  file: File,
  message = t("无法读取图片尺寸"),
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(message));
    };
    image.src = url;
  });
}

/** Canvas → Blob（成功回调为 null 时原样 resolve null，保留各调用点的空值处理）。 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number,
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Canvas → PNG File；导出失败返回 null。 */
export async function canvasToPngFile(canvas: HTMLCanvasElement, name: string): Promise<File | null> {
  const blob = await canvasToBlob(canvas);
  return blob ? new File([blob], name, { type: "image/png" }) : null;
}

/** 保持比例把图片等比缩放居中绘制到指定矩形内。 */
export function drawContain(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}
