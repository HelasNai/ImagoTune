export const LOCAL_AI_MAX_EDGE = 8192;
export const LOCAL_AI_MAX_PIXELS = 70_000_000;

export function validateUpscaleOutput(width: number, height: number, scale: 2 | 4) {
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { ok: false as const, error: "图片尺寸无效" };
  }
  if (Math.max(outputWidth, outputHeight) > LOCAL_AI_MAX_EDGE) {
    return { ok: false as const, error: `输出最长边 ${Math.max(outputWidth, outputHeight)} px，超过 8192 px 限制` };
  }
  if (outputWidth * outputHeight > LOCAL_AI_MAX_PIXELS) {
    return { ok: false as const, error: `输出约 ${(outputWidth * outputHeight / 1_000_000).toFixed(1)} 百万像素，超过 7000 万像素限制` };
  }
  return { ok: true as const, width: outputWidth, height: outputHeight };
}

export function chooseTileSize(device: "webgpu" | "wasm", width: number, height: number) {
  const pixels = width * height;
  if (device === "webgpu") return pixels > 4_000_000 ? 128 : 256;
  return pixels > 2_000_000 ? 64 : 128;
}

export function tileOrigins(length: number, tileSize: number) {
  const values: number[] = [];
  for (let value = 0; value < length; value += tileSize) values.push(value);
  return values;
}

export function resizeAlphaBilinear(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
) {
  const output = new Uint8ClampedArray(outputWidth * outputHeight);
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = (y + 0.5) * height / outputHeight - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.max(0, sourceY - y0);
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = (x + 0.5) * width / outputWidth - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.max(0, sourceX - x0);
      const a00 = rgba[(y0 * width + x0) * 4 + 3];
      const a10 = rgba[(y0 * width + x1) * 4 + 3];
      const a01 = rgba[(y1 * width + x0) * 4 + 3];
      const a11 = rgba[(y1 * width + x1) * 4 + 3];
      output[y * outputWidth + x] = Math.round((a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy);
    }
  }
  return output;
}

export function boxBlurMask(mask: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) return new Float32Array(mask);
  const horizontal = new Float32Array(mask.length);
  const output = new Float32Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0; let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceX = Math.max(0, Math.min(width - 1, x + offset));
        sum += mask[y * width + sourceX]; count += 1;
      }
      horizontal[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0; let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceY = Math.max(0, Math.min(height - 1, y + offset));
        sum += horizontal[sourceY * width + x]; count += 1;
      }
      output[y * width + x] = sum / count;
    }
  }
  return output;
}

export function iou(a: [number, number, number, number], b: [number, number, number, number]) {
  const x1 = Math.max(a[0], b[0]); const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]); const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return intersection / Math.max(1e-6, a[2] * a[3] + b[2] * b[3] - intersection);
}

export function nms<T extends { box: [number, number, number, number]; score: number }>(items: T[], threshold = 0.3, limit = 10) {
  const remaining = [...items].sort((a, b) => b.score - a.score);
  const selected: T[] = [];
  while (remaining.length && selected.length < limit) {
    const current = remaining.shift()!;
    selected.push(current);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (iou(current.box, remaining[index].box) >= threshold) remaining.splice(index, 1);
    }
  }
  return selected;
}

export function solveAffine(source: Array<[number, number]>, target: Array<[number, number]>) {
  if (source.length !== target.length || source.length < 3) throw new Error("至少需要三个匹配点");
  const matrix = Array.from({ length: 6 }, () => Array(7).fill(0) as number[]);
  for (let index = 0; index < source.length; index += 1) {
    const [x, y] = source[index]; const [u, v] = target[index];
    const rows = [[x, y, 1, 0, 0, 0, u], [0, 0, 0, x, y, 1, v]];
    for (const row of rows) for (let i = 0; i < 6; i += 1) for (let j = 0; j < 7; j += 1) matrix[i][j] += row[i] * row[j];
  }
  for (let column = 0; column < 6; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 6; row += 1) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const value = matrix[column][column];
    if (Math.abs(value) < 1e-9) throw new Error("人脸关键点无法对齐");
    for (let j = column; j < 7; j += 1) matrix[column][j] /= value;
    for (let row = 0; row < 6; row += 1) if (row !== column) {
      const factor = matrix[row][column];
      for (let j = column; j < 7; j += 1) matrix[row][j] -= factor * matrix[column][j];
    }
  }
  return matrix.map((row) => row[6]) as [number, number, number, number, number, number];
}
