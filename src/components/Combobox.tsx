import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";

/** 单个候选项：`hint` 为可选补充说明（如供应商名），仅展示、不参与过滤。 */
export type ComboboxOption = { value: string; label: string; hint?: string };

type ComboboxProps = {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** 下拉列表的 z-index；面板/浮层内使用时传入高于容器的值，避免列表被容器盖住。省略时沿用 CSS 默认（30）。 */
  menuZIndex?: number;
};

type MenuPosition = { left: number; top: number; width: number };

/**
 * 可搜索下拉组件：受控输入 + 内部过滤（label/value 大小写不敏感）。
 * - 点击输入框或 ArrowDown 打开；重新打开展示完整列表。
 * - ArrowDown/ArrowUp 钳制移动高亮项，Enter 选中并关闭，Escape 关闭不选中。
 * - 输入法组合态（isComposing / compositionstart-end 守卫）绝不提交或误选。
 * - 列表经 portal 挂到 .app（与 Dialogs 同模式），按输入框视口矩形 fixed 定位，避免被裁剪。
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  emptyText = t("无匹配项"),
  disabled = false,
  ariaLabel,
  className,
  menuZIndex,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const composingRef = useRef(false);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(keyword) || option.value.toLowerCase().includes(keyword),
    );
  }, [options, query]);

  const updateMenuPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setMenuPos({ left: rect.left, top: rect.bottom + 4, width: rect.width });
  }, []);

  const showList = useCallback(() => {
    if (disabled) return;
    updateMenuPosition();
    setOpen(true);
  }, [disabled, updateMenuPosition]);

  // 点击输入框 / ArrowDown 打开：清空查询，重新打开即完整列表。
  const openList = useCallback(() => {
    setQuery("");
    setActiveIndex(-1);
    showList();
  }, [showList]);

  const closeList = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  const selectOption = useCallback(
    (option: ComboboxOption) => {
      onChange(option.value);
      closeList();
    },
    [closeList, onChange],
  );

  // 点击根节点或 portal 列表之外任意位置关闭（mousedown 先于 click，避免点选项时先关后开）。
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      closeList();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, closeList]);

  // fixed 定位需在容器滚动/窗口缩放时跟随输入框刷新。
  useEffect(() => {
    if (!open) return;
    const handle = () => updateMenuPosition();
    window.addEventListener("resize", handle);
    window.addEventListener("scroll", handle, true);
    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("scroll", handle, true);
    };
  }, [open, updateMenuPosition]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActiveIndex(-1);
    showList();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // 输入法组合态绝不触发选择/关闭（compositionstart/end 守卫兜底部分浏览器 isComposing 缺失）。
    if (event.nativeEvent.isComposing || composingRef.current) return;
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setActiveIndex((index) => (filtered.length === 0 ? -1 : Math.min(filtered.length - 1, index + 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex((index) => (filtered.length === 0 ? -1 : Math.max(0, index - 1)));
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      const active = activeIndex >= 0 && activeIndex < filtered.length ? filtered[activeIndex] : null;
      if (active) selectOption(active);
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      closeList();
    }
  };

  return (
    <div ref={rootRef} className={"combobox " + (className ?? "")}>
      <input
        ref={inputRef}
        className="combobox-input"
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={open ? query : (selected?.label ?? "")}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (!open) openList();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
      />
      {open && menuPos && createPortal(
        <ul
          ref={listRef}
          id={listId}
          className="combobox-list"
          role="listbox"
          aria-label={ariaLabel}
          style={{ position: "fixed", left: menuPos.left, top: menuPos.top, width: menuPos.width, ...(menuZIndex === undefined ? {} : { zIndex: menuZIndex }) }}
        >
          {filtered.length === 0 && <li className="combobox-empty">{emptyText}</li>}
          {filtered.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              className={index === activeIndex ? "combobox-option active" : "combobox-option"}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              {option.label}
              {option.hint && <span className="combobox-hint">{option.hint}</span>}
            </li>
          ))}
        </ul>,
        document.querySelector(".app") ?? document.body,
      )}
    </div>
  );
}
