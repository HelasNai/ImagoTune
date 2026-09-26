import { useEffect, useState } from "react";

/**
 * 为 Blob/File 创建对象 URL，并在 blob 变化或组件卸载时自动 revoke。
 * 用「effect + state」而非 useMemo：StrictMode 双执行下 useMemo 可能生成两个 URL 而泄漏一个，
 * effect 的清理函数保证每次生成的 URL 都被撤销。
 */
export function useObjectUrl(blob: Blob | null | undefined): string {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}
