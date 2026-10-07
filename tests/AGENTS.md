# tests — 纯逻辑单元测试

## OVERVIEW
项目唯一测试层：44 个 `*.test.ts` / 520 个 it（扁平结构），Vitest 4.x 纯 Node 环境，无 DOM。

## COVERAGE BOUNDARY
可测（仅纯逻辑，文件名 kebab-case 与模块一一对应）：
- `electron/`：queue-store、gallery-store、png-metadata、image-recipe、generation-error（同测于 `recipe-error.test`）、reverse-prompt、local-ai-model-manager、fs-utils、data-url、constants、model-config、providers（`provider-presets` / `providers-hunyuan` / `providers-zhipu` / `providers-volcengine` / `providers-dashscope` / `providers-siliconflow` / `providers-xai` / `providers-openrouter`）、i18n（`main-i18n.test`）
- `src/lib/`：creative、local-ai、outpaint、tutorial、format、media、settings-dirty、provider-preset、role-options、progress、queue、gallery-focus、layout、layout-store、layout-history、splash、i18n、error-display、gallery、template-labels
- `model-config.test`（51 it）覆盖多供应商配置纯逻辑：`/models` 三变体解析/去重/排序/500 截断、刷新合并（保留标注/custom 不消失/seen 规则——仅「曾出现在刷新列表又消失」置 missing、从未出现者清除历史误报、新 id 追加 `seen:true`）、legacy 迁移合成（含同 id 合并去重）、保存载荷校验（含 `api` 枚举）、`resolveRoleBinding`/`resolveJobBinding` 三分支（含 fail-closed）、`configured` 四条件、`runSavePlan` 成功与中途失败、`stripProviderSecrets` 密钥剥离
- `settings-dirty.test`（27 it）锁定设置草稿 vs 快照脏检测（含 `api` 字段判脏、`seen` 判脏、undefined 归一）；`provider-presets` / `providers-hunyuan`（7 / 8 it）锁定 `electron/providers/` 预设表（12 条：国内组 7 + 国际组 5，分组排列不交叉）、注册表与混元适配器纯逻辑（注入 fake fetcher）；六家新平台适配器测试 `providers-{zhipu,volcengine,dashscope,siliconflow,xai,openrouter}`（共 66 it，注入 fake fetcher）锁定请求 URL/头/body 形状、成功解析、非 2xx 与 200+error、张数与 size 哨兵零请求、协议专属行为（硅基字段改名与 `images[]` 响应、xAI 端点切换与 size 推导、OpenRouter 仅 `b64_json`）；`provider-preset`（9 it）锁定 `src/lib/provider-preset.ts` 草稿映射、深拷贝与 keyHelp 本地化（含 *-intl 映射链路）；`role-options`（13 it）锁定角色下拉选项（顺序/已删除供应商 ⚠ 置顶注入）、模型选项（未标注过滤与 ⚠ 注入、供应商缺失）、`firstAnnotatedModel` 三态、`buildQuickSwitchPayload`（剥离 `hasKey`、`removedProviderIds` 恒空、序列化不含 `hasKey`/`apiKey`）；`progress`（11 it）锁定统一进度纯逻辑：`normalizeLegacyProgress`（scope/id/状态映射、100→done、无 message/progress）、`mapLocalAIProgress`（单阶段即局部值、多阶段等分、跨阶段单调不减、越界钳制）、`clampProgress`、`formatElapsed`（elapsedMs 优先、无起始返回 null、负差归零）；`format` 新增 `queueStatusLabel` 六状态中文映射与 `formatShortDate`（5 it）侧栏紧凑时间（今天=时:分、今年=月/日、更早=年/月/日、无效输入空串、ISO/时间戳入参）；`queue`（4 it）锁定展示排序（活跃 FIFO 置顶 + 历史倒序）、`waitingAheadCount`（按活跃 FIFO 位置计算，与渲染顺序解耦）与 `historyQueueCount`；`queue-store` 新增 `clear()` 用例（仅清非活跃、保留 queued/running）；`gallery-focus`（6 it）锁定跨页聚焦定位：页码按「目标所属项目自身列表」换算（非全局位置）、newest/oldest 双向排序、整除边界的向上取整、悬空 id → null、收件箱与其它项目归属；`layout`（56 it）锁定布局模型：9 模块表与通用/专属判定、双层快照写入层级（通用 → `shared`、专属 → `modes[mode]`；`clearPlacement` 不可变更新）、隐藏语义（通用三模式同步、专属按模式、去重与恢复）、**双单位坐标**（x/w=64 列 `LAYOUT_COLS`；y/h=16px 行 `GRID_PX`；`snapToGrid` 只做垂直行吸附；`minW`/`minH` 为 px 语义、换算列/行）、**垂直缩放下限**（`minResizeHeightPx`：实测未顶破撑开高度时下限只用 `minH`（回归「只能拉高不能拉矮」——实测值恒 ≥ 当前高度会成棘轮）、顶破时取实测并上取 16px 行、至少 1 行）、**尺寸档位**（`LAYOUT_SIZE_THRESHOLDS`/`sizeFlags`：widthPx≤0 不触发、未登记/空档位恒 false、compact/narrow 按阈值判定）、重叠判定（边界相接不算）、`findFreeSlot` 避让（无冲突直返 + 列范围 clamp + 超宽收缩 + 冲突找最近空位 + 被包围仍可放）、`resolveVerticalLayout` 纵向推挤（无重叠保持、纵向下推、横向并排不动、链式推挤、实测高度优先于快照 h）、`resolvePushLayout` 拖动推挤（moving 优先：落点覆盖下推 / 链式 / 落进悬挂模块中部 moving 下修 / 上方压制+链式 / 同 y 竞争者让位 / 横向相接不动 / 实测高度参与 / 降级不抛错 / 负 y 钳 0 / 多 placed 底边非单调必须迭代收敛）、`ensureModePlacements` 补位（空快照按模式补齐、已有坐标不动、通用写 `shared`）、分享码编解码（`ITL2:` 输出 `v:2` 往返、`ITL1:` 旧码按 `colWidth` 换算 y/h 并带 `legacy` 标志、缺 `colWidth` 拒绝、拒绝无前缀/坏 base64/坏 JSON/错误版本、忽略非法与非通用模块及越界数值、空码无效、只含通用池）、`applySharedLayout`（只替换通用池、清除码中缺失项）、`resolveAllConflicts`（专属为新通用让位、通用之间也消解）；`layout-store`（32 it）锁定 store v4 解析（v4 缺 default 补回）、v3 原样保留待迁移、空/坏 JSON/未知版本 → empty、序列化幂等；v3→v4 迁移（x/w 取整为列、y/h 按 `colWidth`/`GRID_PX` 换算、`minW`/`minH` 下限、隐藏集合过滤、全预设一次转换、`colWidth` 非法 fail-fast）；`layout-history`（9 it）锁定撤销/重做栈（push 上限 50、undo/redo 往返、新 push 清空 future、空栈返回 null、不可变）
- i18n 测试（v3.12）：`i18n.test.ts`（25 it）锁定运行时 zh 直通/en 查表、插值（缺失参数保留占位符）、复数分段 `one|other`、缺词回退、`tCode` zh fallback + en code 查表、词典分片聚合完整性（`Object.keys(en).length === Σ 分片条目数`，防跨分片重复 key 静默覆盖）；`error-display.test.ts`（8 it）锁定 `renderErrorInfo` 三层 + `statusErrorInfo` 中断派生 + en 缺词回退存储文本；`ipc-code.test.ts`（3 it）锁定 26 个 `ipc.*` 词条存在性（硬编码 IpcCode 列表）；`main-i18n.test.ts`（8 it）锁定主进程 `mt()` 词典/插值/缺 key 回退；`i18n-lib-messages.test.ts`（3 it）锁定 lib/hooks 迁移文案（zh 逐字 + en 命中 + 插值/后缀剥离）；`template-labels.test.ts`（6 it）锁定内置模板按稳定 id 本地化、非内置/未知 id 回退存储值
- `splash.test.ts`（7 it）锁定启动页退场判定 `shouldDismissSplash`：就绪未到最短（1799→false）/ 达到最短（1800→true）、未就绪等待至上限（5999→false）、6s 上限强制退场（含未就绪）、reduced-motion 最短归零（就绪即退、未就绪未到上限仍等）、上限优先于一切
- 跨层一致性测试（同时导入 electron 纯模块与 `src/lib` 同名常量/行为）：`constants.test`（默认模型 / inbox）、`outpaint-limits.test`（画布常量）、`local-ai-limits.test`（本地 AI 上限）、`data-url.test`（去前缀正则，含 `image/svg+xml` 与大写 MIME 用例）
- 源码文本一致性测试：`preload-channels.test`（导入 `../electron/channels` 并读取 `../electron/preload.ts` 源码，双向锁定 75 个通道字符串；因沙箱化 preload 无法 `import` 本地模块，用源码文本守卫替代运行时单源化）

绝不测：
- UI 组件（`src/components`、`src/main.tsx`）
- `electron/main.ts`（IPC / 窗口 / 生命周期）；`electron/preload.ts` 无运行时测试，但由 `tests/preload-channels.test.ts` 做源码文本一致性检查（preload↔channels 75 通道双向锁定）
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
