import { describe, expect, it } from "vitest";
import { isSettingsDirty } from "../src/lib/settings-dirty";

// 基础 fixture：一份草稿与一份内容完全一致的快照（仅 hasKey 为快照独有字段）。

function makeProviderDraft(overrides: Partial<ProviderConfig & { apiKey?: string }> = {}): ProviderConfig & {
  apiKey?: string;
} {
  return {
    id: "p1",
    name: "平台甲",
    baseUrl: "https://api.example.com/v1",
    models: [
      { id: "m1", roles: ["image"] },
      { id: "m2", roles: ["enhance"], source: "custom" },
    ],
    modelsUpdatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProviderSummary(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return { ...makeProviderDraft(), hasKey: true, ...overrides };
}

function makeRoles(overrides: Partial<Record<ModelRole, RoleBinding | null>> = {}): Record<ModelRole, RoleBinding | null> {
  return {
    image: { providerId: "p1", model: "m1" },
    reverse: null,
    enhance: { providerId: "p1", model: "m2" },
    ...overrides,
  };
}

function makeDraft(overrides: Partial<SettingsSavePayload> = {}): SettingsSavePayload {
  return {
    providers: [makeProviderDraft()],
    removedProviderIds: [],
    roles: makeRoles(),
    autoArchive: true,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<Pick<SettingsSnapshot, "providers" | "roles" | "autoArchive">> = {},
): Pick<SettingsSnapshot, "providers" | "roles" | "autoArchive"> {
  return {
    providers: [makeProviderSummary()],
    roles: makeRoles(),
    autoArchive: true,
    ...overrides,
  };
}

describe("isSettingsDirty", () => {
  it("完全一致时返回 false（快照 hasKey 混合 true/false 不影响）", () => {
    const snapshot = makeSnapshot({
      providers: [
        makeProviderSummary({ hasKey: true }),
        makeProviderSummary({ id: "p2", name: "平台乙", hasKey: false }),
      ],
    });
    const draft = makeDraft({
      providers: [makeProviderDraft(), makeProviderDraft({ id: "p2", name: "平台乙" })],
    });
    expect(isSettingsDirty(draft, snapshot)).toBe(false);
  });

  it("草稿任一供应商填写非空白 apiKey 时返回 true", () => {
    const draft = makeDraft({ providers: [makeProviderDraft({ apiKey: "sk-new" })] });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("apiKey 为空串或纯空白时返回 false", () => {
    expect(isSettingsDirty(makeDraft({ providers: [makeProviderDraft({ apiKey: "" })] }), makeSnapshot())).toBe(false);
    expect(isSettingsDirty(makeDraft({ providers: [makeProviderDraft({ apiKey: "   " })] }), makeSnapshot())).toBe(false);
    expect(isSettingsDirty(makeDraft({ providers: [makeProviderDraft({ apiKey: undefined })] }), makeSnapshot())).toBe(false);
  });

  it("autoArchive 翻转时返回 true", () => {
    expect(isSettingsDirty(makeDraft({ autoArchive: false }), makeSnapshot({ autoArchive: true }))).toBe(true);
    expect(isSettingsDirty(makeDraft({ autoArchive: true }), makeSnapshot({ autoArchive: false }))).toBe(true);
  });

  it("removedProviderIds 非空时返回 true", () => {
    expect(isSettingsDirty(makeDraft({ removedProviderIds: ["p9"] }), makeSnapshot())).toBe(true);
    expect(isSettingsDirty(makeDraft({ removedProviderIds: [] }), makeSnapshot())).toBe(false);
  });

  it("角色绑定 null 变为有值时返回 true", () => {
    const draft = makeDraft({ roles: makeRoles({ reverse: { providerId: "p1", model: "m2" } }) });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("角色绑定有值变为 null 时返回 true", () => {
    const draft = makeDraft({ roles: makeRoles({ enhance: null }) });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("角色绑定 model 改变时返回 true", () => {
    const draft = makeDraft({ roles: makeRoles({ image: { providerId: "p1", model: "m-other" } }) });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("角色绑定 providerId 改变时返回 true", () => {
    const draft = makeDraft({ roles: makeRoles({ enhance: { providerId: "p2", model: "m2" } }) });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("草稿新增供应商时返回 true", () => {
    const draft = makeDraft({ providers: [makeProviderDraft(), makeProviderDraft({ id: "p2" })] });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("草稿移除供应商时返回 true", () => {
    const draft = makeDraft({ providers: [] });
    const snapshot = makeSnapshot();
    expect(isSettingsDirty(draft, snapshot)).toBe(true);
  });

  it("等长替换供应商 id 时返回 true", () => {
    const draft = makeDraft({
      providers: [makeProviderDraft(), makeProviderDraft({ id: "p3", name: "平台丙" })],
    });
    const snapshot = makeSnapshot({
      providers: [makeProviderSummary(), makeProviderSummary({ id: "p2", name: "平台乙" })],
    });
    expect(isSettingsDirty(draft, snapshot)).toBe(true);
  });

  it("供应商 name 改变时返回 true", () => {
    const draft = makeDraft({ providers: [makeProviderDraft({ name: "平台乙" })] });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("供应商 baseUrl 改变时返回 true", () => {
    const draft = makeDraft({ providers: [makeProviderDraft({ baseUrl: "https://api.other.com/v1" })] });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("供应商模型新增时返回 true", () => {
    const draft = makeDraft({
      providers: [
        makeProviderDraft({
          models: [...makeProviderDraft().models, { id: "m3", roles: ["reverse" as ModelRole] }],
        }),
      ],
    });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("供应商模型减少时返回 true", () => {
    const draft = makeDraft({
      providers: [makeProviderDraft({ models: [makeProviderDraft().models[0]] })],
    });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("模型 roles 数组改变时返回 true", () => {
    const draft = makeDraft({
      providers: [makeProviderDraft({ models: [{ id: "m1", roles: ["image", "enhance"] }, makeProviderDraft().models[1]] })],
    });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("模型 source 改变（custom 与 undefined 互换）时返回 true", () => {
    const baseModels = makeProviderDraft().models;
    const withoutSource = makeDraft({
      providers: [makeProviderDraft({ models: [baseModels[0], { id: "m2", roles: ["enhance"] }] })],
    });
    expect(isSettingsDirty(withoutSource, makeSnapshot())).toBe(true);
    const withSource = makeDraft({
      providers: [makeProviderDraft({ models: [{ id: "m1", roles: ["image"], source: "custom" }, baseModels[1]] })],
    });
    expect(isSettingsDirty(withSource, makeSnapshot())).toBe(true);
  });

  it("模型 missing 翻转（true 与 undefined 互换）时返回 true", () => {
    const baseModels = makeProviderDraft().models;
    const draft = makeDraft({
      providers: [makeProviderDraft({ models: [{ id: "m1", roles: ["image"], missing: true }, baseModels[1]] })],
    });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("模型 seen 翻转（true 与 undefined 互换）时返回 true", () => {
    const baseModels = makeProviderDraft().models;
    const draft = makeDraft({
      providers: [makeProviderDraft({ models: [{ id: "m1", roles: ["image"], seen: true }, baseModels[1]] })],
    });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("模型顺序交换时返回 true（顺序敏感）", () => {
    const baseModels = makeProviderDraft().models;
    const draft = makeDraft({
      providers: [makeProviderDraft({ models: [baseModels[1], baseModels[0]] })],
    });
    expect(isSettingsDirty(draft, makeSnapshot())).toBe(true);
  });

  it("modelsUpdatedAt 与 undefined 互换时返回 true", () => {
    const draftMissing = makeDraft({ providers: [makeProviderDraft({ modelsUpdatedAt: undefined })] });
    expect(isSettingsDirty(draftMissing, makeSnapshot())).toBe(true);
    const snapshotMissing = makeSnapshot({
      providers: [makeProviderSummary({ modelsUpdatedAt: undefined })],
    });
    expect(isSettingsDirty(makeDraft(), snapshotMissing)).toBe(true);
  });

  it("供应商顺序交换时返回 false（顺序不敏感）", () => {
    const draft = makeDraft({
      providers: [makeProviderDraft({ id: "p2", name: "平台乙" }), makeProviderDraft()],
    });
    const snapshot = makeSnapshot({
      providers: [makeProviderSummary(), makeProviderSummary({ id: "p2", name: "平台乙" })],
    });
    expect(isSettingsDirty(draft, snapshot)).toBe(false);
  });

  it("快照 hasKey 被完全忽略（true/false 均判 false）", () => {
    expect(isSettingsDirty(makeDraft(), makeSnapshot({ providers: [makeProviderSummary({ hasKey: false })] }))).toBe(
      false,
    );
    expect(isSettingsDirty(makeDraft(), makeSnapshot({ providers: [makeProviderSummary({ hasKey: true })] }))).toBe(
      false,
    );
  });

  it("供应商 api 不同时返回 true", () => {
    const draft = makeDraft({ providers: [makeProviderDraft({ api: "hunyuan-image" })] });
    const snapshot = makeSnapshot({ providers: [makeProviderSummary({ api: "openai" })] });
    expect(isSettingsDirty(draft, snapshot)).toBe(true);
  });

  it("草稿 api 缺省与快照 openai 归一化后视为相同", () => {
    const draft = makeDraft({ providers: [makeProviderDraft({ api: undefined })] });
    const snapshot = makeSnapshot({ providers: [makeProviderSummary({ api: "openai" })] });
    expect(isSettingsDirty(draft, snapshot)).toBe(false);
  });

  it("草稿 hunyuan-image 与快照 api 缺省视为不同", () => {
    const draft = makeDraft({ providers: [makeProviderDraft({ api: "hunyuan-image" })] });
    const snapshot = makeSnapshot({ providers: [makeProviderSummary({ api: undefined })] });
    expect(isSettingsDirty(draft, snapshot)).toBe(true);
  });
});
