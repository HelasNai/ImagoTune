export type LocalAIModelId = "realesrgan-x2" | "realesrgan-x4" | "isnet-general" | "yunet" | "gfpgan-v1.4";

export type LocalAIModelManifest = {
  id: LocalAIModelId;
  name: string;
  fileName: string;
  version: string;
  size: number;
  sha256: string;
  urls: string[];
  license: string;
  sourceUrl: string;
  purpose: "upscale" | "remove-background" | "face-detection" | "face-restoration";
  beta?: boolean;
  input: string;
};

export const LOCAL_AI_MODELS: readonly LocalAIModelManifest[] = [
  {
    id: "realesrgan-x2",
    name: "Real-ESRGAN 2x",
    fileName: "real_esrgan_x2.onnx",
    version: "sceneworks-opset17-2026-06",
    size: 67_100_000,
    sha256: "7115ba92e8a1bfa63d68558ef006ef3d91273a068d321b1439f8bb1c9179002c",
    urls: ["https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/main/real_esrgan_x2.onnx?download=true"],
    license: "BSD-3-Clause",
    sourceUrl: "https://huggingface.co/SceneWorks/real-esrgan-onnx",
    purpose: "upscale",
    input: "RGB float32 [1,3,H,W], 0..1, dynamic H/W",
  },
  {
    id: "realesrgan-x4",
    name: "Real-ESRGAN 4x",
    fileName: "real_esrgan_x4.onnx",
    version: "sceneworks-opset17-2026-06",
    size: 67_100_000,
    sha256: "5c586662929cbc686c1a5c38d9c060dbdb4ea5863a1f7672b8c0761e6b89c033",
    urls: ["https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/main/real_esrgan_x4.onnx?download=true"],
    license: "BSD-3-Clause",
    sourceUrl: "https://huggingface.co/SceneWorks/real-esrgan-onnx",
    purpose: "upscale",
    input: "RGB float32 [1,3,H,W], 0..1, dynamic H/W",
  },
  {
    id: "isnet-general",
    name: "ISNet General Use",
    fileName: "isnet-general-use.onnx",
    version: "rembg-v0.0.0",
    size: 178_648_008,
    sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
    urls: [
      "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
      "https://huggingface.co/tomjackson2023/rembg/resolve/main/isnet-general-use.onnx?download=true",
    ],
    license: "MIT (rembg distribution; model source attribution in README)",
    sourceUrl: "https://github.com/danielgatis/rembg",
    purpose: "remove-background",
    input: "RGB float32 [1,3,1024,1024], mean 0.5 / std 1",
  },
  {
    id: "yunet",
    name: "YuNet face detector",
    fileName: "face_detection_yunet_2026may.onnx",
    version: "opencv-zoo-2026may",
    size: 229_738,
    sha256: "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0",
    urls: ["https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2026may.onnx"],
    license: "MIT",
    sourceUrl: "https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet",
    purpose: "face-detection",
    input: "BGR float32 [1,3,H,W], 0..255, dynamic H/W",
  },
  {
    id: "gfpgan-v1.4",
    name: "GFPGAN v1.4 ONNX",
    fileName: "GFPGANv1.4.onnx",
    version: "neus-conversion-6c8b1d3",
    size: 340_256_686,
    sha256: "cd7311b8d9e13cdb1e208b12363182da58c7bf45e26d1aa67bbeac4751aae92e",
    urls: ["https://huggingface.co/Neus/GFPGANv1.4/resolve/main/GFPGANv1.4.onnx?download=true"],
    license: "Apache-2.0 upstream; third-party ONNX conversion",
    sourceUrl: "https://huggingface.co/Neus/GFPGANv1.4",
    purpose: "face-restoration",
    beta: true,
    input: "RGB float32 [1,3,512,512], -1..1",
  },
] as const;

export function localAIModelById(id: string) {
  return LOCAL_AI_MODELS.find((model) => model.id === id);
}
