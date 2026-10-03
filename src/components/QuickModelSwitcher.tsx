import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Combobox } from "./Combobox";
import { NavIcon } from "./icons";
import { t } from "../lib/i18n";
import { callIpc } from "./ipc";
import { useStudio } from "./StudioContext";
import { Tooltip } from "./Tooltip";
import {
  MODEL_ROLES,
  modelRoleLabel,
  buildQuickSwitchPayload,
  firstAnnotatedModel,
  roleModelOptions,
  roleProviderOptions,
} from "../lib/role-options";

type PanelPosition = { left: number; top: number };

// 面板首次渲染前用于估算方位的兜底尺寸与边距；挂载后改用实测尺寸修正。
const PANEL_FALLBACK_WIDTH = 560;
const PANEL_FALLBACK_HEIGHT = 360;
const PANEL_GAP = 10;
const VIEWPORT_MARGIN = 12;

/**
 * 模型快捷切换（两个入口变体，共用同一面板）：
 * - `variant="aside"`（默认）：侧栏「当前模型」卡片，展示三角色摘要，面板向右弹出；
 * - `variant="dock"`：创作页底栏 `.run-row` 内的「生图」紧凑入口（副本），面板向上弹出。
 *
 * - 卡片摘要展示快照值（未绑定显示「未绑定」）；正文只放模型名（单行省略号 + title 全名）。
 * - 点击在弹面板，内联选择供应商与模型；每次变更立即经 `settings:save` 保存。
 * - 保存载荷以**快照全量 providers**（剥离 hasKey，不含 apiKey）构造，主进程因此不动任何密钥：
 *   未携带 apiKey 的供应商保留原凭据，GC 也不会命中仍存在于集合中的供应商（见 electron/main.ts saveModelConfig）。
 * - 保存中禁用全部控件（天然串行，无并发写）；失败回滚到快照并上报。
 * - 选择供应商后自动选该供应商「已标注本角色」的首个模型；若一个都没有则不落草稿，提示到设置页标注。
 */
export function QuickModelSwitcher({
  variant = "aside",
  onOpenSettings,
}: {
  /** aside（默认）：侧栏卡片，面板向右弹出；dock：创作页底栏内的紧凑入口，面板向上弹出。 */
  variant?: "aside" | "dock";
  onOpenSettings: () => void;
}) {
  const { providers, roles, autoArchive, refreshSettings, notify } = useStudio();
  const [open, setOpen] = useState(false);
  const [draftRoles, setDraftRoles] = useState<Record<ModelRole, RoleBinding | null>>(roles);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState("");
  const [pos, setPos] = useState<PanelPosition | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 面板 fixed 定位：aside 变体贴卡片右侧、dock 变体（底栏在窗口底部）一律向上弹出；按实测尺寸收进视口内。
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = panelRef.current?.offsetWidth || PANEL_FALLBACK_WIDTH;
    const height = panelRef.current?.offsetHeight || PANEL_FALLBACK_HEIGHT;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(variant === "dock" ? rect.left : rect.right + PANEL_GAP, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    const top = variant === "dock"
      ? Math.max(VIEWPORT_MARGIN, rect.top - height - PANEL_GAP)
      : Math.max(VIEWPORT_MARGIN, Math.min(rect.top, window.innerHeight - height - VIEWPORT_MARGIN));
    setPos({ left, top });
  }, [variant]);

  const close = useCallback(() => {
    setOpen(false);
    setHint("");
  }, []);

  const openPanel = useCallback(() => {
    setDraftRoles(roles); // 每次打开都以最新快照初始化草稿，避免残留上次的失效选择
    setHint("");
    updatePosition(); // 先用兜底尺寸给出大致方位（面板尚未挂载），挂载后由 layout effect 用实测尺寸修正
    setOpen(true);
  }, [roles, updatePosition]);

  const togglePanel = () => (open ? close() : openPanel());

  // 打开时：聚焦面板（Escape 可用）、点击外部关闭、窗口缩放/滚动时跟随重定位。
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // Combobox 的下拉列表经 portal 挂到 .app（不在面板 DOM 内）：点击选项不得当作外部点击关闭面板。
      if (target instanceof Element && target.closest(".combobox-list")) return;
      close();
    };
    const handleLayout = () => updatePosition();
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("resize", handleLayout);
    window.addEventListener("scroll", handleLayout, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("resize", handleLayout);
      window.removeEventListener("scroll", handleLayout, true);
    };
  }, [open, close, updatePosition]);

  // 面板挂载后用实测尺寸修正方位（兜底尺寸可能低估高度）。
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // 保存成功后 refreshSettings 会刷新全局快照，卡片摘要随之更新。
  const persist = useCallback(
    async (role: ModelRole, nextRoles: Record<ModelRole, RoleBinding | null>) => {
      setSaving(true);
      try {
        const result = await callIpc(
          () => window.imageStudio.settings.save(buildQuickSwitchPayload(providers, nextRoles, autoArchive)),
          { fallbackError: t("模型切换保存失败"), onError: (message) => notify(message, true) },
        );
        if (!result.ok) {
          setDraftRoles(roles); // 服务端裁决失败：回滚到快照
          return;
        }
        await refreshSettings();
        notify(t("已切换「{role}」模型", { role: modelRoleLabel(role) }));
      } catch {
        // callIpc 在 promise reject 时上报并抛出：同样回滚，避免界面与服务端不一致。
        setDraftRoles(roles);
      } finally {
        setSaving(false);
      }
    },
    [providers, autoArchive, roles, refreshSettings, notify],
  );

  const applyBinding = (role: ModelRole, binding: RoleBinding | null) => {
    const next = { ...draftRoles, [role]: binding };
    setDraftRoles(next);
    setHint("");
    void persist(role, next);
  };

  const applyProvider = (role: ModelRole, providerId: string) => {
    if (!providerId) {
      applyBinding(role, null);
      return;
    }
    const model = firstAnnotatedModel(providers, providerId, role);
    if (!model) {
      const name = providers.find((provider) => provider.id === providerId)?.name ?? providerId;
      setHint(t("「{name}」尚未标注「{role}」模型，请先到设置页标注", { name, role: modelRoleLabel(role) }));
      return;
    }
    applyBinding(role, { providerId, model });
  };

  const applyModel = (role: ModelRole, model: string) => {
    const current = draftRoles[role];
    if (!current) return;
    applyBinding(role, { ...current, model });
  };

  // 内层 Combobox 关闭自身下拉时会 preventDefault：此时不得连带关闭面板。
  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    if (event.defaultPrevented) return;
    close();
  };

  // 卡片摘要：侧栏内容宽仅约 150px，正文只放模型名（单行省略号），完整「供应商 · 模型」放 title 提示。
  const roleCard = (role: ModelRole): { text: string; title: string } => {
    const binding = roles[role];
    if (!binding) return { text: t("未绑定"), title: t("未绑定：点击卡片选择") };
    const provider = providers.find((item) => item.id === binding.providerId);
    if (!provider) return { text: `⚠ ${binding.model}`, title: t("绑定的供应商已不存在 · {model}", { model: binding.model }) };
    return { text: binding.model, title: `${provider.name} · ${binding.model}` };
  };

  const imageCard = roleCard("image");

  return (
    <>
      {variant === "dock" ? (
        <Tooltip content={t("当前生图模型：{title}（点击快捷切换）", { title: imageCard.title })}>
          <button
            type="button"
            ref={triggerRef}
            className="dock-model-trigger"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={togglePanel}
          >
            <i>{modelRoleLabel("image")}</i>
            <strong>{imageCard.text}</strong>
            <NavIcon name="chevron-down" size={13} />
          </button>
        </Tooltip>
      ) : (
        <button
          type="button"
          ref={triggerRef}
          className="aside-tip aside-tip-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={togglePanel}
        >
          <span className="aside-tip-eyebrow">{t("当前模型")}</span>
          {MODEL_ROLES.map((role) => {
            const card = roleCard(role);
            return (
              <span className="aside-tip-role" key={role}>
                <i>{modelRoleLabel(role)}</i>
                <Tooltip content={card.title}>
                  <strong>{card.text}</strong>
                </Tooltip>
              </span>
            );
          })}
          <span className="aside-tip-note">{t("点击卡片快捷切换模型。图片与数据均保存在本机。")}</span>
        </button>
      )}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="quick-switch"
          role="dialog"
          aria-label={t("快捷切换模型")}
          tabIndex={-1}
          style={{ position: "fixed", left: pos.left, top: pos.top }}
          onKeyDown={handlePanelKeyDown}
        >
          <div className="quick-switch-head">
            <div>
              <span className="eyebrow">MODEL ASSIGNMENT</span>
              <h3>{t("快捷切换模型")}</h3>
            </div>
            <button type="button" className="quick-switch-close" aria-label={t("关闭|模型面板")} onClick={close}>
              <NavIcon name="x" size={16} />
            </button>
          </div>
          {providers.length === 0 ? (
            <div className="quick-switch-empty">
              <p>{t("尚未添加供应商。")}</p>
              <button type="button" className="secondary" onClick={() => { close(); onOpenSettings(); }}>{t("去设置添加供应商")}</button>
            </div>
          ) : (
            <>
              {MODEL_ROLES.map((role) => (
                <div className="quick-switch-row" key={role}>
                  <span className="role-label">{modelRoleLabel(role)}</span>
                  <Combobox
                    ariaLabel={t("{role}供应商", { role: modelRoleLabel(role) })}
                    className="role-provider"
                    placeholder={t("未分配")}
                    options={roleProviderOptions(providers, draftRoles[role])}
                    value={draftRoles[role]?.providerId ?? ""}
                    disabled={saving}
                    menuZIndex={55}
                    onChange={(value) => applyProvider(role, value)}
                  />
                  <Combobox
                    ariaLabel={t("{role}模型", { role: modelRoleLabel(role) })}
                    className="role-model"
                    placeholder={draftRoles[role] ? t("选择模型") : t("未分配")}
                    options={roleModelOptions(providers, draftRoles[role], role)}
                    value={draftRoles[role]?.model ?? ""}
                    disabled={saving || !draftRoles[role]}
                    menuZIndex={55}
                    onChange={(value) => applyModel(role, value)}
                  />
                  {draftRoles[role] && (
                    <button type="button" className="role-clear" disabled={saving} onClick={() => applyBinding(role, null)}>{t("清除")}</button>
                  )}
                </div>
              ))}
              {hint && <p className="quick-switch-hint">{hint}</p>}
              <p className="quick-switch-note">{t("选择后立即保存；模型需先在设置页标注对应角色。")}{saving ? " " + t("正在保存…") : ""}</p>
            </>
          )}
        </div>,
        document.querySelector(".app") ?? document.body,
      )}
    </>
  );
}
