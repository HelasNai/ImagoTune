import { describe, expect, it } from "vitest";
import type { ModelConfig, ProviderApiStyle, ProviderConfig, ProviderModel, SettingsSavePayload } from "../shared/types";
import {
  buildLegacyModelConfig,
  deriveConfigured,
  findProvider,
  mergeFetchedModels,
  parseModelsResponse,
  resolveJobBinding,
  resolveRoleBinding,
  runSavePlan,
  stripProviderSecrets,
  validateSavePayload,
} from "../electron/model-config";

const UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const UUID_B = "123e4567-e89b-42d3-a456-426614174001";

function makeProvider(id: string, over: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id, name: "供应商-" + id, baseUrl: "https://api.example.com/v1", models: [], ...over };
}

function makeConfig(over: Partial<ModelConfig> = {}): ModelConfig {
  return {
    version: 1,
    providers: [makeProvider("legacy")],
    roles: { image: null, reverse: null, enhance: null },
    autoArchive: true,
    ...over,
  };
}

function makePayload(over: Partial<SettingsSavePayload> = {}): SettingsSavePayload {
  return {
    providers: [{ ...makeProvider(UUID_A), apiKey: "sk-secret" }],
    removedProviderIds: [],
    roles: { image: null, reverse: null, enhance: null },
    autoArchive: true,
    ...over,
  };
}

describe("parseModelsResponse", () => {
  it("解析 {data:[{id}]} 变体", () => {
    expect(parseModelsResponse({ data: [{ id: "gpt-image-2" }, { id: "dall-e-3" }] })).toEqual([
      "dall-e-3",
      "gpt-image-2",
    ]);
  });

  it("解析 {data:[\"id\"]} 字符串元素变体", () => {
    expect(parseModelsResponse({ data: ["b-model", "a-model"] })).toEqual(["a-model", "b-model"]);
  });

  it("解析 {models:[...]} 变体", () => {
    expect(parseModelsResponse({ models: [{ id: "m2" }, "m1"] })).toEqual(["m1", "m2"]);
  });

  it("容错 {data:[{model}]} 元素", () => {
    expect(parseModelsResponse({ data: [{ model: "via-model-key" }] })).toEqual(["via-model-key"]);
  });

  it("精确去重且大小写不敏感排序", () => {
    expect(parseModelsResponse({ data: ["Beta", "alpha", "Beta", "Gamma"] })).toEqual(["alpha", "Beta", "Gamma"]);
  });

  it("超过 500 条截断到 500", () => {
    const many = Array.from({ length: 600 }, (_, i) => "model-" + String(i).padStart(4, "0"));
    const result = parseModelsResponse({ data: many });
    expect(result).toHaveLength(500);
    expect(result[0]).toBe("model-0000");
    expect(result[499]).toBe("model-0499");
  });

  it("畸形输入返回空数组且不抛异常", () => {
    expect(parseModelsResponse(undefined)).toEqual([]);
    expect(parseModelsResponse(null)).toEqual([]);
    expect(parseModelsResponse("string")).toEqual([]);
    expect(parseModelsResponse(42)).toEqual([]);
    expect(parseModelsResponse({ data: "not-array" })).toEqual([]);
    expect(parseModelsResponse({ data: [{}, { id: 1 }, null, ""] })).toEqual([]);
  });
});

describe("mergeFetchedModels", () => {
  it("已存在条目保留标注与顺序", () => {
    const existing: ProviderModel[] = [
      { id: "m-b", roles: ["image"] },
      { id: "m-a", roles: ["reverse", "enhance"] },
    ];
    const merged = mergeFetchedModels(existing, ["m-b", "m-a"]);
    expect(merged.map((m) => m.id)).toEqual(["m-b", "m-a"]);
    expect(merged[0].roles).toEqual(["image"]);
    expect(merged[1].roles).toEqual(["reverse", "enhance"]);
    expect(merged[0].missing).toBeUndefined();
  });

  it("fetch 来源且新列表缺失的条目标记 missing", () => {
    const merged = mergeFetchedModels([{ id: "gone", roles: [] }], ["other"]);
    expect(merged[0]).toEqual({ id: "gone", roles: [], missing: true });
  });

  it("custom 条目即使不在新列表也永不 missing", () => {
    const merged = mergeFetchedModels([{ id: "mine", roles: ["image"], source: "custom" }], []);
    expect(merged[0].missing).toBeUndefined();
    expect(merged[0].source).toBe("custom");
  });

  it("消失的条目重现时清除 missing", () => {
    const merged = mergeFetchedModels([{ id: "back", roles: ["image"], missing: true }], ["back"]);
    expect(merged[0]).toEqual({ id: "back", roles: ["image"] });
    expect("missing" in merged[0]).toBe(false);
  });

  it("新出现的 id 按 fetched 顺序追加且 roles 为空", () => {
    const merged = mergeFetchedModels([{ id: "old", roles: [] }], ["new-z", "old", "new-a"]);
    expect(merged.map((m) => m.id)).toEqual(["old", "new-z", "new-a"]);
    expect(merged[1]).toEqual({ id: "new-z", roles: [] });
  });
});

describe("buildLegacyModelConfig", () => {
  it("两个不同模型生成两条带 roles 标注的模型记录", () => {
    const config = buildLegacyModelConfig({
      baseUrl: "https://api.example.com/v1",
      imageModel: "gpt-image-2",
      chatModel: "gpt-4o",
      autoArchive: false,
    });
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].models).toEqual([
      { id: "gpt-image-2", roles: ["image"] },
      { id: "gpt-4o", roles: ["reverse", "enhance"] },
    ]);
  });

  it("imageModel 与 chatModel 相同时合并为一条且 roles 取并集去重", () => {
    const config = buildLegacyModelConfig({ baseUrl: "", imageModel: "same", chatModel: "same", autoArchive: true });
    expect(config.providers[0].models).toEqual([{ id: "same", roles: ["image", "reverse", "enhance"] }]);
  });

  it("imageModel 为空时 roles.image 为 null 且不产生空模型条目", () => {
    const config = buildLegacyModelConfig({ baseUrl: "", imageModel: "", chatModel: "gpt-4o", autoArchive: true });
    expect(config.roles.image).toBeNull();
    expect(config.providers[0].models).toEqual([{ id: "gpt-4o", roles: ["reverse", "enhance"] }]);
  });

  it("供应商 id 为 legacy、名称为默认服务，三角色绑定正确", () => {
    const config = buildLegacyModelConfig({
      baseUrl: "https://x",
      imageModel: "img",
      chatModel: "chat",
      autoArchive: true,
    });
    expect(config.providers[0].id).toBe("legacy");
    expect(config.providers[0].name).toBe("默认服务");
    expect(config.providers[0].baseUrl).toBe("https://x");
    expect(config.roles.image).toEqual({ providerId: "legacy", model: "img" });
    expect(config.roles.reverse).toEqual({ providerId: "legacy", model: "chat" });
    expect(config.roles.enhance).toEqual({ providerId: "legacy", model: "chat" });
  });

  it("chatModel 为空时 reverse/enhance 为 null 且仅有 image 模型条目", () => {
    const config = buildLegacyModelConfig({ baseUrl: "", imageModel: "img", chatModel: "", autoArchive: true });
    expect(config.roles.reverse).toBeNull();
    expect(config.roles.enhance).toBeNull();
    expect(config.providers[0].models).toEqual([{ id: "img", roles: ["image"] }]);
  });
});

describe("validateSavePayload", () => {
  it("合法载荷通过校验", () => {
    const payload = makePayload({
      roles: { image: { providerId: UUID_A, model: "gpt-image-2" }, reverse: null, enhance: null },
    });
    expect(validateSavePayload(payload, [])).toEqual({ ok: true });
  });

  it("角色绑定指向不存在的供应商被拒绝", () => {
    const payload = makePayload({
      roles: { image: { providerId: UUID_B, model: "m" }, reverse: null, enhance: null },
    });
    const result = validateSavePayload(payload, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("角色绑定的供应商不存在");
  });

  it("角色绑定模型名为空白被拒绝", () => {
    const payload = makePayload({
      roles: { image: { providerId: UUID_A, model: "   " }, reverse: null, enhance: null },
    });
    const result = validateSavePayload(payload, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("模型名不能为空");
  });

  it("新增供应商 id 非 UUID 格式被拒绝", () => {
    const payload = makePayload({ providers: [makeProvider("not-a-uuid")] });
    const result = validateSavePayload(payload, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("新增供应商 id 必须是 UUID 格式");
  });

  it("载荷内供应商 id 重复被拒绝", () => {
    const payload = makePayload({ providers: [makeProvider(UUID_A), makeProvider(UUID_A)] });
    const result = validateSavePayload(payload, [UUID_A]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("供应商 id 重复");
  });

  it("保留名 legacy 不可作为新供应商 id", () => {
    const payload = makePayload({ providers: [makeProvider("legacy")] });
    const result = validateSavePayload(payload, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("保留 id 不可作为新供应商 id");
  });

  it("既有 legacy 供应商编辑时保持合法", () => {
    const payload = makePayload({ providers: [makeProvider("legacy", { name: "默认服务" })] });
    expect(validateSavePayload(payload, ["legacy"])).toEqual({ ok: true });
  });

  it("供应商名称为空白被拒绝", () => {
    const payload = makePayload({ providers: [makeProvider(UUID_A, { name: "  " })] });
    const result = validateSavePayload(payload, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("供应商名称不能为空");
  });

  it("供应商 id 为空被拒绝", () => {
    const payload = makePayload({ providers: [makeProvider(" ")] });
    const result = validateSavePayload(payload, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("供应商 id 不能为空");
  });

  it("api 为 hunyuan-image 时通过校验", () => {
    const payload = makePayload({ providers: [{ ...makeProvider(UUID_A), api: "hunyuan-image", apiKey: "sk-secret" }] });
    expect(validateSavePayload(payload, [])).toEqual({ ok: true });
  });

  it("api 为 openai 时通过校验", () => {
    const payload = makePayload({ providers: [{ ...makeProvider(UUID_A), api: "openai", apiKey: "sk-secret" }] });
    expect(validateSavePayload(payload, [])).toEqual({ ok: true });
  });

  it("api 缺省（undefined）时通过校验", () => {
    const payload = makePayload({ providers: [makeProvider(UUID_A)] });
    expect(payload.providers[0].api).toBeUndefined();
    expect(validateSavePayload(payload, [])).toEqual({ ok: true });
  });

  it("api 为未知值时返回接口风格无效", () => {
    const payload = makePayload({ providers: [{ ...makeProvider(UUID_A), api: "foo" as ProviderApiStyle }] });
    const result = validateSavePayload(payload, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("供应商接口风格无效");
  });
});

describe("resolveRoleBinding", () => {
  it("返回已配置的角色绑定", () => {
    const config = makeConfig({ roles: { image: { providerId: "legacy", model: "img" }, reverse: null, enhance: null } });
    expect(resolveRoleBinding(config, "image")).toEqual({ providerId: "legacy", model: "img" });
  });

  it("未绑定的角色返回 null", () => {
    expect(resolveRoleBinding(makeConfig(), "enhance")).toBeNull();
  });

  it("roles 字段缺失时防御性返回 null", () => {
    const broken = makeConfig() as ModelConfig & { roles: unknown };
    broken.roles = undefined;
    expect(resolveRoleBinding(broken, "image")).toBeNull();
  });
});

describe("resolveJobBinding", () => {
  const current = { providerId: "p-current", model: "m-current" };

  it("job 含 providerId 与 model 时按快照解析", () => {
    const result = resolveJobBinding({ providerId: "p-a", model: "m-a", input: {} }, current);
    expect(result).toEqual({ ok: true, binding: { providerId: "p-a", model: "m-a" } });
  });

  it("job 含 providerId 缺 model 时回退 recipe.model", () => {
    const result = resolveJobBinding(
      { providerId: "p-a", input: { recipe: { model: "m-recipe" } } },
      current
    );
    expect(result).toEqual({ ok: true, binding: { providerId: "p-a", model: "m-recipe" } });
  });

  it("job 含 providerId 但 model 与 recipe.model 均缺时 fail-closed", () => {
    const result = resolveJobBinding({ providerId: "p-a", input: {} }, current);
    expect(result).toEqual({ ok: false, reason: "missing-model" });
  });

  it("job 含 providerId 且 recipe.model 非字符串时同样 fail-closed", () => {
    const result = resolveJobBinding({ providerId: "p-a", model: "", input: { recipe: { model: 1 } } }, current);
    expect(result).toEqual({ ok: false, reason: "missing-model" });
  });

  it("job 无 providerId 时全取当前绑定且不混用 recipe.model", () => {
    const result = resolveJobBinding({ input: { recipe: { model: "m-recipe" } } }, current);
    expect(result).toEqual({ ok: true, binding: current });
  });

  it("job 无 providerId 且当前未绑定时返回 unbound", () => {
    const result = resolveJobBinding({ input: {} }, null);
    expect(result).toEqual({ ok: false, reason: "unbound" });
  });
});

describe("deriveConfigured", () => {
  const ready = makeConfig({
    roles: { image: { providerId: "legacy", model: "img" }, reverse: null, enhance: null },
  });

  it("绑定/provider/model/baseUrl/hasKey 全部满足时为 true", () => {
    expect(deriveConfigured(ready, () => true)).toBe(true);
  });

  it("image 绑定缺失时为 false", () => {
    expect(deriveConfigured(makeConfig(), () => true)).toBe(false);
  });

  it("绑定指向的 provider 不存在时为 false", () => {
    const config = makeConfig({
      roles: { image: { providerId: "ghost", model: "img" }, reverse: null, enhance: null },
    });
    expect(deriveConfigured(config, () => true)).toBe(false);
  });

  it("绑定 model 为空白时为 false", () => {
    const config = makeConfig({
      roles: { image: { providerId: "legacy", model: " " }, reverse: null, enhance: null },
    });
    expect(deriveConfigured(config, () => true)).toBe(false);
  });

  it("provider baseUrl 为空白时为 false", () => {
    const config = makeConfig({
      providers: [makeProvider("legacy", { baseUrl: "  " })],
      roles: { image: { providerId: "legacy", model: "img" }, reverse: null, enhance: null },
    });
    expect(deriveConfigured(config, () => true)).toBe(false);
  });

  it("hasKey 返回 false 时为 false", () => {
    expect(deriveConfigured(ready, () => false)).toBe(false);
  });
});

describe("runSavePlan", () => {
  it("全部步骤按序成功时返回 ok", async () => {
    const calls: string[] = [];
    const result = await runSavePlan(
      [
        { account: "provider:a", value: "k1" },
        { account: "provider:b", value: "k2" },
      ],
      async (account) => {
        calls.push(account);
      }
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["provider:a", "provider:b"]);
  });

  it("中途失败立即中止：不回显密钥、后续步骤不执行", async () => {
    const calls: string[] = [];
    const result = await runSavePlan(
      [
        { account: "provider:a", value: "secret-1" },
        { account: "provider:b", value: "secret-2" },
        { account: "provider:c", value: "secret-3" },
      ],
      async (account) => {
        calls.push(account);
        if (account === "provider:b") throw new Error("凭据库不可用");
      }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("无法写入 Windows 凭据库：凭据库不可用");
    expect(result.error).not.toContain("secret");
    expect(calls).toEqual(["provider:a", "provider:b"]);
  });
});

describe("stripProviderSecrets", () => {
  it("剥离 apiKey 后序列化结果不含任何 apiKey 键", () => {
    const stripped = stripProviderSecrets([
      { ...makeProvider("legacy"), apiKey: "sk-top-secret" },
      { ...makeProvider(UUID_A), apiKey: "sk-another" },
    ]);
    expect(JSON.stringify(stripped)).not.toContain("apiKey");
    expect(JSON.stringify(stripped)).not.toContain("sk-top-secret");
    expect(stripped[0]).toEqual(makeProvider("legacy"));
  });

  it("原本无 apiKey 的供应商原样保留", () => {
    expect(stripProviderSecrets([makeProvider("legacy")])).toEqual([makeProvider("legacy")]);
  });
});

describe("findProvider", () => {
  it("按 id 找到供应商，找不到返回 undefined", () => {
    const config = makeConfig({ providers: [makeProvider("legacy"), makeProvider(UUID_A)] });
    expect(findProvider(config, UUID_A)?.id).toBe(UUID_A);
    expect(findProvider(config, "missing")).toBeUndefined();
  });
});
