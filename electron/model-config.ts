// electron/model-config.ts
// 多供应商模型配置的纯逻辑模块（无 IPC / 无副作用 / 无 electron 依赖，仅供 vitest 与 main.ts 复用）。
// 契约来源：.omo/plans/multi-provider-model-config.md 的 D2/D3/D5/D10/D12。
import type {
  Locale,
  ModelConfig,
  ModelRole,
  ProviderConfig,
  ProviderModel,
  RoleBinding,
  SettingsSavePayload,
} from "../shared/types";

const MODEL_LIST_CAP = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED_PROVIDER_IDS = new Set(["legacy"]);

// 保存校验允许的接口风格白名单；新增平台时与 shared/types.d.ts 的 ProviderApiStyle 同步维护（两处必须一起改）。
const VALID_API_STYLES = new Set<string>([
  "openai",
  "hunyuan-image",
  "zhipu-image",
  "volcengine-image",
  "dashscope-image",
  "siliconflow-image",
  "xai-image",
  "openrouter-image",
]);

// D7 辅助：解析 /models 响应为干净的模型 id 列表。
// 兼容 {data:[{id}]}、{data:["id"]}、{models:[...]}，元素可为 string | {id} | {model}。
// 精确去重、大小写不敏感排序、上限 500；任何畸形输入返回 []，绝不抛异常。
export function parseModelsResponse(raw: unknown): string[] {
  try {
    if (typeof raw !== "object" || raw === null) return [];
    const container = raw as Record<string, unknown>;
    const list = Array.isArray(container.data)
      ? container.data
      : Array.isArray(container.models)
        ? container.models
        : null;
    if (!list) return [];
    const seen = new Set<string>();
    for (const item of list) {
      let id: unknown;
      if (typeof item === "string") {
        id = item;
      } else if (typeof item === "object" && item !== null) {
        const record = item as Record<string, unknown>;
        id = typeof record.id === "string" ? record.id : typeof record.model === "string" ? record.model : undefined;
      }
      if (typeof id === "string" && id.length > 0) seen.add(id);
    }
    return Array.from(seen)
      .sort((a, b) => {
        const la = a.toLowerCase();
        const lb = b.toLowerCase();
        if (la !== lb) return la < lb ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      })
      .slice(0, MODEL_LIST_CAP);
  } catch {
    return [];
  }
}

// D10：刷新合并。保留已有标注（roles）与顺序；custom 条目永不 missing；
// fetch 来源且新列表缺失的条目置 missing:true，重现时清除；新 id 按 fetched 顺序追加（roles:[]）。
export function mergeFetchedModels(existing: ProviderModel[], fetched: string[]): ProviderModel[] {
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
  for (const id of fetched) {
    if (!existingIds.has(id)) merged.push({ id, roles: [] });
  }
  return merged;
}

// C1 迁移合成：由旧单供应商键值合成 ModelConfig。
// 模型标注 [{id:imageModel, roles:["image"]}] + [{id:chatModel, roles:["reverse","enhance"]}]，
// 同 id 合并为一条且 roles 取并集去重（顺序 image → reverse → enhance）；
// 空字符串模型不产生模型条目与角色绑定。
export function buildLegacyModelConfig(input: {
  baseUrl: string;
  imageModel: string;
  chatModel: string;
  autoArchive: boolean;
}): ModelConfig {
  const hasImage = input.imageModel.trim().length > 0;
  const hasChat = input.chatModel.trim().length > 0;
  const models: ProviderModel[] = [];
  if (hasImage) models.push({ id: input.imageModel, roles: ["image"] });
  if (hasChat) {
    const existing = models.find((model) => model.id === input.chatModel);
    if (existing) {
      if (!existing.roles.includes("reverse")) existing.roles.push("reverse");
      if (!existing.roles.includes("enhance")) existing.roles.push("enhance");
    } else {
      models.push({ id: input.chatModel, roles: ["reverse", "enhance"] });
    }
  }
  const binding = (model: string, present: boolean): RoleBinding | null =>
    present ? { providerId: "legacy", model } : null;
  return {
    version: 1,
    providers: [{ id: "legacy", name: "默认服务", baseUrl: input.baseUrl, models }],
    roles: {
      image: binding(input.imageModel, hasImage),
      reverse: binding(input.chatModel, hasChat),
      enhance: binding(input.chatModel, hasChat),
    },
    autoArchive: input.autoArchive,
  };
}

// D12：保存载荷校验。existingProviderIds 为当前 JSON 中已存在的供应商 id（用于区分新增）。
// 规则：角色绑定的 providerId 必须存在且 model 非空；id 非空且载荷内唯一；
// 新增 id 必须为 UUID 格式且不得为保留名（含 "legacy"）；既有 id 保持原格式；名称非空。
export function validateSavePayload(
  payload: SettingsSavePayload,
  existingProviderIds: string[]
): { ok: true } | { ok: false; error: string } {
  const existing = new Set(existingProviderIds);
  const ids = new Set<string>();
  for (const provider of payload.providers) {
    if (provider.id.trim().length === 0) return { ok: false, error: "供应商 id 不能为空" };
    if (ids.has(provider.id)) return { ok: false, error: "供应商 id 重复" };
    ids.add(provider.id);
    if (provider.name.trim().length === 0) return { ok: false, error: "供应商名称不能为空" };
    // api 缺省（undefined）合法（旧配置运行时归一为 openai）；一旦提供必须是已知枚举。
    if (provider.api !== undefined && !VALID_API_STYLES.has(provider.api)) {
      return { ok: false, error: "供应商接口风格无效" };
    }
    if (!existing.has(provider.id)) {
      if (RESERVED_PROVIDER_IDS.has(provider.id)) return { ok: false, error: "保留 id 不可作为新供应商 id" };
      if (!UUID_PATTERN.test(provider.id)) return { ok: false, error: "新增供应商 id 必须是 UUID 格式" };
    }
  }
  const roleNames: ModelRole[] = ["image", "reverse", "enhance"];
  for (const role of roleNames) {
    const bindingValue = payload.roles ? payload.roles[role] : null;
    if (bindingValue == null) continue;
    if (!ids.has(bindingValue.providerId)) return { ok: false, error: "角色绑定的供应商不存在" };
    if (typeof bindingValue.model !== "string" || bindingValue.model.trim().length === 0) {
      return { ok: false, error: "模型名不能为空" };
    }
  }
  return { ok: true };
}

// D2：纯配置解析（零 keytar 读）。返回 config.roles[role]，对缺失字段防御性返回 null。
export function resolveRoleBinding(config: ModelConfig, role: ModelRole): RoleBinding | null {
  const roles = config.roles;
  if (!roles) return null;
  return roles[role] ?? null;
}

// D3：队列任务绑定解析（全有或全无 + fail-closed）。
// job.providerId 存在 → model 取 job.model ?? job.input.recipe.model，两者均缺 → "missing-model"；
// job.providerId 缺失 → 全取当前绑定；当前绑定为 null → "unbound"。绝不混搭两处来源。
export function resolveJobBinding(
  job: { providerId?: string; model?: string; input: Record<string, unknown> },
  current: RoleBinding | null
): { ok: true; binding: RoleBinding } | { ok: false; reason: "missing-model" | "unbound" } {
  if (typeof job.providerId === "string" && job.providerId.length > 0) {
    const direct = typeof job.model === "string" && job.model.trim().length > 0 ? job.model : null;
    let recipeModel: string | null = null;
    const recipe = job.input && typeof job.input === "object" ? job.input.recipe : undefined;
    if (recipe && typeof recipe === "object") {
      const value = (recipe as Record<string, unknown>).model;
      if (typeof value === "string" && value.trim().length > 0) recipeModel = value;
    }
    const model = direct ?? recipeModel;
    if (!model) return { ok: false, reason: "missing-model" };
    return { ok: true, binding: { providerId: job.providerId, model } };
  }
  if (current) return { ok: true, binding: current };
  return { ok: false, reason: "unbound" };
}

// D12 configured 定义：image 绑定可解析 = 绑定非空 + provider 存在 + model 非空 + baseUrl 非空 + hasKey。
export function deriveConfigured(config: ModelConfig, hasKey: (providerId: string) => boolean): boolean {
  const binding = resolveRoleBinding(config, "image");
  if (!binding) return false;
  if (binding.model.trim().length === 0) return false;
  const provider = findProvider(config, binding.providerId);
  if (!provider) return false;
  if (provider.baseUrl.trim().length === 0) return false;
  return hasKey(provider.id) === true;
}

// D5 步骤②：密钥写序编排。严格按序执行；任一 writer 抛错立即中止（不回显密钥值），全部成功返回 {ok:true}。
export async function runSavePlan(
  steps: Array<{ account: string; value: string }>,
  writer: (account: string, value: string) => Promise<void>
): Promise<{ ok: boolean; error?: string }> {
  for (const step of steps) {
    try {
      await writer(step.account, step.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: "无法写入 Windows 凭据库：" + message };
    }
  }
  return { ok: true };
}

// 按 id 查找供应商配置。
export function findProvider(config: ModelConfig, id: string): ProviderConfig | undefined {
  return config.providers.find((provider) => provider.id === id);
}

// D5 步骤③密钥红线：剥离 apiKey 后写 JSON。输出中不得出现任何 apiKey 键。
export function stripProviderSecrets(providers: Array<ProviderConfig & { apiKey?: string }>): ProviderConfig[] {
  return providers.map((provider) => {
    const { apiKey: _stripped, ...meta } = provider;
    void _stripped;
    return meta;
  });
}

// —— 界面语言 locale：纯逻辑（解析/回退/重建合并）。主进程只负责 I/O 编排。——

/** 解析任意值为合法 Locale；仅接受 "zh" | "en"，其余（含缺失/非字符串）一律丢弃返回 undefined。 */
export function parseLocale(value: unknown): Locale | undefined {
  return value === "zh" || value === "en" ? value : undefined;
}

/** 从配置读取有效 locale；缺失或非法时回退 fallback（启动时由 app.getLocale 映射而来）。 */
export function resolveLocale(config: ModelConfig | null | undefined, fallback: Locale): Locale {
  return parseLocale(config?.locale) ?? fallback;
}

/**
 * 由保存载荷重建 ModelConfig。
 * SettingsSavePayload 形状固定、不含 locale，故必须显式并入「当前持久化的 locale」——
 * 普通设置保存（供应商/角色/autoArchive）绝不因重建而丢失语言偏好。
 * locale 为 undefined 时不写入字段（兼容尚未初始化/旧配置）。
 */
export function rebuildModelConfig(payload: SettingsSavePayload, locale: Locale | undefined): ModelConfig {
  const next: ModelConfig = {
    version: 1,
    providers: stripProviderSecrets(payload.providers),
    roles: payload.roles,
    autoArchive: payload.autoArchive,
  };
  if (locale !== undefined) next.locale = locale;
  return next;
}
