# 新增生图平台适配器开发指南

- **版本**: v1.0
- **日期**: 2026-09-28
- **范围**: `electron/providers/`（`types.ts` / `presets.ts` / `<platform>.ts`）、`shared/types.d.ts` 的 `ProviderApiStyle`、`electron/model-config.ts` 的 `validateSavePayload`、`electron/main.ts` 的 `callImages` / `resolveProvider` / `SETTINGS_TEST`、`src/lib/provider-preset.ts`、`src/components/SettingsPanel.tsx`、`tests/providers-<platform>.test.ts`
- **方法**: 源码阅读 + 逐符号核验（以实测行为为准）；参考落地案例：腾讯混元（`providers/hunyuan-image.ts`，提交 `ae05955..e7a8cb1`）

> 本指南描述的是**当前实现**。新增平台前请先读本文件与各 `AGENTS.md`；文中的符号名/文件路径会随重构漂移，请以代码为准。

---

## 一、什么时候需要一个新适配器

**多数 OpenAI 兼容平台不需要写任何代码。** 只要目标平台按标准 OpenAI 协议提供下列四个端点，用户直接在设置页「添加供应商 → 自定义」填名称 / Base URL / 密钥即可：

```text
GET  /models              → 测试连接（SETTINGS_TEST）
POST /images/generations  → 文生图（endpoint === "generations"）
POST /images/edits        → 图生图 / 扩图（endpoint === "edits"）
POST /chat/completions    → 提示词增强 / 图反推
```

即 `ProviderApiStyle` 缺省（`undefined`）等同 `"openai"`，`getAdapter(provider.api ?? "openai")` 返回 `undefined` 时，`callImages` 直接走既有 `fetch` + `parseResponse` 默认路径。

**只有协议不一致时才需要适配器。** 出现以下任一情况，标准路径无法覆盖：

| 差异类型 | 例子（腾讯混元，非标准） |
|---|---|
| 专用端点路径 | `/wand/hunyuan-image/v35-generation`，不是 `/images/generations` |
| 请求体协议不同 | 用 `messages`（`role` + `content` 数组，参考图映射为 `image_url`），不是 `{prompt, size, n}` |
| 响应体形状不同 | 图片地址在 `choices[0].delta.image.url`，不是 `data[].b64_json` / `url` |
| 单次张数受限 | 混元单次只出一张，`n > 1` 必须显式拒绝 |
| 尺寸语义受限 | 需在发请求前做哨兵校验，而不是交给服务端报错 |

适配器的价值：把「协议翻译 + 前置校验 + 错误归类」收敛到**一个纯逻辑文件**里，其余归档、转存、同源守卫等能力完全复用。

---

## 二、架构总览（当前实现）

### 2.1 数据流

```text
用户点「生成」
  → callImages(win, endpoint, input, binding?)
      ├─ resolveRole("image")            // 纯配置解析，零 keytar
      ├─ resolveProvider(providerId)     // 唯一凭据读取点，返回 { baseUrl, apiKey, api }
      ├─ getAdapter(provider.api ?? "openai")
      │     ├─ 命中 → adapter.generate(ctx, fetcher?)  → ApiImage[]
      │     └─ 未命中 → openai 默认路径 fetch + parseResponse → ApiImage[]
      ├─ prioritizeImageResponses(images, n)
      ├─ materializeImageResponse(image, baseUrl, apiKey, signal)   // URL→PNG 转存 + 同源 Bearer 守卫
      └─ archiveImages(...)              // 归档
```

关键：适配器**只负责产出 `ApiImage[]`**（`{ b64_json?, url?, seed? }`）。转存、同源守卫、PNG 化、归档都在适配器之外，适配器不得绕过 `materializeImageResponse` 自行下载图片。

### 2.2 文件 → 职责

| 文件 | 职责 |
|---|---|
| `electron/providers/types.ts` | `GenerateContext`（`baseUrl`/`apiKey`/`model`/`prompt`/`size?`/`n?`/`quality?`/`reference?`/`signal?`）与 `ProviderAdapter`（只强制 `generate`，`listModels?` 可选）。纯类型，无副作用 |
| `electron/providers/presets.ts` | `PROVIDER_PRESETS` 预设表 + 私有 `ADAPTERS` 注册表 + `getAdapter(api)` / `getPreset(id)`。未知 `api` 返回 `undefined` → openai 默认路径（零回归） |
| `electron/providers/<platform>.ts` | 一个平台一个适配器文件。纯逻辑：只 import `../generation-error`、`../net-utils` 与 type-only 导入；`fetcher` 可注入供单测 |
| `electron/main.ts` `callImages` | 分派点：`getAdapter(provider.api ?? "openai")`；命中走 `adapter.generate(ctx)`，产物并入同一 `prioritizeImageResponses → materializeImageResponse → 归档` 管线 |
| `electron/main.ts` `resolveProvider` | 返回 `{ baseUrl, apiKey, api }`，`api` 缺省归一为 `"openai"`（不写盘回填） |
| `electron/main.ts` `modelListPath(api)` | 「api → 清单端点」的单一映射点，当前恒返回 `/models` |
| `shared/types.d.ts` | `ProviderApiStyle`（`"openai" \| "hunyuan-image"`）、`ProviderConfig.api?`、`ProviderPreset`、`SettingsSnapshot.presets?` 唯一来源 |
| `electron/model-config.ts` `validateSavePayload` | 保存白名单校验，含 `api` 枚举（见 §3b） |
| `src/lib/provider-preset.ts` | `presetToProviderDraft`：预设 → 供应商草稿，深拷贝 `presetModels` |
| `src/components/SettingsPanel.tsx` | 「添加供应商」双态卡片：预设态（`Combobox` 选平台 + 只填密钥）/ 自定义态（原三字段）；预设数据来自 `settings:get` 快照 |

### 2.3 预设数据通路

```text
PROVIDER_PRESETS (electron/providers/presets.ts)
  → SETTINGS_GET 快照 (main.ts: presets: PROVIDER_PRESETS)
  → 渲染层 SettingsPanel 读 value.presets（不新增 IPC）
  → confirmAddPreset → presetToProviderDraft(preset, id, key)（深拷贝 presetModels）
  → 草稿进入 drafts → SETTINGS_SAVE
```

渲染层**不 import `electron/`**，预设数据只能经快照获得。

---

## 三、新增平台 Checklist（逐步）

### a. 定义协议（先做，别急着写代码）

写下这六项，否则代码没有锚点：

1. **端点**：完整路径与拼接规则（`joinBase(baseUrl, ENDPOINT)`）。
2. **请求体**：字段名、必填/可选、参考图如何编码。
3. **响应体**：图片地址/数据的确切 JSON 路径。
4. **错误形态**：非 2xx 的 body；**是否存在 HTTP 200 + error 体**（混元实测有，见 §5）。
5. **尺寸**：允许的宽高范围、面积上限、是否接受畸形串。
6. **张数**：单张还是多张；多张平台限制必须在**发请求前**拒绝。

### b. `ProviderApiStyle` 加新成员（仅当协议非 openai）

两处必须**同时**改，否则保存会被 `{ ok:false, error:"供应商接口风格无效" }` 拒绝：

1. `shared/types.d.ts` 的 `ProviderApiStyle`：加字符串成员，例如 `"acme-image"`。
2. `electron/model-config.ts` 的 `validateSavePayload`：把新值加进 `api` 白名单（当前允许 `undefined` / `"openai"` / `"hunyuan-image"`）。

若 `tests/model-config.test.ts` 有 `api` 枚举断言，一并同步。

### c. 新建适配器文件 `electron/providers/<platform>.ts`

实现 `ProviderAdapter`。骨架（占位平台名 `acme-image`，签名与 `types.ts` 完全一致）：

```ts
import type { ApiImage } from "../../shared/types";
import { GenerationError, classifyHttpError } from "../generation-error";
import { joinBase } from "../net-utils";
import type { GenerateContext, ProviderAdapter } from "./types";

const ENDPOINT = "/wand/acme-image/v1-generation";

/** 平台自己的尺寸哨兵：越界/畸形一律抛 parameters，绝不静默缩放或透传。 */
function assertSize(size: string): void {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) throw parameterError("该平台不支持所选尺寸。", size);
  // ...按平台文档校验宽高与面积，否则 throw parameterError(...)
}

export const acmeImageAdapter: ProviderAdapter = {
  api: "acme-image",

  async generate(ctx: GenerateContext, fetcher: typeof fetch = fetch): Promise<ApiImage[]> {
    // 1. 前置校验（在 fetcher 之前失败 = 零请求 = 防重复计费）
    const n = ctx.n ?? 1;
    if (n > 1) {
      throw new GenerationError({
        category: "parameters", title: "单张限制",
        message: "该平台单次生成一张图片。", suggestion: "请将张数调整为 1 后再提交。", retryable: false,
      });
    }
    if (ctx.size !== undefined) assertSize(ctx.size);

    // 2. 请求体构造（平台协议；只需映射 ctx 提供的字段）
    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
      ...(ctx.size !== undefined ? { size: ctx.size } : {}),
    };

    // 3. 发送（请求按 joinBase(ctx.baseUrl, ENDPOINT) 同源发出，Authorization 只发到该 baseUrl；
    //    返回图片 URL 的下载同源守卫在 main 的 materializeImageResponse，密钥不会外泄到第三方 CDN）
    const response = await fetcher(joinBase(ctx.baseUrl, ENDPOINT), {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    const text = await response.text();

    // 4. 非 2xx → 统一错误分类
    if (!response.ok) throw new GenerationError(classifyHttpError(response.status, text));

    // 5. 成功路径：HTTP 200 也可能是错误体（见 §5），必须先解析
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new GenerationError({
        category: "unknown", title: "生成请求失败", message: "接口返回了无法解析的响应。",
        suggestion: "查看详情并检查当前参数后再提交。", retryable: false, details: text.slice(0, 800),
      });
    }
    if (payload && typeof payload === "object" && (payload as { error?: unknown }).error) {
      // 200 错误体先在本适配器内做文案判定：命中「接口/模型不存在」→ 归类 endpoint；
      // 否则回落通用分类（通用 endpoint 分支只认 400/404，200 场景会落 unknown）。
      // MISSING_INTERFACE_PATTERN（hunyuan-image.ts:39）与 endpointError（:41）照抄自混元。
      if (MISSING_INTERFACE_PATTERN.test(text)) {
        throw endpointError(text.replace(/\s+/g, " ").trim().slice(0, 800));
      }
      throw new GenerationError(classifyHttpError(200, text));
    }

    // 6. 解析平台响应中的图片地址，返回 ApiImage[]
    //    混元用 extractImageUrl(payload) 读 choices[0].delta.image.url；替换为你的平台响应路径。
    const url = extractImageUrl(payload);
    if (!url) {
      throw new GenerationError({
        category: "unknown", title: "生成请求失败", message: "接口未返回图片地址。",
        suggestion: "查看详情并检查当前参数后再提交。", retryable: false, details: text.slice(0, 800),
      });
    }
    return [{ url }];
  },
};
```

要点：

- `fetcher: typeof fetch = fetch` 注入模式：单测传 fake fetcher，生产走全局 `fetch`。
- 只返回 `ApiImage[]`；不要自己下载 URL、不要转 PNG。
- 参考图（`ctx.reference`，dataURL 数组）按平台协议映射；混元把它映射进 `messages[].content` 的 `image_url`。
- 不实现 `listModels` 也可用：`SETTINGS_TEST` 统一走平台级 `/models`。
- 骨架里的助手 `parameterError` / `unknownError` / `endpointError` / `MISSING_INTERFACE_PATTERN` / `extractImageUrl` 未在此展开：完整定义见 `electron/providers/hunyuan-image.ts`，按你的平台文案照抄。

### d. `electron/providers/presets.ts` 注册

```ts
import { acmeImageAdapter } from "./acme-image";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ...既有混元条目
  {
    id: "acme",
    label: "平台显示名",
    baseUrl: "https://api.acme.example/v1",
    api: "acme-image",
    presetModels: [{ id: "acme-image-v1", roles: ["image"] }],
    keyHelp: "在平台控制台 → API Key 创建",
  },
];

const ADAPTERS: ProviderAdapter[] = [hunyuanImageAdapter, acmeImageAdapter];
```

混元实际值可作对照：`{ id:"hunyuan", label:"腾讯混元", baseUrl:"https://tokenhub.tencentmaas.com/v1", api:"hunyuan-image", presetModels:[{id:"hy-image-v3.5-preview",roles:["image"]}], keyHelp:"在腾讯云控制台 → TokenHub → API Key 创建" }`。

### e. 单测 `tests/providers-<platform>.test.ts`

用注入的 fake fetcher 断言（参照 `tests/providers-hunyuan.test.ts` 的 `makeFetcher` / `makeCtx` / `headerValue` / `bodyOf` 助手）：

- 请求 URL 精确（含 baseUrl 尾斜杠两种情况）、方法 `POST`、`Authorization`、`Content-Type`。
- 请求体形状（字段名、参考图映射、`size` 缺省时不带该键）。
- 成功解析 → `ApiImage[]`。
- 非 2xx（如 400）→ `GenerationError` 且 `info.status` 正确。
- **200 + error 体** → `GenerationError`，且实测形态归 `endpoint`、其余归 `unknown`（绝不当作成功）。
- `n > 1` → `parameters`，且 fake fetcher **零调用**。
- 尺寸哨兵：越界/畸形（`abc`/`0x0`）拒绝且零请求；合法尺寸逐字透传。

### f. 文档同步

更新根 / `electron` / `src` / `tests` 四份 `AGENTS.md` 的模块表、契约与测试计数（本仓规则：修改即同步）。

### g. 验证

```powershell
npm.cmd run typecheck   # 双 tsconfig
npm.cmd test            # vitest
npm.cmd run build       # tsc + vite + tsc(electron)
npm.cmd run dev         # 冒烟：添加预设 → 绑定生图 → 出一张 → 归档
```

---

## 四、必须遵守的契约与红线

| # | 契约 | 证据/边界 |
|---|---|---|
| K1 | 预设与自定义共用同一 `ProviderConfig`，仅多一个可选 `api`；**不加** `mode`/`kind` 判别字段 | 预设态添加出的供应商就是普通 `ProviderConfig`（name=label、models 由 presetModels 深拷贝、api 有值）；`ProviderPreset` 本身是独立接口（含 label/presetModels/keyHelp），**非** `extends ProviderConfig` |
| K2 | `listModels?` 可选；未知 `api` → `getAdapter` 返回 `undefined` → openai 默认路径（零回归） | `presets.ts` `getAdapter`；`tests/provider-presets.test.ts` |
| K3 | 分派只在 `callImages`：`getAdapter(provider.api ?? "openai")` | `main.ts` `callImages` |
| K4 | 尺寸是哨兵校验：越界/畸形一律拒绝，**绝不**静默缩放或透传 | 混元 `assertSize`（[256,8192]、面积 ≤ 16777216） |
| K5 | 协议翻译（请求体/响应体）由适配器承担，产物统一为 `ApiImage[]` | `hunyuan-image.ts` 的 `messages` 协议 |
| K6 | 单张限制在发请求**之前**显式拒绝；**绝不**自动重试或循环多张 | 混元 `n > 1` 抛 `parameters`；全仓无自动重试 |
| K7 | 预设模型必须**深拷贝**进草稿（`presetModels` 是模块级常量） | `presetToProviderDraft`；`tests/provider-preset.test.ts` |
| K8 | 渲染层禁止硬编码预设数据 / 禁止 import `electron/`；预设只经 `settings:get` 快照到达 | `SettingsPanel` 读 `value.presets` |

硬红线：

- **禁止自动重试 / 循环多张**（防重复计费）。多张平台限制必须在请求前拒绝。
- **Bearer 密钥只发 baseUrl 同源**：转存下载的 Origin 守卫在 `materializeImageResponse`（`target.origin === new URL(baseUrl).origin` 才附 `Authorization`）；适配器不得绕过它自行下载图片。
- **适配器必须纯逻辑**：可被 vitest 直接导入，无 `electron/` / Node 副作用，`fetcher` 可注入。
- 密钥只经 keytar，配置 JSON **永不含 `apiKey`**；适配器只接收 `ctx.apiKey` 字符串，不读配置、不碰 keytar。

---

## 五、实战踩坑（来自腾讯混元落地）

1. **HTTP 200 也可能是错误体**。混元实测返回 `200 + ResourceUnavailable.InterfaceNotExist`（接口不存在）。适配器必须在 success path 主动检测 body 的 `error` 字段；且通用 `classifyHttpError` 的 `endpoint` 分支只认 `400/404`，200 场景会落 `unknown`，因此需在适配器内先做文案判定（见 `MISSING_INTERFACE_PATTERN`：`/(does not exist|not exist|notexists?\b|not found|不存在)/i`）再回落通用分类。
2. **尺寸哨兵**。宽高 ∈ `[256, 8192]`、面积 ≤ `16777216`、畸形字符串（`abc`/`0x0`/负数）一律抛 `parameters`，**绝不静默缩放**；合法尺寸逐字透传。
3. **预设模型必须深拷贝**。`presetModels` 是模块级常量，UI 编辑（角色标注/刷新合并）会反向污染预设表；`presetToProviderDraft` 复制 `models` 与 `roles` 两层。
4. **`presets.ts` 静态 import 适配器 → 注册表与适配器无法拆成两个 typecheck 绿的提交**（`ADAPTERS` 引用适配器，缺文件即编译失败），合并提交。
5. **错误分类顺序**。通用分类器里 `content` / `balance` 的状态无关正则（`contentPattern` / `balancePattern`）可能先手吞并；`endpoint` 分支（`400/404 + 不存在文案`）必须排在 `400/422 → parameters` 兜底**之前**。已知「content/balance 正则先手」为低风险，改动顺序需回归 `generation-error` 单测。
6. **`SETTINGS_TEST` 目前所有平台统一用平台级 `GET /models`**；`modelListPath(api)` 是「api → 路径」的单一映射点，`listModels?` 是可选实现的前瞻设计（混元刻意不实现，因其 `/v1/models` 实测可用）。

---

## 六、验收清单（模板）

新增平台 PR 逐项勾选：

**代码**
- [ ] `ProviderApiStyle` 加成员，且 `validateSavePayload` 白名单同步（否则保存报「供应商接口风格无效」）
- [ ] 适配器文件实现 `ProviderAdapter`，`fetcher` 可注入，纯逻辑无副作用
- [ ] `PROVIDER_PRESETS` 加条目 + `ADAPTERS` 注册
- [ ] 前置校验（单张/尺寸）在 `fetch` 之前，失败路径零请求

**测试**
- [ ] `tests/providers-<platform>.test.ts` 覆盖 URL/方法/头/body/成功/非 2xx/200+error/多张零调用/尺寸哨兵
- [ ] `npm.cmd test` 全绿

**文档**
- [ ] 根 / `electron` / `src` / `tests` 四份 `AGENTS.md` 同步（模块表、契约、测试计数）

**门禁**
- [ ] `npm.cmd run typecheck` 通过
- [ ] `npm.cmd run build` 通过

**冒烟**
- [ ] `npm.cmd run dev` → 添加预设 → 绑定生图 → 出一张 → 自动归档成功
- [ ] 测试连接、刷新模型符合预期（或明确说明平台不支持 `/models`）

---

## 七、参考文件索引

| 文件/符号 | 一行的职责 |
|---|---|
| `electron/providers/types.ts` | `GenerateContext` / `ProviderAdapter` 接口，适配器契约唯一来源 |
| `electron/providers/presets.ts` | `PROVIDER_PRESETS` + `ADAPTERS` + `getAdapter`/`getPreset` |
| `electron/providers/hunyuan-image.ts` | 混元适配器范本（专用端点 + messages 协议 + 尺寸哨兵 + 200 错误体） |
| `shared/types.d.ts` | `ProviderApiStyle` / `ProviderConfig` / `ProviderPreset` / `SettingsSnapshot.presets?` / `ApiImage` |
| `electron/model-config.ts` `validateSavePayload` | 保存白名单（含 `api` 枚举） |
| `electron/main.ts` `callImages` | 分派 + 转存 + 归档管线 |
| `electron/main.ts` `resolveProvider` / `modelListPath` | 凭据解析 / 清单端点映射 |
| `electron/main.ts` `SETTINGS_GET` / `SETTINGS_TEST` | 快照下发（含 presets）/ 连接与模型清单测试 |
| `electron/generation-error.ts` `classifyHttpError` | 非 2xx 错误分类（`endpoint` 分支只认 400/404） |
| `electron/net-utils.ts` `joinBase` | 端点拼接 |
| `src/lib/provider-preset.ts` | 预设 → 草稿（深拷贝 presetModels） |
| `src/components/SettingsPanel.tsx` | 添加供应商双态卡片 + 模型角色标注 + 三角色分配 |
| `tests/providers-hunyuan.test.ts` | 适配器单测范本（注入 fake fetcher） |
| `tests/provider-presets.test.ts` | 预设表 + 注册表单测 |
| `tests/provider-preset.test.ts` | 草稿映射与深拷贝单测 |
