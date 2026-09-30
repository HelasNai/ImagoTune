import { useEffect, useRef, useState } from "react";
import { b64ToDataUrl } from "../lib/media";

/**
 * 图库缩略图（懒加载）。
 *
 * - 元素进入视口后才调用 `gallery.thumbnail(id)`，每个挂载实例最多请求一次；
 * - 悬空 id（已删除 / 图库重建后 uuid 失效）或读取失败 → 渲染中性占位，绝不抛出或弹窗；
 * - 加载中渲染同一占位；IntersectionObserver 在卸载时 disconnect（StrictMode 双挂载安全）。
 *
 * @param id 图库条目 id
 * @param alt 图片替代文本（通常传条目标题）
 * @param className 根元素类名（尺寸 / 圆角 / 布局由调用方 CSS 控制）
 * @param onClick 点击回调（参数为目标 id）
 */
export function GalleryThumb({
  id,
  alt,
  className,
  onClick,
}: {
  id: string;
  alt?: string;
  className?: string;
  onClick?: (id: string) => void;
}) {
  const holderRef = useRef<HTMLSpanElement | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const [b64, setB64] = useState<string>("");

  useEffect(() => {
    // id 变化（列表复用同一组件实例）时重置缓存，避免短暂显示上一张图。
    if (lastIdRef.current !== id) {
      lastIdRef.current = id;
      setB64("");
    }
    const holder = holderRef.current;
    if (!holder) return;
    let active = true;
    let requested = false;
    const load = async () => {
      if (requested) return;
      requested = true;
      try {
        const response = await window.imageStudio.gallery.thumbnail(id);
        if (!active) return;
        if (response.ok && response.b64) setB64(response.b64);
        // 失败（悬空 id / 图片文件缺失）：保持占位、静默降级。
      } catch {
        // IPC 拒绝同样降级为占位，不打扰用户。
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void load();
    });
    observer.observe(holder);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [id]);

  return (
    <span ref={holderRef} className={className} onClick={onClick ? () => onClick(id) : undefined}>
      {b64
        ? <img className="gallery-thumb-image" src={b64ToDataUrl(b64, "image/jpeg")} alt={alt} />
        : <span className="gallery-thumb-placeholder" aria-hidden="true" />}
    </span>
  );
}
