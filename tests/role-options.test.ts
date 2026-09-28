import { describe, expect, it } from "vitest";
import {
  MODEL_ROLES,
  MODEL_ROLE_LABELS,
  buildQuickSwitchPayload,
  firstAnnotatedModel,
  roleModelOptions,
  roleProviderOptions,
} from "../src/lib/role-options";

// 基础 fixture：一份含三角色标注的供应商配置。

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "p1",
    name: "平台甲",
    baseUrl: "https://api.example.com/v1",
    models: [
      { id: "m1", roles: ["image"] },
      { id: "m2", roles: ["enhance"], source: "custom" },
      { id: "m3", roles: ["image", "reverse"] },
    ],
    modelsUpdatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProviderSummary(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return { ...makeProvider(), hasKey: true, ...overrides };
}

function makeRoles(overrides: Partial<Record<ModelRole, RoleBinding | null>> = {}): Record<ModelRole, RoleBinding | null> {
  return {
    image: { providerId: "p1", model: "m1" },
    reverse: { providerId: "p1", model: "m3" },
    enhance: { providerId: "p1", model: "m2" },
    ...overrides,
  };
}

describe("MODEL_ROLES / MODEL_ROLE_LABELS", () => {
  it("角色列表与显示名固定为三角色", () => {
    expect(MODEL_ROLES).toEqual(["image", "reverse", "enhance"]);
    expect(MODEL_ROLE_LABELS).toEqual({ image: "生图", reverse: "图反推", enhance: "提示词增强" });
  });
});

describe("roleProviderOptions", () => {
  it("按传入顺序映射全部供应商为 {value: id, label: name}", () => {
    const providers = [makeProvider(), makeProvider({ id: "p2", name: "平台乙" })];
    expect(roleProviderOptions(providers, null)).toEqual([
      { value: "p1", label: "平台甲" },
      { value: "p2", label: "平台乙" },
    ]);
  });

  it("绑定指向已删除供应商时置顶注入 ⚠ 项，其余顺序不变", () => {
    const providers = [makeProvider(), makeProvider({ id: "p2", name: "平台乙" })];
    const binding: RoleBinding = { providerId: "p9", model: "mX" };
    expect(roleProviderOptions(providers, binding)).toEqual([
      { value: "p9", label: "⚠ 已删除的供应商" },
      { value: "p1", label: "平台甲" },
      { value: "p2", label: "平台乙" },
    ]);
  });
});

describe("roleModelOptions", () => {
  it("绑定为空时返回空数组", () => {
    expect(roleModelOptions([makeProvider()], null, "image")).toEqual([]);
  });

  it("仅列出该角色已标注的模型，未标注的过滤掉", () => {
    // p1 的 m2 只标注 enhance，role=image 时应被过滤。
    const binding: RoleBinding = { providerId: "p1", model: "m1" };
    expect(roleModelOptions([makeProvider()], binding, "image")).toEqual([
      { value: "m1", label: "m1" },
      { value: "m3", label: "m3" },
    ]);
  });

  it("绑定模型未标注时置顶注入 ⚠ 项", () => {
    // m2 标注为 enhance，role=image 下未标注 → 置顶可见。
    const binding: RoleBinding = { providerId: "p1", model: "m2" };
    expect(roleModelOptions([makeProvider()], binding, "image")).toEqual([
      { value: "m2", label: "m2 ⚠ 未标注" },
      { value: "m1", label: "m1" },
      { value: "m3", label: "m3" },
    ]);
  });

  it("供应商不存在时只返回绑定模型 ⚠ 项", () => {
    const binding: RoleBinding = { providerId: "p9", model: "mX" };
    expect(roleModelOptions([makeProvider()], binding, "image")).toEqual([
      { value: "mX", label: "mX ⚠ 未标注" },
    ]);
  });
});

describe("firstAnnotatedModel", () => {
  it("返回首个标注该角色的模型 id（跳过前面未标注的）", () => {
    // reverse 仅 m3 标注，跳过 m1/m2。
    expect(firstAnnotatedModel([makeProvider()], "p1", "reverse")).toBe("m3");
  });

  it("无任何模型标注该角色时返回 null", () => {
    const provider = makeProvider({ models: [{ id: "m1", roles: ["image"] }] });
    expect(firstAnnotatedModel([provider], "p1", "enhance")).toBeNull();
  });

  it("供应商不存在时返回 null", () => {
    expect(firstAnnotatedModel([makeProvider()], "p9", "image")).toBeNull();
  });
});

describe("buildQuickSwitchPayload", () => {
  it("剥离 hasKey，保留 ProviderConfig 形状", () => {
    const input = [makeProviderSummary(), makeProviderSummary({ id: "p2", name: "平台乙", hasKey: false })];
    const output = buildQuickSwitchPayload(input, makeRoles(), true);
    expect(output.providers[0]).not.toHaveProperty("hasKey");
    expect(output.providers[1]).not.toHaveProperty("hasKey");
    expect(output.providers[0]).toEqual(makeProvider());
    expect(output.providers[1]).toEqual(makeProvider({ id: "p2", name: "平台乙" }));
  });

  it("removedProviderIds 为空数组，roles 与 autoArchive 原样透传", () => {
    const roles = makeRoles();
    const output = buildQuickSwitchPayload([makeProviderSummary()], roles, false);
    expect(output.removedProviderIds).toEqual([]);
    expect(output.roles).toEqual(roles);
    expect(output.autoArchive).toBe(false);
  });

  it("序列化结果不含 hasKey 或 apiKey 键", () => {
    const input = [makeProviderSummary()];
    const serialized = JSON.stringify(buildQuickSwitchPayload(input, makeRoles(), true));
    expect(serialized).not.toContain("hasKey");
    expect(serialized).not.toContain("apiKey");
  });
});
