# tests — 纯逻辑单元测试

## OVERVIEW
项目唯一测试层：24 个 `*.test.ts` / 215 个 it（扁平结构），Vitest 4.x 纯 Node 环境，无 DOM。

## COVERAGE BOUNDARY
可测（仅纯逻辑，文件名 kebab-case 与模块一一对应）：
- `electron/`：queue-store、gallery-store、png-metadata、image-recipe、generation-error（同测于 `recipe-error.test`）、reverse-prompt、local-ai-model-manager、fs-utils、data-url、constants、model-config、providers（`provider-presets` / `providers-hunyuan`）
- `src/lib/`：creative、local-ai、outpaint、tutorial、format、media、settings-dirty、provider-preset、role-options
- `model-config.test`（50 it）覆盖多供应商配置纯逻辑：`/models` 三变体解析/去重/排序/500 截断、刷新合并（保留标注/custom 不消失/missing 标记）、legacy 迁移合成（含同 id 合并去重）、保存载荷校验（含 `api` 枚举）、`resolveRoleBinding`/`resolveJobBinding` 三分支（含 fail-closed）、`configured` 四条件、`runSavePlan` 成功与中途失败、`stripProviderSecrets` 密钥剥离
- `settings-dirty.test`（26 it）锁定设置草稿 vs 快照脏检测（含 `api` 字段判脏、undefined 归一）；`provider-presets` / `providers-hunyuan`（5 / 8 it）锁定 `electron/providers/` 预设表、注册表与混元适配器纯逻辑（注入 fake fetcher）；`provider-preset`（5 it）锁定 `src/lib/provider-preset.ts` 草稿映射与深拷贝；`role-options`（13 it）锁定角色下拉选项（顺序/已删除供应商 ⚠ 置顶注入）、模型选项（未标注过滤与 ⚠ 注入、供应商缺失）、`firstAnnotatedModel` 三态、`buildQuickSwitchPayload`（剥离 `hasKey`、`removedProviderIds` 恒空、序列化不含 `hasKey`/`apiKey`）
- 跨层一致性测试（同时导入 electron 纯模块与 `src/lib` 同名常量/行为）：`constants.test`（默认模型 / inbox）、`outpaint-limits.test`（画布常量）、`local-ai-limits.test`（本地 AI 上限）、`data-url.test`（去前缀正则，含 `image/svg+xml` 与大写 MIME 用例）
- 源码文本一致性测试：`preload-channels.test`（导入 `../electron/channels` 并读取 `../electron/preload.ts` 源码，双向锁定 71 个通道字符串；因沙箱化 preload 无法 `import` 本地模块，用源码文本守卫替代运行时单源化）

绝不测：
- UI 组件（`src/components`、`src/main.tsx`）
- `electron/main.ts`（IPC / 窗口 / 生命周期）；`electron/preload.ts` 无运行时测试，但由 `tests/preload-channels.test.ts` 做源码文本一致性检查（preload↔channels 71 通道双向锁定）
- `src/workers/`（WebGPU 推理）

## CONVENTIONS
- 显式 `import { describe, expect, it } from "vitest"`，禁全局变量
- `describe` 用英文短语，`it` 用中文行为描述
- 文件系统测试：`mkdtemp(path.join(os.tmpdir(), "image-studio-*"))` + `try/finally` 或模块级 `afterEach` 清理
- 网络测试：本地 `http.createServer` 于 `127.0.0.1:0`，10s 超时
- fixture 内联在测试文件内（如 1px PNG base64）
- 相对导入，跨目录写 `../electron/x` 或 `../src/lib/x`

## COMMAND
```bash
npm test    # vitest run
```
本目录不在 tsconfig 中，不参与 `npm run typecheck`。无 vitest.config，vite.config 无 `test` 块，纯默认配置。

## ADDING A TEST
新逻辑若可测试，应落在 `electron/`（stores / 元数据 / 模型管理 / 无副作用纯模块）或 `src/lib/`（纯函数）。新模块 → 同目录加 `*.test.ts`，遵循上方 conventions。UI / 主进程 / worker 逻辑不写运行时测试；`electron/preload.ts` 无运行时测试，仅可写源码文本一致性检查（如 `preload-channels.test` 对 preload↔channels 通道的双向锁定）。声称与两端共享的常量/正则，须由跨层一致性测试锁定（同时 import `../electron/*` 与 `../src/lib/*`）。主进程纯模块如 `model-config`（配置解析/合并/校验/写序编排）与 `providers/presets`（预设表/注册表）、`providers/hunyuan-image`（注入 fake fetcher）应直接 import `../electron/...` 单测，勿依赖 IPC、keytar 或真实网络。
