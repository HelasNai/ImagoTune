/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/webgpu";
import { boxBlurMask, chooseTileSize, nms, resizeAlphaBilinear, solveAffine, tileOrigins, validateUpscaleOutput } from "../lib/local-ai";

type Pixels = { width: number; height: number; data: ArrayBuffer };
type Device = "webgpu" | "wasm";
type WorkerTask = {
  id: string;
  type: "load" | "upscale" | "removeBackground" | "restoreFace" | "pipeline" | "cancel";
  source?: Pixels;
  modelUrls?: Partial<Record<LocalAIModelId, string>>;
  scale?: 2 | 4;
  feather?: number;
  edgeRefine?: boolean;
  strength?: number;
  allFaces?: boolean;
};
type Face = { box: [number, number, number, number]; points: Array<[number, number]>; score: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const sessions = new Map<string, { session: ort.InferenceSession; device: Device }>();
const cancelled = new Set<string>();

function progress(id: string, phase: string, value: number, message: string, device?: Device) {
  scope.postMessage({ type: "progress", id, phase, progress: value, message, device });
}
function ensureActive(id: string) {
  if (cancelled.has(id)) throw new DOMException("任务已取消", "AbortError");
}
function pixels(value: Pixels) {
  return { width: value.width, height: value.height, data: new Uint8ClampedArray(value.data) };
}

async function getSession(id: string, modelUrl: string, taskId: string, preferWebGPU = true) {
  const cached = sessions.get(id);
  if (cached) return cached;
  progress(taskId, "load", 5, `正在加载 ${id} 模型`);
  if (preferWebGPU && "gpu" in navigator) {
    try {
      const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
      const value = { session, device: "webgpu" as const };
      sessions.set(id, value);
      return value;
    } catch {
      progress(taskId, "load", 8, `${id} 的 WebGPU 会话不可用，正在回退 WASM`, "wasm");
    }
  }
  ort.env.wasm.numThreads = Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1));
  const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const value = { session, device: "wasm" as const };
  sessions.set(id, value);
  return value;
}

function nchwFromRgba(data: Uint8ClampedArray, width: number, height: number, order: "rgb" | "bgr" = "rgb", normalize: "zero-one" | "minus-one-one" | "raw" = "zero-one") {
  const output = new Float32Array(width * height * 3);
  const channels = order === "rgb" ? [0, 1, 2] : [2, 1, 0];
  for (let channel = 0; channel < 3; channel += 1) for (let index = 0; index < width * height; index += 1) {
    const raw = data[index * 4 + channels[channel]];
    output[channel * width * height + index] = normalize === "raw" ? raw : normalize === "minus-one-one" ? raw / 127.5 - 1 : raw / 255;
  }
  return output;
}

function sampleRgba(source: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const offset = (iy * width + ix) * 4;
  return [source[offset], source[offset + 1], source[offset + 2], source[offset + 3]];
}

function resizeRgba(source: Uint8ClampedArray, width: number, height: number, outputWidth: number, outputHeight: number) {
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) for (let x = 0; x < outputWidth; x += 1) {
    const rgba = sampleRgba(source, width, height, (x + 0.5) * width / outputWidth - 0.5, (y + 0.5) * height / outputHeight - 0.5);
    output.set(rgba, (y * outputWidth + x) * 4);
  }
  return output;
}

async function upscale(task: WorkerTask, input: ReturnType<typeof pixels>, scale: 2 | 4, tileOverride?: number, forceWasm = false) {
  const check = validateUpscaleOutput(input.width, input.height, scale);
  if (!check.ok) throw new Error(check.error);
  const modelId = scale === 2 ? "realesrgan-x2" : "realesrgan-x4";
  const modelUrl = task.modelUrls?.[modelId];
  if (!modelUrl) throw new Error(`缺少 ${modelId} 模型`);
  let holder = await getSession(modelId, modelUrl, task.id, !forceWasm);
  const tileSize = tileOverride || chooseTileSize(holder.device, input.width, input.height);
  const pad = 16;
  const output = new Uint8ClampedArray(check.width * check.height * 4);
  const alpha = resizeAlphaBilinear(input.data, input.width, input.height, check.width, check.height);
  const origins = tileOrigins(input.width, tileSize).flatMap((x) => tileOrigins(input.height, tileSize).map((y) => [x, y] as const));
  let tileIndex = 0;
  while (tileIndex < origins.length) {
    ensureActive(task.id);
    const [x, y] = origins[tileIndex];
    const coreWidth = Math.min(tileSize, input.width - x); const coreHeight = Math.min(tileSize, input.height - y);
    const tileWidth = coreWidth + pad * 2; const tileHeight = coreHeight + pad * 2;
    const rgba = new Uint8ClampedArray(tileWidth * tileHeight * 4);
    for (let ty = 0; ty < tileHeight; ty += 1) for (let tx = 0; tx < tileWidth; tx += 1) {
      rgba.set(sampleRgba(input.data, input.width, input.height, x + tx - pad, y + ty - pad), (ty * tileWidth + tx) * 4);
    }
    try {
      const tensor = new ort.Tensor("float32", nchwFromRgba(rgba, tileWidth, tileHeight), [1, 3, tileHeight, tileWidth]);
      const result = await holder.session.run({ [holder.session.inputNames[0]]: tensor });
      const value = result[holder.session.outputNames[0]].data as Float32Array;
      const outWidth = tileWidth * scale; const outHeight = tileHeight * scale; const plane = outWidth * outHeight;
      for (let oy = 0; oy < coreHeight * scale; oy += 1) for (let ox = 0; ox < coreWidth * scale; ox += 1) {
        const sourceIndex = (oy + pad * scale) * outWidth + ox + pad * scale;
        const targetIndex = ((y * scale + oy) * check.width + x * scale + ox) * 4;
        output[targetIndex] = Math.max(0, Math.min(255, Math.round(value[sourceIndex] * 255)));
        output[targetIndex + 1] = Math.max(0, Math.min(255, Math.round(value[plane + sourceIndex] * 255)));
        output[targetIndex + 2] = Math.max(0, Math.min(255, Math.round(value[plane * 2 + sourceIndex] * 255)));
        output[targetIndex + 3] = alpha[targetIndex / 4];
      }
      tileIndex += 1;
      progress(task.id, "inference", 12 + Math.round(tileIndex / origins.length * 78), `超分分块 ${tileIndex}/${origins.length}`, holder.device);
    } catch (error) {
      if (tileSize > 64) {
        const smallerTile = Math.max(64, Math.floor(tileSize / 2));
        progress(task.id, "inference", 12, `显存不足，分块缩小至 ${smallerTile}px 后重试`, holder.device);
        return upscale(task, input, scale, smallerTile, forceWasm);
      }
      if (holder.device === "webgpu") {
        sessions.delete(modelId);
        holder = await getSession(modelId, modelUrl, task.id, false);
        progress(task.id, "inference", 12, "WebGPU 推理失败，已回退 WASM", "wasm");
        return upscale(task, input, scale, 64, true);
      }
      throw error;
    }
  }
  return { width: check.width, height: check.height, data: output, device: holder.device, modelId };
}

async function removeBackground(task: WorkerTask, input: ReturnType<typeof pixels>) {
  const url = task.modelUrls?.["isnet-general"];
  if (!url) throw new Error("缺少 ISNet 模型");
  const holder = await getSession("isnet-general", url, task.id);
  progress(task.id, "preprocess", 12, "正在准备 1024px 分割输入", holder.device);
  const resized = resizeRgba(input.data, input.width, input.height, 1024, 1024);
  const tensorData = nchwFromRgba(resized, 1024, 1024);
  for (let index = 0; index < tensorData.length; index += 1) tensorData[index] -= 0.5;
  ensureActive(task.id);
  const result = await holder.session.run({ [holder.session.inputNames[0]]: new ort.Tensor("float32", tensorData, [1, 3, 1024, 1024]) });
  const raw = result[holder.session.outputNames[0]].data as Float32Array;
  const plane = raw.length >= 1024 * 1024 ? raw.subarray(0, 1024 * 1024) : raw;
  let min = Infinity; let max = -Infinity;
  for (const value of plane) { min = Math.min(min, value); max = Math.max(max, value); }
  const normalized = new Float32Array(1024 * 1024);
  const span = Math.max(1e-6, max - min);
  for (let index = 0; index < normalized.length; index += 1) normalized[index] = (plane[index] - min) / span;
  const resizedMask = new Float32Array(input.width * input.height);
  for (let y = 0; y < input.height; y += 1) for (let x = 0; x < input.width; x += 1) {
    const sx = Math.min(1023, Math.max(0, Math.round((x + 0.5) * 1024 / input.width - 0.5)));
    const sy = Math.min(1023, Math.max(0, Math.round((y + 0.5) * 1024 / input.height - 0.5)));
    let value = normalized[sy * 1024 + sx];
    if (task.edgeRefine !== false) value = Math.max(0, Math.min(1, (value - 0.08) / 0.84));
    resizedMask[y * input.width + x] = value;
  }
  const mask = boxBlurMask(resizedMask, input.width, input.height, Math.max(0, Math.min(8, Math.round(task.feather || 2))));
  const output = new Uint8ClampedArray(input.data);
  for (let index = 0; index < mask.length; index += 1) output[index * 4 + 3] = Math.round(output[index * 4 + 3] * mask[index]);
  progress(task.id, "compose", 92, "已保留原始 RGB，仅更新透明通道", holder.device);
  return { width: input.width, height: input.height, data: output, device: holder.device, modelId: "isnet-general" };
}

function decodeYuNet(outputs: ort.InferenceSession.OnnxValueMapType, width: number, height: number) {
  const faces: Face[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = outputs[`cls_${stride}`]?.data as Float32Array | undefined;
    const obj = outputs[`obj_${stride}`]?.data as Float32Array | undefined;
    const bbox = outputs[`bbox_${stride}`]?.data as Float32Array | undefined;
    const kps = outputs[`kps_${stride}`]?.data as Float32Array | undefined;
    if (!cls || !obj || !bbox || !kps) continue;
    const columns = Math.ceil(width / stride); const rows = Math.ceil(height / stride);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (index >= cls.length || index >= obj.length) continue;
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[index])) * Math.max(0, Math.min(1, obj[index])));
      if (score < 0.65) continue;
      const centerX = (column + bbox[index * 4]) * stride;
      const centerY = (row + bbox[index * 4 + 1]) * stride;
      const boxWidth = Math.exp(bbox[index * 4 + 2]) * stride;
      const boxHeight = Math.exp(bbox[index * 4 + 3]) * stride;
      const points = Array.from({ length: 5 }, (_, point) => [
        (column + kps[index * 10 + point * 2]) * stride,
        (row + kps[index * 10 + point * 2 + 1]) * stride,
      ] as [number, number]);
      faces.push({ box: [centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight], points, score });
    }
  }
  return nms(faces, 0.3, 10);
}

function invertAffine(matrix: [number, number, number, number, number, number]) {
  const [a, b, c, d, e, f] = matrix; const determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-9) throw new Error("人脸对齐矩阵不可逆");
  return [e / determinant, -b / determinant, (b * f - e * c) / determinant, -d / determinant, a / determinant, (d * c - a * f) / determinant] as const;
}

async function restoreFace(task: WorkerTask, input: ReturnType<typeof pixels>) {
  const detectorUrl = task.modelUrls?.yunet; const restorerUrl = task.modelUrls?.["gfpgan-v1.4"];
  if (!detectorUrl || !restorerUrl) throw new Error("人脸优化需要安装 YuNet 与 GFPGAN 两个模型");
  const detector = await getSession("yunet", detectorUrl, task.id);
  const detectSize = 640;
  const detectInput = resizeRgba(input.data, input.width, input.height, detectSize, detectSize);
  const detectorResult = await detector.session.run({ [detector.session.inputNames[0]]: new ort.Tensor("float32", nchwFromRgba(detectInput, detectSize, detectSize, "bgr", "raw"), [1, 3, detectSize, detectSize]) });
  let faces = decodeYuNet(detectorResult, detectSize, detectSize).map((face) => ({
    ...face,
    box: [face.box[0] * input.width / detectSize, face.box[1] * input.height / detectSize, face.box[2] * input.width / detectSize, face.box[3] * input.height / detectSize] as [number, number, number, number],
    points: face.points.map(([x, y]) => [x * input.width / detectSize, y * input.height / detectSize] as [number, number]),
  }));
  if (!faces.length) throw new Error("未检测到可优化的人脸；侧脸、遮挡或过小人脸可能无法处理");
  faces = faces.filter((face) => Math.min(face.box[2], face.box[3]) >= 40);
  if (!faces.length) throw new Error("检测到的人脸过小（小于约 40px），为避免错误修复已停止处理");
  if (!task.allFaces) faces = faces.slice(0, 1);
  const restorer = await getSession("gfpgan-v1.4", restorerUrl, task.id);
  const output = new Uint8ClampedArray(input.data);
  const targetPoints: Array<[number, number]> = [[196.0, 226.0], [316.0, 226.0], [256.0, 306.0], [213.0, 380.0], [299.0, 380.0]];
  const strength = Math.max(0, Math.min(1, task.strength ?? 0.7));
  for (let faceIndex = 0; faceIndex < Math.min(10, faces.length); faceIndex += 1) {
    ensureActive(task.id);
    const face = faces[faceIndex];
    const affine = solveAffine(face.points, targetPoints);
    const inverse = invertAffine(affine);
    const aligned = new Uint8ClampedArray(512 * 512 * 4);
    for (let y = 0; y < 512; y += 1) for (let x = 0; x < 512; x += 1) aligned.set(sampleRgba(input.data, input.width, input.height, inverse[0] * x + inverse[1] * y + inverse[2], inverse[3] * x + inverse[4] * y + inverse[5]), (y * 512 + x) * 4);
    const restoredResult = await restorer.session.run({ [restorer.session.inputNames[0]]: new ort.Tensor("float32", nchwFromRgba(aligned, 512, 512, "rgb", "minus-one-one"), [1, 3, 512, 512]) });
    const raw = restoredResult[restorer.session.outputNames[0]].data as Float32Array;
    const plane = 512 * 512;
    const [bx, by, bw, bh] = face.box;
    const minX = Math.max(0, Math.floor(bx - bw * 0.35)); const maxX = Math.min(input.width, Math.ceil(bx + bw * 1.35));
    const minY = Math.max(0, Math.floor(by - bh * 0.45)); const maxY = Math.min(input.height, Math.ceil(by + bh * 1.35));
    for (let y = minY; y < maxY; y += 1) for (let x = minX; x < maxX; x += 1) {
      const tx = affine[0] * x + affine[1] * y + affine[2]; const ty = affine[3] * x + affine[4] * y + affine[5];
      if (tx < 0 || tx >= 512 || ty < 0 || ty >= 512) continue;
      const dx = (tx - 256) / 230; const dy = (ty - 282) / 270;
      const feather = Math.max(0, Math.min(1, (1 - Math.sqrt(dx * dx + dy * dy)) / 0.18));
      if (feather <= 0) continue;
      const sourceIndex = Math.round(ty) * 512 + Math.round(tx); const targetIndex = (y * input.width + x) * 4; const blend = feather * strength;
      for (let channel = 0; channel < 3; channel += 1) {
        const restored = Math.max(0, Math.min(255, Math.round(((raw[channel * plane + sourceIndex] as number) + 1) * 127.5)));
        output[targetIndex + channel] = Math.round(output[targetIndex + channel] * (1 - blend) + restored * blend);
      }
    }
    progress(task.id, "compose", 30 + Math.round((faceIndex + 1) / faces.length * 62), `已优化 ${faceIndex + 1}/${faces.length} 张人脸`, restorer.device);
  }
  return { width: input.width, height: input.height, data: output, device: restorer.device, modelId: "gfpgan-v1.4", faceCount: faces.length };
}

async function execute(task: WorkerTask) {
  if (!task.source) throw new Error("尚未提供待处理图片");
  const input = pixels(task.source);
  const startedAt = performance.now();
  let current = input;
  const steps: Array<{ tool: LocalAITool; modelId: string; device: Device; elapsedMs: number; parameters: Record<string, string | number | boolean> }> = [];
  if (task.type === "upscale") {
    const start = performance.now(); const result = await upscale(task, current, task.scale || 2); current = result;
    steps.push({ tool: "upscale", modelId: result.modelId, device: result.device, elapsedMs: Math.round(performance.now() - start), parameters: { scale: task.scale || 2 } });
  } else if (task.type === "removeBackground") {
    const start = performance.now(); const result = await removeBackground(task, current); current = result;
    steps.push({ tool: "remove-background", modelId: result.modelId, device: result.device, elapsedMs: Math.round(performance.now() - start), parameters: { feather: task.feather || 2, edgeRefine: task.edgeRefine !== false } });
  } else if (task.type === "restoreFace") {
    const start = performance.now(); const result = await restoreFace(task, current); current = result;
    steps.push({ tool: "face-restore", modelId: result.modelId, device: result.device, elapsedMs: Math.round(performance.now() - start), parameters: { strength: task.strength ?? 0.7, allFaces: Boolean(task.allFaces), faceCount: result.faceCount } });
  } else if (task.type === "pipeline") {
    let start = performance.now(); const restored = await restoreFace(task, current); current = restored;
    steps.push({ tool: "face-restore", modelId: restored.modelId, device: restored.device, elapsedMs: Math.round(performance.now() - start), parameters: { strength: task.strength ?? 0.7, allFaces: Boolean(task.allFaces), faceCount: restored.faceCount } });
    start = performance.now(); const enlarged = await upscale({ ...task, source: undefined }, current, 2); current = enlarged;
    steps.push({ tool: "upscale", modelId: enlarged.modelId, device: enlarged.device, elapsedMs: Math.round(performance.now() - start), parameters: { scale: 2 } });
    start = performance.now(); const cutout = await removeBackground(task, current); current = cutout;
    steps.push({ tool: "remove-background", modelId: cutout.modelId, device: cutout.device, elapsedMs: Math.round(performance.now() - start), parameters: { feather: task.feather || 2, edgeRefine: task.edgeRefine !== false } });
  } else throw new Error("未知的本地处理任务");
  progress(task.id, "complete", 100, "本地处理完成");
  scope.postMessage({ type: "result", id: task.id, width: current.width, height: current.height, data: current.data.buffer, steps, elapsedMs: Math.round(performance.now() - startedAt) }, [current.data.buffer]);
}

scope.onmessage = (event: MessageEvent<WorkerTask>) => {
  const task = event.data;
  if (task.type === "cancel") { cancelled.add(task.id); return; }
  cancelled.delete(task.id);
  void execute(task).catch((error) => {
    scope.postMessage({ type: "error", id: task.id, cancelled: (error as Error).name === "AbortError", error: (error as Error).message || "本地 AI 处理失败" });
  }).finally(() => cancelled.delete(task.id));
};
