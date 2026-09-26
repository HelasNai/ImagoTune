import React, { useCallback, useId, useRef } from "react";

// 渲染层统一的「图片文件输入」抽象：单点持有隐藏的原生文件选择框，
// 统一三件此前在各组件里逐字复制的事：
//   1. 取文件：`event.target.files` → 过滤 `file.type.startsWith("image/")` → 只保留合法图片，
//      `multiple: false` 时再截取第一张；
//   2. 重置：change 后清空 `event.currentTarget.value`，使再次选择同一个文件仍能触发 onChange；
//   3. 参数：`accept` / `multiple` 原样透传给原生选择器。
// 触发元素（label / button / 拖放区）由调用方通过 render-prop 渲染，组件只把
// 「打开选择器 (`open`)」「拖放处理 (`dropProps`)」「label 关联 id (`inputId`)」交给它，
// 从而 ComposerPanel 的 4 个 label 上传位与 LocalAIToolbox 的隐藏输入 + 拖放区 + 导入按钮
// 共用同一份逻辑，同时不改变各自的 MIME 集合、多选行为和元素语义。

/** render-prop 暴露给触发元素的三个能力。 */
export type ImageDropInputHelpers = {
  /** 隐藏 input 的 id：`<label htmlFor={inputId}>` 可让点击 label 原生唤起选择器。 */
  inputId: string;
  /** 主动唤起原生选择器：供 `<button onClick={open}>` 使用。 */
  open: () => void;
  /** 拖放支持：展开到拖放目标（label / button）上即可接收拖入的图片。 */
  dropProps: {
    onDragOver: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
  };
};

export function ImageDropInput({
  accept,
  multiple = false,
  onFiles,
  disabled = false,
  children,
}: {
  /** 传给原生选择器的 MIME 过滤（如 `"image/*"` 或 `"image/png,image/jpeg,image/webp"`）。 */
  accept: string;
  /** 是否允许多选；为 false 时只回调第一张图片。 */
  multiple?: boolean;
  /** 仅在至少选中一张图片时回调，回调参数已过滤掉非图片文件。 */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** 渲染触发元素；通过 helpers 绑定打开 / 拖放行为。 */
  children: (helpers: ImageDropInputHelpers) => React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const emit = useCallback(
    (list: FileList | File[] | null) => {
      const images = Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
      if (!images.length) return;
      onFiles(multiple ? images : images.slice(0, 1));
    },
    [multiple, onFiles],
  );

  const open = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  return <>
    {children({
      inputId,
      open,
      dropProps: {
        onDragOver: (event) => { if (!disabled) event.preventDefault(); },
        onDrop: (event) => {
          if (disabled) return;
          event.preventDefault();
          emit(event.dataTransfer.files);
        },
      },
    })}
    <input
      id={inputId}
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      disabled={disabled}
      onChange={(event) => {
        emit(event.currentTarget.files);
        event.currentTarget.value = "";
      }}
    />
  </>;
}
