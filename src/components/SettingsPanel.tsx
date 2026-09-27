import React, { useEffect, useRef, useState } from "react";
import { callIpc } from "./ipc";
import { useDialog } from "./Dialogs";
import { useStudio } from "./StudioContext";
import { Combobox } from "./Combobox";
import type { ComboboxOption } from "./Combobox";
import { formatDateTime } from "../lib/format";

/** 供应商草稿：完整配置 + 可选的未保存密钥（仅存在于本次会话内存，保存时才提交）。 */
type ProviderDraft = ProviderConfig & { apiKey?: string };

// D10 刷新的渲染层轻量复刻：与 electron/model-config.ts 的 mergeFetchedModels 同语义
// （渲染层不得 import electron/——tsconfig include 仅 src——故就地实现，保持 ≤20 行）。
// 规则：保留既有顺序与 roles 标注；custom 永不 missing；fetch 来源缺失置 missing、重现清除；新 id 追加 roles:[]。
function mergeModels(existing: ProviderModel[], fetched: string[]): ProviderModel[] {
  const fetchedSet = new Set(fetched);
  const existingIds = new Set(existing.map((model) => model.id));
  const merged = existing.map((model) => {
    if (model.source === "custom") return { ...model };
    if (fetchedSet.has(model.id)) {
      const next: ProviderModel = { ...model };
      delete next.missing;
      return next;
    }
    return { ...model, missing: true };
  });
  for (const id of fetched) if (!existingIds.has(id)) merged.push({ id, roles: [] });
  return merged;
}

// 角色列表与显示名（顺序 = 复选框/批量按钮渲染顺序）。
const MODEL_ROLES: ModelRole[] = ["image", "reverse", "enhance"];
const MODEL_ROLE_LABELS: Record<ModelRole, string> = { image: "生图", reverse: "图反推", enhance: "提示词增强" };

export function SettingsPanel({
  onSaveDirChanged,
  onOpenTutorial,
}: {
  onSaveDirChanged: () => Promise<void>;
  onOpenTutorial: () => void;
}) {
  const { providers, roles, refreshSettings, setError, setNotice, autoArchive } = useStudio();
  const { requestConfirm, requestText } = useDialog();

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
  const [providerMessages, setProviderMessages] = useState<Record<string, string>>({});
  const [providerMessageErrors, setProviderMessageErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const [saveDir, setSaveDir] = useState("");
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [alphaUnlocked, setAlphaUnlocked] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ phase: "idle", message: "尚未检查更新" });
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
    void callIpc(() => window.imageStudio.settings.get(), { fallbackError: "无法读取设置", onError: setError }).then((value) => {
      setSaveDir(value.saveDir || "");
    }).catch(() => { /* callIpc 已上报 */ });
    void callIpc(() => window.imageStudio.updates.get(), { fallbackError: "无法读取更新状态", onError: setError }).then((value) => {
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
    if (!name) { setError("请输入供应商名称"); return; }
    if (!baseUrl) { setError("请输入 API Base URL"); return; }
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
    setAdding(true);
  };

  const confirmAdd = () => {
    const name = draftForm.name.trim();
    const baseUrl = draftForm.baseUrl.trim();
    if (!name) { setError("请输入供应商名称"); return; }
    if (!baseUrl) { setError("请输入 API Base URL"); return; }
    const id = crypto.randomUUID();
    setDrafts((current) => [...current, { id, name, baseUrl, models: [], ...(draftForm.apiKey ? { apiKey: draftForm.apiKey } : {}) }]);
    setAdding(false);
  };

  // 测试连接 / 刷新模型：同一 IPC 的两种用法（D7/D13）；transient 仅当次调用，绝不落库。
  const runProviderCheck = async (draft: ProviderDraft, action: "test" | "refresh") => {
    const apiKey = draft.apiKey?.trim() ?? "";
    if (!apiKey && !serverHasKey.has(draft.id)) {
      setProviderMessage(draft.id, "请先输入 API 密钥", true);
      return;
    }
    setProviderMessage(draft.id, action === "test" ? "测试中…" : "刷新中…", false);
    const input: SettingsTestInput = apiKey
      ? { transient: { baseUrl: draft.baseUrl.trim(), apiKey } }
      : { providerId: draft.id };
    let result: SettingsTestResult | undefined;
    try {
      result = await callIpc(() => window.imageStudio.settings.test(input), {
        fallbackError: action === "test" ? "测试连接失败" : "刷新模型失败",
        onError: (message) => setProviderMessage(draft.id, message, true),
      });
    } catch {
      return; // callIpc 已上报
    }
    if (!result.ok) {
      // SettingsTestResult 的失败文案在 message 字段（非 error），这里以业务结果形式展示。
      setProviderMessage(draft.id, result.message, true);
      return;
    }
    if (action === "test") {
      setProviderMessage(draft.id, result.message, false);
      return;
    }
    const fetched = result.models ?? [];
    setDrafts((current) => current.map((item) => item.id === draft.id
      ? { ...item, models: mergeModels(item.models, fetched), modelsUpdatedAt: new Date().toISOString() }
      : item));
    setProviderMessage(draft.id, `已同步 ${fetched.length} 个模型`, false);
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
      title: "自定义模型",
      message: "输入模型名称；自定义模型在刷新后不会消失",
      placeholder: "例如：my-model-v1",
    });
    const id = raw?.trim() ?? "";
    if (!id) return;
    if (draft.models.some((model) => model.id === id)) {
      setError("模型已存在");
      return;
    }
    const model: ProviderModel = { id, roles: [], source: "custom" };
    setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, models: [...item.models, model] } : item));
  };

  const removeCustomModel = async (providerId: string, modelId: string) => {
    const confirmed = await requestConfirm({
      title: "删除自定义模型",
      message: `删除「${modelId}」？（不会影响已保存的绑定，失效绑定会在分配区标出）`,
      confirmLabel: "删除",
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
      title: "删除供应商",
      message: `删除「${draft.name}」？保存后其密钥将从凭据库移除。`,
      confirmLabel: "删除",
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
  // Combobox 的显示值 = options.find(...)?.label ?? ""：选项外/value 无匹配只显示 placeholder，
  // 因此失效的绑定值必须注入 options 才能被看见（供应商已删除、模型未标注两种失效态）。

  // 供应商：全部草稿；当前绑定指向已不存在的供应商 → 置顶注入 ⚠ 失效项。
  const roleProviderOptions = (role: ModelRole): ComboboxOption[] => {
    const options = drafts.map((draft) => ({ value: draft.id, label: draft.name }));
    const binding = rolesDraft[role];
    if (binding && !drafts.some((draft) => draft.id === binding.providerId)) {
      options.unshift({ value: binding.providerId, label: "⚠ 已删除的供应商" });
    }
    return options;
  };

  // 模型：仅该供应商「已标注本角色」的模型；当前绑定未标注 → 置顶 ⚠ 可见项；供应商失效 → 只显示绑定模型 ⚠。
  const roleModelOptions = (role: ModelRole): ComboboxOption[] => {
    const binding = rolesDraft[role];
    if (!binding) return [];
    const provider = drafts.find((draft) => draft.id === binding.providerId);
    if (!provider) return [{ value: binding.model, label: binding.model + " ⚠ 未标注" }];
    const annotated = provider.models.filter((model) => model.roles.includes(role));
    const options = annotated.map((model) => ({ value: model.id, label: model.id }));
    if (!annotated.some((model) => model.id === binding.model)) {
      options.unshift({ value: binding.model, label: binding.model + " ⚠ 未标注" });
    }
    return options;
  };

  const setRoleProvider = (role: ModelRole, providerId: string) => {
    if (!providerId) { setRolesDraft((current) => ({ ...current, [role]: null })); return; }
    const provider = drafts.find((draft) => draft.id === providerId);
    const firstAnnotated = provider?.models.find((model) => model.roles.includes(role));
    setRolesDraft((current) => ({ ...current, [role]: { providerId, model: firstAnnotated?.id ?? "" } }));
  };

  const setRoleModel = (role: ModelRole, model: string) => {
    setRolesDraft((current) => (current[role] ? { ...current, [role]: { ...current[role]!, model } } : current));
  };

  const clearRole = (role: ModelRole) => setRolesDraft((current) => ({ ...current, [role]: null }));

  const saveSettings = async () => {
    for (const draft of drafts) {
      if (!draft.name.trim()) { setError("请输入供应商名称"); return; }
      if (!draft.baseUrl.trim()) { setError("请输入 API Base URL"); return; }
    }
    // 本地先行校验（服务端 D12 同样强制）：已绑定但模型为空 → 友好提示，避免整单远端拒绝。
    for (const role of MODEL_ROLES) {
      const binding = rolesDraft[role];
      if (binding && !binding.model.trim()) { setError("请为「生图/图反推/提示词增强」选择模型"); return; }
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
        { fallbackError: "设置保存失败", onError: setError },
      );
      if (!result.ok) return; // 服务端裁决（如 "供应商有未完成任务"）已由 callIpc → setError 上报
      await refreshSettings();
      setRemovedIds([]);
      setNotice("设置已保存，密钥不会显示在界面中");
    } catch {
      /* callIpc 已上报 */
    } finally {
      setSaving(false);
    }
  };

  const chooseSaveDirectory = async () => {
    const result = await callIpc(() => window.imageStudio.settings.chooseSaveDir(), { fallbackError: "无法修改保存位置", onError: setError });
    if (!result.ok) return;
    if (result.canceled || !result.saveDir) return;
    setSaveDir(result.saveDir);
    await onSaveDirChanged();
    setNotice("保存位置已切换；原目录文件不会移动或删除");
  };

  const resetSaveDirectory = async () => {
    const result = await callIpc(() => window.imageStudio.settings.resetSaveDir(), { fallbackError: "无法恢复系统默认保存位置", onError: setError });
    if (!result.ok || !result.saveDir) return;
    setSaveDir(result.saveDir);
    await onSaveDirChanged();
    setNotice("已恢复系统“图片”文件夹中的默认保存位置");
  };

  const openSaveDirectory = async () => {
    await callIpc(() => window.imageStudio.settings.openSaveDir(), { fallbackError: "无法打开保存位置", onError: setError });
  };

  const applyZoom = (next: number) => {
    void window.imageStudio.windowControls.setZoom(next).then((r) => {
      if (r.ok && typeof r.factor === "number") setZoomFactor(r.factor);
    });
  };

  const setUpdateChannelPreference = async (channel: UpdateChannel) => {
    const previous = updateChannel;
    setUpdateChannel(channel);
    const result = await callIpc(() => window.imageStudio.updates.setChannel(channel), { fallbackError: "无法保存更新渠道设置", onError: () => setError("无法保存更新渠道设置") });
    if (!result.ok) setUpdateChannel(previous);
  };

  const setAutoUpdatePreference = async (enabled: boolean) => {
    setAutoUpdate(enabled);
    const result = await callIpc(() => window.imageStudio.updates.setAutoUpdate(enabled), { fallbackError: "无法保存自动更新设置", onError: () => setError("无法保存自动更新设置") });
    if (!result.ok) setAutoUpdate(!enabled);
  };

  const checkUpdates = async () => {
    setUpdateStatus((current) => ({ ...current, phase: "checking", message: "正在检查更新…" }));
    const result = await callIpc(() => window.imageStudio.updates.check(), { fallbackError: "检查更新失败", onError: (message) => setUpdateStatus((current) => ({ ...current, phase: "error", message })) });
    if (!result.ok) setUpdateStatus((current) => ({ ...current, phase: "error", message: result.message }));
  };

  const downloadUpdate = async () => {
    const result = await callIpc(() => window.imageStudio.updates.download(), { fallbackError: "下载更新失败", onError: setError });
    if (!result.ok) setError(result.message);
  };

  const installUpdate = async () => {
    const result = await callIpc(() => window.imageStudio.updates.install(), { fallbackError: "安装更新失败", onError: setError });
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
      void callIpc(() => window.imageStudio.updates.setAlphaUnlocked(true), { fallbackError: "无法解锁 Alpha 测试渠道", onError: setError }).then((result) => {
        if (!result.ok) return;
        setAlphaUnlocked(true);
        setNotice("已解锁 Alpha 测试渠道");
      }).catch(() => { /* callIpc 已上报 */ });
      return;
    }
    alphaClickTimer.current = window.setTimeout(() => { alphaClickCount.current = 0; }, 1500);
  };

  const exitAlphaChannel = async () => {
    const result = await callIpc(() => window.imageStudio.updates.setAlphaUnlocked(false), { fallbackError: "无法退出内测渠道", onError: setError });
    if (!result.ok) return;
    setAlphaUnlocked(false);
    if (result.channel) setUpdateChannel(result.channel);
    setNotice("已退出内测渠道");
  };

  return (
    <section className="card settings" data-tutorial="connection-settings">
      <span className="eyebrow">CONNECTION & STORAGE</span>
      <h2>连接设置</h2>
      <p className="muted">
        支持添加多个符合当前请求格式的 OpenAI 兼容服务，并可为生图、图反推与提示词增强分别绑定模型。API 密钥仅保存到 Windows 凭据库，不会显示原文或写入项目文件。
      </p>
      <section className="provider-block">
        <div className="provider-block-head">
          <div>
            <span className="eyebrow">PROVIDERS</span>
            <h3>供应商</h3>
            <p className="muted">测试连接与刷新模型不会保存任何数据：未保存的新密钥只用于当次请求，不写入凭据库。</p>
          </div>
          <button type="button" className="secondary" onClick={beginAdd}>+ 添加供应商</button>
        </div>
        {adding && (
          <div className="provider-card provider-card-new" data-provider-form="add">
            <label>名称<input data-provider-field="name" placeholder="例如：主力平台" value={draftForm.name} onChange={(event) => setDraftForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>Base URL<input data-provider-field="baseUrl" placeholder="例如：https://api.example.com/v1" value={draftForm.baseUrl} onChange={(event) => setDraftForm((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
            <label>API 密钥
              <input
                data-provider-field="apiKey"
                type="password"
                placeholder="粘贴当前平台提供的 API 密钥"
                value={draftForm.apiKey}
                onChange={(event) => setDraftForm((current) => ({ ...current, apiKey: event.target.value }))}
              />
            </label>
            <div className="provider-form-actions">
              <button type="button" className="primary" onClick={confirmAdd}>添加</button>
              <button type="button" className="secondary" onClick={() => setAdding(false)}>取消</button>
            </div>
          </div>
        )}
        {drafts.length === 0 && !adding && <p className="muted">尚未添加供应商。</p>}
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
                  {hasKey ? <span className="key-badge ok">已保存密钥</span> : <span className="key-badge missing">缺少密钥</span>}
                </div>
                <div className="provider-card-actions">
                  <button type="button" className="secondary" onClick={() => beginEdit(draft)}>编辑</button>
                  <button type="button" className="secondary" onClick={() => void runProviderCheck(draft, "test")}>测试连接</button>
                  <button type="button" className="secondary" onClick={() => void runProviderCheck(draft, "refresh")}>刷新模型</button>
                  <button type="button" className="secondary" onClick={() => setExpandedModelsId((current) => (current === draft.id ? null : draft.id))}>模型</button>
                  <button type="button" className="secondary" onClick={() => void removeProvider(draft)}>删除</button>
                </div>
              </div>
              <code>{draft.baseUrl}</code>
              <p className="provider-meta">
                {draft.models.length} 个模型{draft.modelsUpdatedAt ? ` · 更新于 ${formatDateTime(draft.modelsUpdatedAt)}` : ""}
              </p>
              {expandedModelsId === draft.id && (
                <div className="model-role-block">
                  <div className="model-role-head">
                    <input
                      className="model-search"
                      placeholder="搜索模型"
                      value={modelSearch[draft.id] ?? ""}
                      onChange={(event) => setModelSearch((current) => ({ ...current, [draft.id]: event.target.value }))}
                    />
                    <button type="button" onClick={() => void runProviderCheck(draft, "refresh")}>刷新模型</button>
                    <button type="button" onClick={() => void addCustomModel(draft)}>+ 自定义模型</button>
                  </div>
                  <div className="model-bulk">
                    批量（作用于搜索结果）：
                    {MODEL_ROLES.map((role) => (
                      <span key={role} className="model-bulk-group">
                        <button type="button" onClick={() => bulkSetRole(draft.id, role)}>设为 {MODEL_ROLE_LABELS[role]}</button>
                        <button type="button" onClick={() => bulkClearRole(draft.id, role)}>清除 {MODEL_ROLE_LABELS[role]}</button>
                      </span>
                    ))}
                  </div>
                  <div className="model-list">
                    {filteredModels.length === 0 && <p className="model-empty">无匹配模型</p>}
                    {filteredModels.map((model) => (
                      <div className={"model-row" + (model.missing ? " missing" : "")} key={model.id}>
                        <span className="model-id">{model.id}</span>
                        {model.source === "custom" && <span className="model-custom">自定义</span>}
                        {model.missing && <span className="model-missing">已下线</span>}
                        {MODEL_ROLES.map((role) => (
                          <label key={role} className="model-role-check">
                            <input type="checkbox" checked={model.roles.includes(role)} onChange={() => toggleModelRole(draft.id, model.id, role)} /> {MODEL_ROLE_LABELS[role]}
                          </label>
                        ))}
                        {model.source === "custom" && (
                          <button type="button" className="model-remove" onClick={() => void removeCustomModel(draft.id, model.id)}>删除</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {expandedId === draft.id && (
                <div className="provider-form" data-provider-form="edit">
                  <label>名称<input data-provider-field="name" value={draftForm.name} onChange={(event) => setDraftForm((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label>Base URL<input data-provider-field="baseUrl" value={draftForm.baseUrl} onChange={(event) => setDraftForm((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
                  <label>API 密钥
                    <input
                      data-provider-field="apiKey"
                      type="password"
                      placeholder="已保存，输入新值可覆盖"
                      value={draftForm.apiKey}
                      onChange={(event) => setDraftForm((current) => ({ ...current, apiKey: event.target.value }))}
                    />
                  </label>
                  <div className="provider-form-actions">
                    <button type="button" className="primary" onClick={() => finishEdit(draft.id)}>完成</button>
                    <button type="button" className="secondary" onClick={cancelEdit}>取消</button>
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
          <h3>模型分配</h3>
          <p className="muted">为生图、图反推、提示词增强分别选择供应商与模型；只显示已标注该角色的模型。</p>
        </div>
        {MODEL_ROLES.map((role) => (
          <div className="role-binding-row" key={role}>
            <span className="role-label">{MODEL_ROLE_LABELS[role]}</span>
            <Combobox
              ariaLabel={`${MODEL_ROLE_LABELS[role]}供应商`}
              className="role-provider"
              placeholder="未分配"
              options={roleProviderOptions(role)}
              value={rolesDraft[role]?.providerId ?? ""}
              onChange={(value) => setRoleProvider(role, value)}
            />
            <Combobox
              ariaLabel={`${MODEL_ROLE_LABELS[role]}模型`}
              className="role-model"
              placeholder={rolesDraft[role] ? "选择模型" : "未分配"}
              options={roleModelOptions(role)}
              value={rolesDraft[role]?.model ?? ""}
              disabled={!rolesDraft[role]}
              onChange={(value) => setRoleModel(role, value)}
            />
            {rolesDraft[role] && <button type="button" className="role-clear" onClick={() => clearRole(role)}>清除</button>}
          </div>
        ))}
      </section>
      <label className="archive-toggle">
        <input type="checkbox" checked={autoArchiveDraft} onChange={(event) => setAutoArchiveDraft(event.target.checked)} />
        自动归档生成图片到本地图库与收件箱
      </label>
      {saveDir && <div className="storage-path">
        <div className="storage-head">
          <strong>本地保存位置</strong>
          <div className="storage-actions">
            <button type="button" onClick={() => void chooseSaveDirectory()}>选择文件夹</button>
            <button type="button" onClick={() => void openSaveDirectory()}>打开目录</button>
            <button type="button" onClick={() => void resetSaveDirectory()}>恢复默认</button>
          </div>
        </div>
        <code>{saveDir}</code>
        <small>新图片、自动图库和导出文件将使用此位置；切换目录不会移动或删除原目录中的文件。</small>
      </div>}
      <section className="update-settings">
        <div>
          <span className="eyebrow">APPLICATION UPDATE</span>
          <h3>软件更新</h3>
          <p onClick={handleVersionClick}>当前版本：v{appVersion || "—"}。开启自动更新后会在后台检查并下载新版本，安装前仍会询问，不会强制重启；关闭后仅在你手动检查时提示下载。</p>
        </div>
        <div className="update-channel">
          <span className="update-channel-label">更新渠道</span>
          <div className={alphaUnlocked ? "update-channel-options alpha-unlocked" : "update-channel-options"}>
            <button type="button" className={updateChannel === "stable" ? "active" : ""} onClick={() => void setUpdateChannelPreference("stable")}>正式版</button>
            <button type="button" className={updateChannel === "beta" ? "active" : ""} onClick={() => void setUpdateChannelPreference("beta")}>测试版 Beta</button>
            {alphaUnlocked && <button type="button" className={updateChannel === "alpha" ? "active" : ""} onClick={() => void setUpdateChannelPreference("alpha")}>Alpha 测试版</button>}
          </div>
          {alphaUnlocked && <button type="button" className="update-alpha-exit" onClick={() => void exitAlphaChannel()}>退出内测</button>}
        </div>
        <label className="archive-toggle">
          <input type="checkbox" checked={autoUpdate} onChange={(event) => void setAutoUpdatePreference(event.target.checked)} />
          自动检查并在后台下载更新（安装前询问）
        </label>
        <div className="update-actions">
          <button className="secondary" onClick={() => void checkUpdates()} disabled={updateStatus.phase === "checking"}>
            {updateStatus.phase === "checking" ? "检查中…" : "检查更新"}
          </button>
          {updateStatus.phase === "available" && <button className="primary" onClick={() => void downloadUpdate()}>下载 v{updateStatus.version}</button>}
          {updateStatus.phase === "downloading" && <span className="update-progress">下载中 {updateStatus.progress || 0}%</span>}
          {updateStatus.phase === "downloaded" && <button className="primary" onClick={() => void installUpdate()}>重启并安装 v{updateStatus.version}</button>}
        </div>
        <p className={updateStatus.phase === "error" ? "update-status error-text" : "update-status"}>{updateStatus.message}</p>
      </section>
      <section className="update-settings">
        <div>
          <span className="eyebrow">INTERFACE ZOOM</span>
          <h3>界面缩放</h3>
          <p>调整整个界面的缩放比例，当前缩放：{Math.round(zoomFactor * 100)}%。范围为 50%–200%。</p>
        </div>
        <div className="update-actions">
          <button type="button" className="secondary" onClick={() => applyZoom(Math.max(0.5, Number((zoomFactor - 0.1).toFixed(2))))}>缩小</button>
          <button type="button" className="secondary" onClick={() => applyZoom(1)}>重置</button>
          <button type="button" className="secondary" onClick={() => applyZoom(Math.min(2, Number((zoomFactor + 0.1).toFixed(2))))}>放大</button>
        </div>
      </section>
      <section className="update-settings">
        <div>
          <span className="eyebrow">ABOUT & HELP</span>
          <h3>关于与帮助</h3>
          <p>本地 OpenAI 兼容图片创作工具，支持自定义基础地址、模型、文生图、图片编辑和常用输出尺寸。</p>
          <p>Copyright (C) 2026 zztnbnb。本项目以 GNU Affero General Public License v3.0 only 发布，不提供任何担保。</p>
        </div>
        <div className="update-actions">
          <button type="button" className="secondary" onClick={onOpenTutorial}>打开新手教程</button>
          <a href="https://github.com/zztnbnb/image-studio/blob/main/LICENSE" target="_blank" rel="noreferrer" className="secondary">查看许可证与源代码</a>
        </div>
      </section>
      <div className="actions">
        <button className="primary" onClick={() => void saveSettings()} disabled={saving}>{saving ? "保存中…" : "保存设置"}</button>
      </div>
    </section>
  );
}
