import React, { useEffect, useRef, useState } from "react";
import { callIpc } from "./ipc";
import { useDialog } from "./Dialogs";
import { useStudio } from "./StudioContext";
import { Combobox } from "./Combobox";
import { Tooltip, InfoHint } from "./Tooltip";
import { NavIcon, type NavIconName } from "./icons";
import { useLocale } from "./useLocale";
import { formatDateTime } from "../lib/format";
import { getLocale, t, tCode } from "../lib/i18n";
import { isSettingsDirty } from "../lib/settings-dirty";
import { presetKeyHelp, presetToProviderDraft } from "../lib/provider-preset";
import {
  MODEL_ROLES,
  modelRoleLabel,
  firstAnnotatedModel,
  roleModelOptions,
  roleProviderOptions,
} from "../lib/role-options";

/** 供应商草稿：完整配置 + 可选的未保存密钥（仅存在于本次会话内存，保存时才提交）。 */
type ProviderDraft = ProviderConfig & { apiKey?: string };

// 设置页分区导航（v3.13）：4 个标签顺序固定；图标名取自 icons.tsx 已登记条目（无需翻译）。
// 标签文案必须在组件内求值——禁止模块加载期 t()（语言切换后不更新）。
const SETTINGS_TABS = ["connection", "general", "updates", "about"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];
const SETTINGS_TAB_ICONS: Record<SettingsTab, NavIconName> = {
  connection: "cpu",
  general: "settings",
  updates: "refresh-cw",
  about: "info",
};

// D10 刷新的渲染层轻量复刻：与 electron/model-config.ts 的 mergeFetchedModels 同语义
// （渲染层不得 import electron/——tsconfig include 仅 src——故就地实现，保持 ≤20 行）。
// 规则：保留既有顺序与 roles 标注；custom 永不 missing；seen 记录「曾出现在刷新列表」——仅「曾出现、
// 本次消失」置 missing；从未出现过的（平台列表端点不覆盖）永不标 missing 并清除历史误报；新 id 追加 roles:[]、seen:true。
function mergeModels(existing: ProviderModel[], fetched: string[]): ProviderModel[] {
  const fetchedSet = new Set(fetched);
  const existingIds = new Set(existing.map((model) => model.id));
  const merged = existing.map((model) => {
    if (model.source === "custom") return { ...model };
    if (fetchedSet.has(model.id)) {
      const next: ProviderModel = { ...model, seen: true };
      delete next.missing;
      return next;
    }
    if (model.seen) return { ...model, missing: true };
    const next: ProviderModel = { ...model };
    delete next.missing;
    return next;
  });
  for (const id of fetched) if (!existingIds.has(id)) merged.push({ id, roles: [], seen: true });
  return merged;
}

// settings:test 结果 → 本地化文案：en 查 `test.<code>`、zh 回退主进程中文 message。
// T3 契约里 result.code 已自带 `test.` 前缀（如 "test.noKey"），而 tCode 会再拼一次
// `${prefix}.${code}`——故先剥离前缀，避免 `test.test.noKey` 双重前缀。
// en 缺词条时 tCode 返回裸 key（`test.<code>`）——回退存储 message，绝不泄漏裸 code。
function renderTestMessage(result: SettingsTestResult): string {
  const code = result.code ? result.code.replace(/^test\./, "") : "";
  if (!code) return result.message;
  const text = tCode("test", code, result.params, result.message);
  if (text === `test.${code}` && result.message) return result.message;
  return text;
}

// 角色列表与显示名、下拉选项构造见 src/lib/role-options.ts（与侧栏快捷切换器共用）。

export function SettingsPanel({
  onSaveDirChanged,
  onOpenTutorial,
}: {
  onSaveDirChanged: () => Promise<void>;
  onOpenTutorial: () => void;
}) {
  const { providers, roles, refreshSettings, setError, setNotice, autoArchive } = useStudio();
  const { requestConfirm, requestText } = useDialog();
  // 语言切换独立于设置草稿/保存底栏：点击即生效（乐观），失败回滚并提示。
  const [locale, applyLocale] = useLocale();

  // —— 设置页分区导航（v3.13）：4 个面板条件渲染（未激活面板卸载）——
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("connection");
  const cardRef = useRef<HTMLElement | null>(null);
  // 分区标签在组件体内求值（禁止模块加载期 t()）；「软件更新」「关于与帮助」复用既有词条。
  const tabLabels: Record<SettingsTab, string> = {
    connection: t("连接与模型"),
    general: t("通用设置"),
    updates: t("软件更新"),
    about: t("关于与帮助"),
  };
  // 切换分区后把卡片滚回 .app 滚动端口顶部（默认瞬时滚动，不引入未登记动效）。
  const switchSettingsTab = (next: SettingsTab) => {
    setSettingsTab(next);
    cardRef.current?.scrollIntoView({ block: "start" });
  };

  // —— 供应商/角色/归档草稿（保存的权威来源；providers 快照同步后重置）——
  const [drafts, setDrafts] = useState<ProviderDraft[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [rolesDraft, setRolesDraft] = useState<Record<ModelRole, RoleBinding | null>>({ image: null, reverse: null, enhance: null });
  const [autoArchiveDraft, setAutoArchiveDraft] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedModelsId, setExpandedModelsId] = useState<string | null>(null); // 模型角色面板（与编辑表单独立展开）
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({}); // 每供应商的模型搜索文本
  const [draftForm, setDraftForm] = useState<{ name: string; baseUrl: string; apiKey: string }>({ name: "", baseUrl: "", apiKey: "" });
  const [adding, setAdding] = useState(false);
  // —— 添加卡片双态（预设平台 / 自定义，K8）：两态草稿独立存在，切换模式互不清空 ——
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [addMode, setAddMode] = useState<"preset" | "custom">("preset");
  const [presetId, setPresetId] = useState("");
  const [presetApiKey, setPresetApiKey] = useState("");
  const [providerMessages, setProviderMessages] = useState<Record<string, string>>({});
  const [providerMessageErrors, setProviderMessageErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const [saveDir, setSaveDir] = useState("");
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [alphaUnlocked, setAlphaUnlocked] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ phase: "idle", message: t("尚未检查更新") });
  const [zoomFactor, setZoomFactor] = useState(1);

  // 服务端已保存密钥的供应商 id 集合（drafts 只存 ProviderConfig + 内存 apiKey，不携带 hasKey）。
  const serverHasKey = new Set(providers.filter((provider) => provider.hasKey).map((provider) => provider.id));

  // providers/roles/autoArchive 快照 → 草稿同步；保存成功后 refreshSettings() 会触发本 effect 重新同步。
  // removedIds 不在此重置（避免未保存的删除意图被快照刷新吞掉；保存成功后显式清空）。
  useEffect(() => {
    setDrafts(providers.map(({ hasKey, ...rest }) => ({ ...rest })));
    setRolesDraft(roles);
    setAutoArchiveDraft(autoArchive);
  }, [providers, roles, autoArchive]);

  useEffect(() => {
    void callIpc(() => window.imageStudio.settings.get(), { fallbackError: t("无法读取设置"), onError: setError }).then((value) => {
      setSaveDir(value.saveDir || "");
      // 预设平台随同一份快照到达（K8，不新增 IPC）；默认选中第一个，`current ||` 只防重复 set 覆盖用户选择。
      const snapshotPresets = value.presets ?? [];
      setPresets(snapshotPresets);
      setPresetId((current) => current || snapshotPresets[0]?.id || "");
    }).catch(() => { /* callIpc 已上报 */ });
    void callIpc(() => window.imageStudio.updates.get(), { fallbackError: t("无法读取更新状态"), onError: setError }).then((value) => {
      setUpdateChannel(value.channel);
      setAutoUpdate(value.autoUpdate);
      setAppVersion(value.appVersion);
      setUpdateStatus(value.status);
      setAlphaUnlocked(value.alphaUnlocked);
    }).catch(() => { /* callIpc 已上报 */ });
    // best-effort：界面缩放的初始读取失败无需打扰用户（windowControls 白名单）。
    void window.imageStudio.windowControls.getZoom().then((r) => {
      if (r.ok && typeof r.factor === "number") setZoomFactor(r.factor);
    });
    // 事件订阅白名单：直连。
    return window.imageStudio.onUpdateStatus((value) => setUpdateStatus(value));
  }, []);

  const setProviderMessage = (id: string, message: string, failed: boolean) => {
    setProviderMessages((current) => ({ ...current, [id]: message }));
    setProviderMessageErrors((current) => ({ ...current, [id]: failed }));
  };

  const beginEdit = (draft: ProviderDraft) => {
    setAdding(false);
    setExpandedId(draft.id);
    // 密钥输入永不回显已存值：编辑表单的 apiKey 始终从空开始，留空=保留原密钥。
    setDraftForm({ name: draft.name, baseUrl: draft.baseUrl, apiKey: "" });
  };

  const finishEdit = (id: string) => {
    const name = draftForm.name.trim();
    const baseUrl = draftForm.baseUrl.trim();
    if (!name) { setError(t("请输入供应商名称")); return; }
    if (!baseUrl) { setError(t("请输入 API Base URL")); return; }
    setDrafts((current) => current.map((draft) => draft.id === id ? {
      ...draft,
      name,
      baseUrl,
      ...(draftForm.apiKey ? { apiKey: draftForm.apiKey } : {}),
    } : draft));
    setExpandedId(null);
  };

  const cancelEdit = () => setExpandedId(null);

  const beginAdd = () => {
    setExpandedId(null);
    setDraftForm({ name: "", baseUrl: "", apiKey: "" });
    setPresetApiKey("");
    setAdding(true);
  };

  const confirmAdd = () => {
    const name = draftForm.name.trim();
    const baseUrl = draftForm.baseUrl.trim();
    if (!name) { setError(t("请输入供应商名称")); return; }
    if (!baseUrl) { setError(t("请输入 API Base URL")); return; }
    const id = crypto.randomUUID();
    setDrafts((current) => [...current, { id, name, baseUrl, models: [], ...(draftForm.apiKey ? { apiKey: draftForm.apiKey } : {}) }]);
    setAdding(false);
  };

  // 预设态添加：平台参数（名称/baseUrl/api/预置模型）全部来自快照预设，只需密钥（可留空）。
  const confirmAddPreset = () => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) { setError(t("请选择预设平台")); return; }
    const id = crypto.randomUUID();
    setDrafts((current) => [...current, presetToProviderDraft(preset, id, presetApiKey)]);
    setPresetApiKey("");
    setAdding(false);
  };

  // 快照无预设（或选中项缺失）时降级为自定义表单，绝不渲染空 Combobox。
  const selectedPreset = presets.find((preset) => preset.id === presetId) ?? null;
  const effectiveAddMode: "preset" | "custom" = addMode === "preset" && selectedPreset ? "preset" : "custom";

  // 测试连接 / 刷新模型：同一 IPC 的两种用法（D7/D13）；transient 仅当次调用，绝不落库。
  const runProviderCheck = async (draft: ProviderDraft, action: "test" | "refresh") => {
    const apiKey = draft.apiKey?.trim() ?? "";
    if (!apiKey && !serverHasKey.has(draft.id)) {
      setProviderMessage(draft.id, t("请先输入 API 密钥"), true);
      return;
    }
    setProviderMessage(draft.id, action === "test" ? t("测试中…") : t("刷新中…"), false);
    const input: SettingsTestInput = apiKey
      ? { transient: { baseUrl: draft.baseUrl.trim(), apiKey } }
      : { providerId: draft.id };
    let result: SettingsTestResult | undefined;
    try {
      result = await callIpc(() => window.imageStudio.settings.test(input), {
        fallbackError: action === "test" ? t("测试连接失败") : t("刷新模型失败"),
        onError: (message) => setProviderMessage(draft.id, message, true),
      });
    } catch {
      return; // callIpc 已上报
    }
    if (!result.ok) {
      // SettingsTestResult 的失败文案在 message 字段（非 error），这里以业务结果形式展示。
      setProviderMessage(draft.id, renderTestMessage(result), true);
      return;
    }
    if (action === "test") {
      setProviderMessage(draft.id, renderTestMessage(result), false);
      return;
    }
    const fetched = result.models ?? [];
    setDrafts((current) => current.map((item) => item.id === draft.id
      ? { ...item, models: mergeModels(item.models, fetched), modelsUpdatedAt: new Date().toISOString() }
      : item));
    setProviderMessage(draft.id, t("已同步 {n} 个模型", { n: fetched.length }), false);
  };

  // —— 模型角色标注（仅内存草稿，随 providers 在「保存设置」时提交）——
  const toggleModelRole = (providerId: string, modelId: string, role: ModelRole) => {
    setDrafts((current) => current.map((draft) => draft.id === providerId ? {
      ...draft,
      models: draft.models.map((model) => model.id === modelId ? {
        ...model,
        // 去重：已有则移除，没有则追加。
        roles: model.roles.includes(role) ? model.roles.filter((item) => item !== role) : [...model.roles, role],
      } : model),
    } : draft));
  };

  const addCustomModel = async (draft: ProviderDraft) => {
    const raw = await requestText({
      title: t("自定义模型"),
      message: t("输入模型名称；自定义模型在刷新后不会消失"),
      placeholder: t("例如：my-model-v1"),
    });
    const id = raw?.trim() ?? "";
    if (!id) return;
    if (draft.models.some((model) => model.id === id)) {
      setError(t("模型已存在"));
      return;
    }
    const model: ProviderModel = { id, roles: [], source: "custom" };
    setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, models: [...item.models, model] } : item));
  };

  const removeCustomModel = async (providerId: string, modelId: string) => {
    const confirmed = await requestConfirm({
      title: t("删除自定义模型"),
      message: t("删除「{name}」？（不会影响已保存的绑定，失效绑定会在分配区标出）", { name: modelId }),
      confirmLabel: t("删除|供应商"),
      danger: true,
    });
    if (!confirmed) return;
    setDrafts((current) => current.map((draft) => draft.id === providerId
      ? { ...draft, models: draft.models.filter((model) => model.id !== modelId) }
      : draft));
  };

  // D11：批量只作用于「当前搜索结果集」（每个供应商各自的搜索文本）。
  const bulkApplyRole = (providerId: string, role: ModelRole, mode: "set" | "clear") => {
    const draft = drafts.find((item) => item.id === providerId);
    if (!draft) return;
    const query = (modelSearch[providerId] ?? "").trim().toLowerCase();
    const targets = new Set(
      draft.models.filter((model) => !query || model.id.toLowerCase().includes(query)).map((model) => model.id),
    );
    setDrafts((current) => current.map((item) => item.id === providerId ? {
      ...item,
      models: item.models.map((model) => {
        if (!targets.has(model.id)) return model;
        if (mode === "set") return model.roles.includes(role) ? model : { ...model, roles: [...model.roles, role] };
        return model.roles.includes(role) ? { ...model, roles: model.roles.filter((item) => item !== role) } : model;
      }),
    } : item));
  };

  const bulkSetRole = (providerId: string, role: ModelRole) => bulkApplyRole(providerId, role, "set");
  const bulkClearRole = (providerId: string, role: ModelRole) => bulkApplyRole(providerId, role, "clear");

  const removeProvider = async (draft: ProviderDraft) => {
    const confirmed = await requestConfirm({
      title: t("删除供应商"),
      message: t("删除「{name}」？保存后其密钥将从凭据库移除。", { name: draft.name }),
      confirmLabel: t("删除|供应商"),
      danger: true,
    });
    if (!confirmed) return;
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
    setRemovedIds((current) => (current.includes(draft.id) ? current : [...current, draft.id]));
    // 同批改绑（D9 注记）：被删供应商若仍被角色绑定引用，payload.roles 会指向不存在的
    // providerId 而被 D12 整单拒绝（"角色绑定的供应商不存在"）——UI 此刻已知引用必然失效，
    // 就地清空对应绑定，使删除与改绑在同一批保存中提交。
    setRolesDraft((current) => {
      const next = { ...current };
      let changed = false;
      for (const role of MODEL_ROLES) {
        if (next[role]?.providerId === draft.id) { next[role] = null; changed = true; }
      }
      return changed ? next : current;
    });
    if (expandedId === draft.id) setExpandedId(null);
  };

  // —— 三角色分配（D12/SC-D4：模型下拉严格只列该供应商「已标注本角色」的模型）——
  // 选项构造与失效项注入（供应商已删除 / 模型未标注）统一在 src/lib/role-options.ts，此处只消费。

  const setRoleProvider = (role: ModelRole, providerId: string) => {
    if (!providerId) { setRolesDraft((current) => ({ ...current, [role]: null })); return; }
    setRolesDraft((current) => ({ ...current, [role]: { providerId, model: firstAnnotatedModel(drafts, providerId, role) ?? "" } }));
  };

  const setRoleModel = (role: ModelRole, model: string) => {
    setRolesDraft((current) => (current[role] ? { ...current, [role]: { ...current[role]!, model } } : current));
  };

  const clearRole = (role: ModelRole) => setRolesDraft((current) => ({ ...current, [role]: null }));

  const saveSettings = async () => {
    for (const draft of drafts) {
      if (!draft.name.trim()) { setError(t("请输入供应商名称")); return; }
      if (!draft.baseUrl.trim()) { setError(t("请输入 API Base URL")); return; }
    }
    // 本地先行校验（服务端 D12 同样强制）：已绑定但模型为空 → 友好提示，避免整单远端拒绝。
    for (const role of MODEL_ROLES) {
      const binding = rolesDraft[role];
      if (binding && !binding.model.trim()) { setError(t("请为「生图/图反推/提示词增强」选择模型")); return; }
    }
    setSaving(true);
    try {
      const result = await callIpc(
        () => window.imageStudio.settings.save({
          providers: drafts,
          removedProviderIds: removedIds,
          roles: rolesDraft,
          autoArchive: autoArchiveDraft,
        }),
        { fallbackError: t("设置保存失败"), onError: setError },
      );
      if (!result.ok) return; // 服务端裁决（如 "供应商有未完成任务"）已由 callIpc → setError 上报
      await refreshSettings();
      setRemovedIds([]);
      setNotice(t("设置已保存，密钥不会显示在界面中"));
    } catch {
      /* callIpc 已上报 */
    } finally {
      setSaving(false);
    }
  };

  const chooseSaveDirectory = async () => {
    const result = await callIpc(() => window.imageStudio.settings.chooseSaveDir(), { fallbackError: t("无法修改保存位置"), onError: setError });
    if (!result.ok) return;
    if (result.canceled || !result.saveDir) return;
    setSaveDir(result.saveDir);
    await onSaveDirChanged();
    setNotice(t("保存位置已切换；原目录文件不会移动或删除"));
  };

  const resetSaveDirectory = async () => {
    const result = await callIpc(() => window.imageStudio.settings.resetSaveDir(), { fallbackError: t("无法恢复系统默认保存位置"), onError: setError });
    if (!result.ok || !result.saveDir) return;
    setSaveDir(result.saveDir);
    await onSaveDirChanged();
    setNotice(t("已恢复系统“图片”文件夹中的默认保存位置"));
  };

  const openSaveDirectory = async () => {
    await callIpc(() => window.imageStudio.settings.openSaveDir(), { fallbackError: t("无法打开保存位置"), onError: setError });
  };

  // 语言切换：先乐观生效（界面立即切换），持久化失败则回滚并提示。不得进入设置草稿/保存底栏。
  const switchLocale = async (next: Locale) => {
    const previous = getLocale();
    applyLocale(next);
    try {
      const result = await window.imageStudio.settings.setLocale(next);
      if (!result.ok) {
        applyLocale(previous);
        setError(t("语言切换失败：{message}", { message: result.error || t("请重试") }));
      }
    } catch (cause) {
      applyLocale(previous);
      setError(t("语言切换失败：{message}", { message: (cause as Error).message || t("请重试") }));
    }
  };

  const applyZoom = (next: number) => {
    void window.imageStudio.windowControls.setZoom(next).then((r) => {
      if (r.ok && typeof r.factor === "number") setZoomFactor(r.factor);
    });
  };

  const setUpdateChannelPreference = async (channel: UpdateChannel) => {
    const previous = updateChannel;
    setUpdateChannel(channel);
    const result = await callIpc(() => window.imageStudio.updates.setChannel(channel), { fallbackError: t("无法保存更新渠道设置"), onError: () => setError(t("无法保存更新渠道设置")) });
    if (!result.ok) setUpdateChannel(previous);
  };

  const setAutoUpdatePreference = async (enabled: boolean) => {
    setAutoUpdate(enabled);
    const result = await callIpc(() => window.imageStudio.updates.setAutoUpdate(enabled), { fallbackError: t("无法保存自动更新设置"), onError: () => setError(t("无法保存自动更新设置")) });
    if (!result.ok) setAutoUpdate(!enabled);
  };

  const checkUpdates = async () => {
    setUpdateStatus((current) => ({ ...current, phase: "checking", message: t("正在检查更新…") }));
    const result = await callIpc(() => window.imageStudio.updates.check(), { fallbackError: t("检查更新失败"), onError: (message) => setUpdateStatus((current) => ({ ...current, phase: "error", message })) });
    if (!result.ok) setUpdateStatus((current) => ({ ...current, phase: "error", message: result.message }));
  };

  const downloadUpdate = async () => {
    const result = await callIpc(() => window.imageStudio.updates.download(), { fallbackError: t("下载更新失败"), onError: setError });
    if (!result.ok) setError(result.message);
  };

  const installUpdate = async () => {
    const result = await callIpc(() => window.imageStudio.updates.install(), { fallbackError: t("安装更新失败"), onError: setError });
    if (!result.ok) setError(result.message);
  };

  // 隐藏手势：连续点击版本号 5 次（相邻间隔 ≤1.5s）解锁 Alpha 内测渠道；不加任何视觉提示。
  const alphaClickCount = useRef(0);
  const alphaClickTimer = useRef(0);

  const handleVersionClick = () => {
    if (alphaUnlocked) return;
    window.clearTimeout(alphaClickTimer.current);
    alphaClickCount.current += 1;
    if (alphaClickCount.current >= 5) {
      alphaClickCount.current = 0;
      void callIpc(() => window.imageStudio.updates.setAlphaUnlocked(true), { fallbackError: t("无法解锁 Alpha 测试渠道"), onError: setError }).then((result) => {
        if (!result.ok) return;
        setAlphaUnlocked(true);
        setNotice(t("已解锁 Alpha 测试渠道"));
      }).catch(() => { /* callIpc 已上报 */ });
      return;
    }
    alphaClickTimer.current = window.setTimeout(() => { alphaClickCount.current = 0; }, 1500);
  };

  const exitAlphaChannel = async () => {
    const result = await callIpc(() => window.imageStudio.updates.setAlphaUnlocked(false), { fallbackError: t("无法退出内测渠道"), onError: setError });
    if (!result.ok) return;
    setAlphaUnlocked(false);
    if (result.channel) setUpdateChannel(result.channel);
    setNotice(t("已退出内测渠道"));
  };

  // 保存底栏的脏状态：草稿（providers/roles/autoArchive）与快照存在差异时提示未保存。
  const settingsDirty = isSettingsDirty(
    { providers: drafts, removedProviderIds: removedIds, roles: rolesDraft, autoArchive: autoArchiveDraft },
    { providers, roles, autoArchive },
  );

  return (
    <section className="card settings" data-tutorial="connection-settings" ref={cardRef}>
      <span className="eyebrow">SETTINGS</span>
      <h2>{t("设置")}</h2>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("设置")}>
          {SETTINGS_TABS.map((id) => (
            <button
              key={id}
              type="button"
              className={"nav" + (settingsTab === id ? " active" : "")}
              data-settings-tab={id}
              aria-current={settingsTab === id ? "page" : undefined}
              onClick={() => switchSettingsTab(id)}
            >
              <NavIcon name={SETTINGS_TAB_ICONS[id]} />
              {tabLabels[id]}
            </button>
          ))}
        </nav>
        <div className="settings-panels">
          {settingsTab === "connection" && (
            <div className="settings-panel" data-settings-panel="connection">
              <p className="muted">
                {t("支持添加多个符合当前请求格式的 OpenAI 兼容服务，并可为生图、图反推与提示词增强分别绑定模型。API 密钥仅保存到 Windows 凭据库，不会显示原文或写入项目文件。")}
              </p>
              <section className="provider-block">
                <div className="provider-block-head">
                  <div>
                    <span className="eyebrow">PROVIDERS</span>
                    <h3>{t("供应商")}</h3>
                  </div>
                  <button type="button" className="secondary" onClick={beginAdd}>{t("+ 添加供应商")}</button>
                </div>
                {adding && (
                  <div className="provider-card provider-card-new" data-provider-form="add">
                    {presets.length > 0 && (
                      // 双态切换：复用更新渠道分段控件的视觉（.update-channel-options）；只切模式，两态草稿互不清空。
                      <div className="update-channel-options" role="group" aria-label={t("添加方式")}>
                        <button type="button" className={effectiveAddMode === "preset" ? "active" : ""} onClick={() => setAddMode("preset")}>{t("预设平台")}</button>
                        <button type="button" className={effectiveAddMode === "custom" ? "active" : ""} onClick={() => setAddMode("custom")}>{t("自定义|设置")}</button>
                      </div>
                    )}
                    {effectiveAddMode === "preset" && selectedPreset ? (
                      <>
                        <label>{t("平台")}
                          <Combobox
                            ariaLabel={t("预设平台")}
                            placeholder={t("选择平台")}
                            options={presets.map((item) => ({ value: item.id, label: item.label }))}
                            value={presetId}
                            onChange={setPresetId}
                          />
                        </label>
                        <label>{t("API 密钥")}
                          <input
                            data-provider-field="presetApiKey"
                            type="password"
                            placeholder={t("粘贴 API 密钥（可留空，稍后填写）")}
                            value={presetApiKey}
                            onChange={(event) => setPresetApiKey(event.target.value)}
                          />
                        </label>
                        <p className="provider-meta">{presetKeyHelp(selectedPreset.id, selectedPreset.keyHelp)}</p>
                        <div className="provider-form-actions">
                          <button type="button" className="primary" onClick={confirmAddPreset}>{t("添加")}</button>
                          <button type="button" className="secondary" onClick={() => setAdding(false)}>{t("取消")}</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <label>{t("名称")}<input data-provider-field="name" placeholder={t("例如：主力平台")} value={draftForm.name} onChange={(event) => setDraftForm((current) => ({ ...current, name: event.target.value }))} /></label>
                        <label>Base URL<input data-provider-field="baseUrl" placeholder={t("例如：https://api.example.com/v1")} value={draftForm.baseUrl} onChange={(event) => setDraftForm((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
                        <label>{t("API 密钥")}
                          <input
                            data-provider-field="apiKey"
                            type="password"
                            placeholder={t("粘贴当前平台提供的 API 密钥")}
                            value={draftForm.apiKey}
                            onChange={(event) => setDraftForm((current) => ({ ...current, apiKey: event.target.value }))}
                          />
                        </label>
                        <div className="provider-form-actions">
                          <button type="button" className="primary" onClick={confirmAdd}>{t("添加")}</button>
                          <button type="button" className="secondary" onClick={() => setAdding(false)}>{t("取消")}</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {drafts.length === 0 && !adding && <p className="muted">{t("尚未添加供应商。")}</p>}
                {drafts.map((draft) => {
                  const hasKey = Boolean(draft.apiKey) || serverHasKey.has(draft.id);
                  // 模型面板过滤：大小写不敏感、空搜索 = 全部（同一结果集供批量按钮使用，D11）。
                  const query = (modelSearch[draft.id] ?? "").trim().toLowerCase();
                  const filteredModels = query ? draft.models.filter((model) => model.id.toLowerCase().includes(query)) : draft.models;
                  return (
                    <article className="provider-card" data-provider-id={draft.id} key={draft.id}>
                      <div className="provider-card-head">
                        <div className="provider-card-title">
                          <strong>{draft.name}</strong>
                          {hasKey ? <span className="key-badge ok">{t("已保存密钥")}</span> : <span className="key-badge missing">{t("缺少密钥")}</span>}
                        </div>
                        <div className="provider-card-actions">
                          <button type="button" className="secondary" onClick={() => beginEdit(draft)}>{t("编辑")}</button>
                          <Tooltip content={t("测试连接与刷新模型不会保存任何数据：未保存的新密钥只用于当次请求，不写入凭据库。")}>
                            <button type="button" className="secondary" onClick={() => void runProviderCheck(draft, "test")}>{t("测试连接")}</button>
                          </Tooltip>
                          <button type="button" className="secondary" onClick={() => void runProviderCheck(draft, "refresh")}>{t("刷新模型")}</button>
                          <button type="button" className="secondary" onClick={() => setExpandedModelsId((current) => (current === draft.id ? null : draft.id))}>{t("模型")}</button>
                          <button type="button" className="secondary" onClick={() => void removeProvider(draft)}>{t("删除|供应商")}</button>
                        </div>
                      </div>
                      <code>{draft.baseUrl}</code>
                      <p className="provider-meta">
                        {draft.modelsUpdatedAt
                          ? t("{n} 个模型 · 更新于 {time}", { n: draft.models.length, time: formatDateTime(draft.modelsUpdatedAt) })
                          : t("{n} 个模型", { n: draft.models.length })}
                      </p>
                      {expandedModelsId === draft.id && (
                        <div className="model-role-block">
                          <div className="model-role-head">
                            <input
                              className="model-search"
                              placeholder={t("搜索模型")}
                              value={modelSearch[draft.id] ?? ""}
                              onChange={(event) => setModelSearch((current) => ({ ...current, [draft.id]: event.target.value }))}
                            />
                            <button type="button" onClick={() => void runProviderCheck(draft, "refresh")}>{t("刷新模型")}</button>
                            <button type="button" onClick={() => void addCustomModel(draft)}>{`+ ${t("自定义模型")}`}</button>
                          </div>
                          <div className="model-bulk">
                            {t("批量（作用于搜索结果）：")}
                            {MODEL_ROLES.map((role) => (
                              <span key={role} className="model-bulk-group">
                                <button type="button" onClick={() => bulkSetRole(draft.id, role)}>{t("设为 {role}", { role: modelRoleLabel(role) })}</button>
                                <button type="button" onClick={() => bulkClearRole(draft.id, role)}>{t("清除 {role}", { role: modelRoleLabel(role) })}</button>
                              </span>
                            ))}
                          </div>
                          <div className="model-list">
                            {filteredModels.length === 0 && <p className="model-empty">{t("无匹配模型")}</p>}
                            {filteredModels.map((model) => (
                              <div className={"model-row" + (model.missing ? " missing" : "")} key={model.id}>
                                <span className="model-id">{model.id}</span>
                                {model.source === "custom" && <span className="model-custom">{t("自定义|设置")}</span>}
                                {model.missing && <span className="model-missing">{t("已下线")}</span>}
                                {MODEL_ROLES.map((role) => (
                                  <label key={role} className="model-role-check">
                                    <input type="checkbox" checked={model.roles.includes(role)} onChange={() => toggleModelRole(draft.id, model.id, role)} /> {modelRoleLabel(role)}
                                  </label>
                                ))}
                                {model.source === "custom" && (
                                  <button type="button" className="model-remove" onClick={() => void removeCustomModel(draft.id, model.id)}>{t("删除|供应商")}</button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {expandedId === draft.id && (
                        <div className="provider-form" data-provider-form="edit">
                          <label>{t("名称")}<input data-provider-field="name" value={draftForm.name} onChange={(event) => setDraftForm((current) => ({ ...current, name: event.target.value }))} /></label>
                          <label>Base URL<input data-provider-field="baseUrl" value={draftForm.baseUrl} onChange={(event) => setDraftForm((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
                          <label>{t("API 密钥")}
                            <input
                              data-provider-field="apiKey"
                              type="password"
                              placeholder={t("已保存，输入新值可覆盖")}
                              value={draftForm.apiKey}
                              onChange={(event) => setDraftForm((current) => ({ ...current, apiKey: event.target.value }))}
                            />
                          </label>
                          <div className="provider-form-actions">
                            <button type="button" className="primary" onClick={() => finishEdit(draft.id)}>{t("完成")}</button>
                            <button type="button" className="secondary" onClick={cancelEdit}>{t("取消")}</button>
                          </div>
                        </div>
                      )}
                      {providerMessages[draft.id] && (
                        <p className={providerMessageErrors[draft.id] ? "provider-message error-text" : "provider-message"}>{providerMessages[draft.id]}</p>
                      )}
                    </article>
                  );
                })}
              </section>
              <section className="role-binding-block">
                <div>
                  <span className="eyebrow">MODEL ASSIGNMENT</span>
                  <h3>{t("模型分配")}<InfoHint content={t("为生图、图反推、提示词增强分别选择供应商与模型；只显示已标注该角色的模型。")} /></h3>
                </div>
                {MODEL_ROLES.map((role) => (
                  <div className="role-binding-row" key={role}>
                    <span className="role-label">{modelRoleLabel(role)}</span>
                    <Combobox
                      ariaLabel={t("{role}供应商", { role: modelRoleLabel(role) })}
                      className="role-provider"
                      placeholder={t("未分配")}
                      options={roleProviderOptions(drafts, rolesDraft[role])}
                      value={rolesDraft[role]?.providerId ?? ""}
                      onChange={(value) => setRoleProvider(role, value)}
                    />
                    <Combobox
                      ariaLabel={t("{role}模型", { role: modelRoleLabel(role) })}
                      className="role-model"
                      placeholder={rolesDraft[role] ? t("选择模型") : t("未分配")}
                      options={roleModelOptions(drafts, rolesDraft[role], role)}
                      value={rolesDraft[role]?.model ?? ""}
                      disabled={!rolesDraft[role]}
                      onChange={(value) => setRoleModel(role, value)}
                    />
                    {rolesDraft[role] && <button type="button" className="role-clear" onClick={() => clearRole(role)}>{t("清除")}</button>}
                  </div>
                ))}
              </section>
            </div>
          )}
          {settingsTab === "general" && (
            <div className="settings-panel" data-settings-panel="general">
              <label className="archive-toggle">
                <input type="checkbox" checked={autoArchiveDraft} onChange={(event) => setAutoArchiveDraft(event.target.checked)} />
                {t("自动归档生成图片到本地图库与收件箱")}
              </label>
              {saveDir && <div className="storage-path">
                <div className="storage-head">
                  <strong>{t("本地保存位置")}</strong>
                  <div className="storage-actions">
                    <Tooltip content={t("新图片、自动图库和导出文件将使用此位置；切换目录不会移动或删除原目录中的文件。")}>
                      <button type="button" onClick={() => void chooseSaveDirectory()}>{t("选择文件夹")}</button>
                    </Tooltip>
                    <button type="button" onClick={() => void openSaveDirectory()}>{t("打开目录")}</button>
                    <button type="button" onClick={() => void resetSaveDirectory()}>{t("恢复默认")}</button>
                  </div>
                </div>
                <code>{saveDir}</code>
              </div>}
              {/* 语言 / Language：仅两选项（endonym，两种语言下均不翻译）；点击即乐观切换，不走保存底栏。 */}
              <section className="update-settings">
                <div>
                  <span className="eyebrow">LANGUAGE</span>
                  <h3>{t("语言 / Language")}</h3>
                </div>
                <div className="update-channel-options" role="group" aria-label={t("语言 / Language")}>
                  <button
                    type="button"
                    className={locale === "zh" ? "active" : ""}
                    aria-pressed={locale === "zh"}
                    data-i18n-skip="true"
                    onClick={() => void switchLocale("zh")}
                  >
                    简体中文
                  </button>
                  <button
                    type="button"
                    className={locale === "en" ? "active" : ""}
                    aria-pressed={locale === "en"}
                    onClick={() => void switchLocale("en")}
                  >
                    English
                  </button>
                </div>
              </section>
              <section className="update-settings">
                <div>
                  <span className="eyebrow">INTERFACE ZOOM</span>
                  <h3>{t("界面缩放")}</h3>
                  <p>{t("当前缩放：{n}%。", { n: Math.round(zoomFactor * 100) })}</p>
                </div>
                <Tooltip content={t("调整整个界面的缩放比例，范围为 50%–200%。")}>
                  <div className="update-actions">
                    <button type="button" className="secondary" onClick={() => applyZoom(Math.max(0.5, Number((zoomFactor - 0.1).toFixed(2))))}>{t("缩小")}</button>
                    <button type="button" className="secondary" onClick={() => applyZoom(1)}>{t("重置")}</button>
                    <button type="button" className="secondary" onClick={() => applyZoom(Math.min(2, Number((zoomFactor + 0.1).toFixed(2))))}>{t("放大")}</button>
                  </div>
                </Tooltip>
              </section>
            </div>
          )}
          {settingsTab === "updates" && (
            <div className="settings-panel" data-settings-panel="updates">
              <section className="update-settings">
                <div>
                  <span className="eyebrow">APPLICATION UPDATE</span>
                  <h3>{t("软件更新")}</h3>
                  <p onClick={handleVersionClick}>{t("当前版本：v{version}。", { version: appVersion || "—" })}</p>
                </div>
                <div className="update-channel">
                  <span className="update-channel-label">{t("更新渠道")}</span>
                  <div className={alphaUnlocked ? "update-channel-options alpha-unlocked" : "update-channel-options"}>
                    <button type="button" className={updateChannel === "stable" ? "active" : ""} onClick={() => void setUpdateChannelPreference("stable")}>{t("正式版")}</button>
                    <button type="button" className={updateChannel === "beta" ? "active" : ""} onClick={() => void setUpdateChannelPreference("beta")}>{t("测试版 Beta")}</button>
                    {alphaUnlocked && <button type="button" className={updateChannel === "alpha" ? "active" : ""} onClick={() => void setUpdateChannelPreference("alpha")}>{t("Alpha 测试版")}</button>}
                  </div>
                  {alphaUnlocked && <button type="button" className="update-alpha-exit" onClick={() => void exitAlphaChannel()}>{t("退出内测")}</button>}
                </div>
                <Tooltip content={t("开启自动更新后会在后台检查并下载新版本，安装前仍会询问，不会强制重启；关闭后仅在你手动检查时提示下载。")}>
                  <label className="archive-toggle">
                    <input type="checkbox" checked={autoUpdate} onChange={(event) => void setAutoUpdatePreference(event.target.checked)} />
                    {t("自动检查并在后台下载更新（安装前询问）")}
                  </label>
                </Tooltip>
                <div className="update-actions">
                  <button className="secondary" onClick={() => void checkUpdates()} disabled={updateStatus.phase === "checking"}>
                    {updateStatus.phase === "checking" ? t("检查中…") : t("检查更新")}
                  </button>
                  {updateStatus.phase === "available" && <button className="primary" onClick={() => void downloadUpdate()}>{t("下载 v{version}", { version: updateStatus.version ?? "" })}</button>}
                  {updateStatus.phase === "downloading" && <span className="update-progress">{t("下载中 {progress}%", { progress: updateStatus.progress || 0 })}</span>}
                  {updateStatus.phase === "downloaded" && <button className="primary" onClick={() => void installUpdate()}>{t("重启并安装 v{version}", { version: updateStatus.version ?? "" })}</button>}
                </div>
                <p className={updateStatus.phase === "error" ? "update-status error-text" : "update-status"}>{updateStatus.message}</p>
              </section>
            </div>
          )}
          {settingsTab === "about" && (
            <div className="settings-panel" data-settings-panel="about">
              <section className="update-settings">
                <div>
                  <span className="eyebrow">ABOUT & HELP</span>
                  <h3>{t("关于与帮助")}</h3>
                  <p>{t("本地 OpenAI 兼容图片创作工具，支持自定义基础地址、模型、文生图、图片编辑和常用输出尺寸。")}</p>
                  <p>{t("Copyright (C) 2026 zztnbnb。本项目以 GNU Affero General Public License v3.0 only 发布，不提供任何担保。")}</p>
                </div>
                <div className="update-actions">
                  <button type="button" className="secondary" data-open-tutorial onClick={onOpenTutorial}>{t("打开新手教程")}</button>
                  <a href="https://github.com/zztnbnb/image-studio/blob/main/LICENSE" target="_blank" rel="noreferrer" className="secondary">{t("查看许可证与源代码")}</a>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
      {(settingsTab === "connection" || settingsTab === "general") && (
        <div className="settings-dock">
          <button className="primary" onClick={() => void saveSettings()} disabled={saving}>{saving ? t("保存中…") : t("保存设置")}</button>
          <span className="save-note">{saving ? t("正在保存…") : settingsDirty ? t("有未保存的更改") : t("所有更改已保存")}</span>
        </div>
      )}
    </section>
  );
}
