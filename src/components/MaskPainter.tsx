import React, { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type Stroke = { points: Point[]; size: number };
type Dimensions = { width: number; height: number };

function readDimensions(file: File) {
  return new Promise<Dimensions>((resolve, reject) => {
    const image = new Image(); const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取图片尺寸")); };
    image.src = url;
  });
}

function drawStrokes(context: CanvasRenderingContext2D, strokes: Stroke[], scale: number, color: string, erase = false) {
  context.save(); context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = color; context.globalCompositeOperation = erase ? "destination-out" : "source-over";
  for (const stroke of strokes) {
    context.lineWidth = Math.max(8, stroke.size * scale);
    if (stroke.points.length === 1) { const point = stroke.points[0]; context.beginPath(); context.arc(point.x * scale, point.y * scale, context.lineWidth / 2, 0, Math.PI * 2); context.fillStyle = color; context.fill(); continue; }
    context.beginPath(); stroke.points.forEach((point, index) => index === 0 ? context.moveTo(point.x * scale, point.y * scale) : context.lineTo(point.x * scale, point.y * scale)); context.stroke();
  }
  context.restore();
}

async function createMask(strokes: Stroke[], dimensions: Dimensions) {
  if (!strokes.length) return null;
  const canvas = document.createElement("canvas"); canvas.width = dimensions.width; canvas.height = dimensions.height; const context = canvas.getContext("2d"); if (!context) return null;
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); drawStrokes(context, strokes, 1, "#000000", true);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], "image-studio-painted-mask.png", { type: "image/png" }) : null;
}

export function MaskPainter({ image, onMaskChange }: { image: File | null; onMaskChange: (file: File | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null); const drawing = useRef(false); const [dimensions, setDimensions] = useState<Dimensions | null>(null); const [strokes, setStrokes] = useState<Stroke[]>([]); const [brushSize, setBrushSize] = useState(38); const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    setStrokes([]); onMaskChange(null); if (!image) { setDimensions(null); setPreviewUrl(""); return; }
    const url = URL.createObjectURL(image); setPreviewUrl(url); readDimensions(image).then(setDimensions).catch(() => setDimensions(null)); return () => URL.revokeObjectURL(url);
  }, [image, onMaskChange]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !dimensions) return; canvas.width = dimensions.width; canvas.height = dimensions.height; const context = canvas.getContext("2d"); if (!context) return; context.clearRect(0, 0, canvas.width, canvas.height);
    context.save(); context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = "rgba(244,87,154,.56)"; context.fillStyle = "rgba(244,87,154,.56)";
    for (const stroke of strokes) {
      context.lineWidth = Math.max(8, stroke.size);
      if (stroke.points.length === 1) { const point = stroke.points[0]; context.beginPath(); context.arc(point.x, point.y, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); continue; }
      context.beginPath(); stroke.points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)); context.stroke();
    }
    context.restore(); void createMask(strokes, dimensions).then(onMaskChange);
  }, [brushSize, dimensions, onMaskChange, strokes]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(); if (!dimensions) return null;
    return { x: (event.clientX - rect.left) * dimensions.width / rect.width, y: (event.clientY - rect.top) * dimensions.height / rect.height };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => { const point = pointFromEvent(event); if (!point) return; drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); setStrokes(current => [...current, { points: [point], size: brushSize }]); };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const point = pointFromEvent(event); if (!point) return; setStrokes(current => current.length ? [...current.slice(0, -1), { ...current[current.length - 1], points: [...current[current.length - 1].points, point] }] : current); };
  const stop = () => { drawing.current = false; };

  if (!image || !dimensions) return null;
  return <section className="mask-painter"><div className="mask-head"><div><strong>局部重绘蒙版</strong><small>在需要修改的位置涂抹，未涂抹区域将尽量保持不变。</small></div><div className="mask-tools"><label>画笔 <input type="range" min="12" max="120" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} /></label><button type="button" onClick={() => setStrokes(current => current.slice(0, -1))} disabled={!strokes.length}>撤销</button><button type="button" onClick={() => setStrokes([])} disabled={!strokes.length}>清空</button></div></div><div className="mask-canvas" style={{ aspectRatio: dimensions.width + " / " + dimensions.height }}><img src={previewUrl} alt="编辑原图" /><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} /></div></section>;
}
