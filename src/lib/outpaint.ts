import { validateCanvasSize } from "./creative";
import { formatPixelSize, parsePixelSize, roundUp16 } from "./format";
import { t } from "./i18n";
import { canvasToPngFile, readImage } from "./media";

export type OutpaintMargins = { top: number; right: number; bottom: number; left: number };
export type OutpaintLayout = OutpaintMargins & {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  x: number;
  y: number;
  targetSize: string;
};

const clampPercent = (value: number) => Math.max(0, Math.min(200, Number(value) || 0));

export function outpaintFromPercent(sourceWidth: number, sourceHeight: number, margins: OutpaintMargins) {
  const left = roundUp16(sourceWidth * clampPercent(margins.left) / 100);
  const requestedRight = roundUp16(sourceWidth * clampPercent(margins.right) / 100);
  const top = roundUp16(sourceHeight * clampPercent(margins.top) / 100);
  const requestedBottom = roundUp16(sourceHeight * clampPercent(margins.bottom) / 100);
  const right = roundUp16(sourceWidth + left + requestedRight) - sourceWidth - left;
  const bottom = roundUp16(sourceHeight + top + requestedBottom) - sourceHeight - top;
  return validateLayout(sourceWidth, sourceHeight, { top, right, bottom, left });
}

export function outpaintToSize(sourceWidth: number, sourceHeight: number, targetSize: string) {
  const parsed = parsePixelSize(targetSize);
  if (!parsed) return { ok: false, error: t("请输入目标宽 x 高，例如 1080x1920") } as const;
  if (parsed.width < sourceWidth || parsed.height < sourceHeight) return { ok: false, error: t("扩图目标不能小于原图，智能扩图不会裁剪内容") } as const;
  const horizontal = parsed.width - sourceWidth;
  const vertical = parsed.height - sourceHeight;
  const left = Math.floor(horizontal / 2);
  const top = Math.floor(vertical / 2);
  return validateLayout(sourceWidth, sourceHeight, {
    left,
    right: horizontal - left,
    top,
    bottom: vertical - top,
  });
}

export function targetSizeForRatio(sourceWidth: number, sourceHeight: number, ratio: string) {
  const match = /^(\d+):(\d+)$/.exec(ratio);
  if (!match) return "";
  const ratioValue = Number(match[1]) / Number(match[2]);
  let targetWidth = sourceWidth;
  let targetHeight = sourceHeight;
  if (sourceWidth / sourceHeight < ratioValue) targetWidth = roundUp16(sourceHeight * ratioValue);
  else targetHeight = roundUp16(sourceWidth / ratioValue);
  return formatPixelSize(roundUp16(targetWidth), roundUp16(targetHeight));
}

function validateLayout(sourceWidth: number, sourceHeight: number, margins: OutpaintMargins) {
  const targetWidth = sourceWidth + margins.left + margins.right;
  const targetHeight = sourceHeight + margins.top + margins.bottom;
  const check = validateCanvasSize(`${targetWidth}x${targetHeight}`);
  if (!check.ok) return { ok: false, error: check.message } as const;
  if (targetWidth === sourceWidth && targetHeight === sourceHeight) return { ok: false, error: t("请至少扩展一个方向") } as const;
  const layout: OutpaintLayout = {
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    x: margins.left,
    y: margins.top,
    targetSize: formatPixelSize(targetWidth, targetHeight),
    ...margins,
  };
  return { ok: true, layout } as const;
}

export function buildOutpaintMaskAlpha(layout: OutpaintLayout) {
  const alpha = new Uint8Array(layout.targetWidth * layout.targetHeight);
  for (let y = layout.y; y < layout.y + layout.sourceHeight; y += 1) {
    alpha.fill(255, y * layout.targetWidth + layout.x, y * layout.targetWidth + layout.x + layout.sourceWidth);
  }
  return alpha;
}

export async function createOutpaintFiles(source: File, layout: OutpaintLayout) {
  const image = await readImage(source, t("无法读取扩图原图"));
  const canvas = document.createElement("canvas");
  canvas.width = layout.targetWidth;
  canvas.height = layout.targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("无法创建扩图画布"));
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, layout.x, layout.y, layout.sourceWidth, layout.sourceHeight);
  const mask = document.createElement("canvas");
  mask.width = layout.targetWidth;
  mask.height = layout.targetHeight;
  const maskContext = mask.getContext("2d");
  if (!maskContext) throw new Error(t("无法创建扩图蒙版"));
  maskContext.clearRect(0, 0, mask.width, mask.height);
  maskContext.fillStyle = "#ffffff";
  maskContext.fillRect(layout.x, layout.y, layout.sourceWidth, layout.sourceHeight);
  const [imageFile, maskFile] = await Promise.all([
    canvasToPngFile(canvas, "image-studio-outpaint-source.png"),
    canvasToPngFile(mask, "image-studio-outpaint-mask.png"),
  ]);
  if (!imageFile || !maskFile) throw new Error(t("无法导出扩图画布"));
  return { image: imageFile, mask: maskFile };
}
