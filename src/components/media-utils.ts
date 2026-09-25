// 共享媒体工具（从 main.tsx 迁出）：main.tsx 与 ResultPanel.tsx 共用同一份实现。
// 约束：零本地导入；Output 仅以结构类型出现，避免跨模块类型依赖/循环引用。

export function dataUrlFor(output: { b64: string }) {
  return "data:image/png;base64," + output.b64;
}

export function b64ToFile(b64: string, name: string) {
  const bytes = Uint8Array.from(atob(b64), (value) => value.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
}

export function readImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    image.src = url;
  });
}

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
