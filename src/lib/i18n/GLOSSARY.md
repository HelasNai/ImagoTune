# ImagoTune 中英术语表与写作规范

> 本文件是 i18n 任务的**写作契约**。所有 en 词典分片（`src/lib/i18n/en/*.ts`）、
> 面板迁移任务（T13、T18-T22 等）、主进程 code 词典都必须遵循此表与规范。
> 若发现表中术语与真实界面不一致，以**真实界面文案**为准并同步修订本表。

## 如何使用

先判断要翻译的是哪一类 key，再套用对应规范：

- **中文文案 key**（界面里看得见的中文，如按钮 `"保存"`、提示 `"已保存方案「{name}」"`）
  → 用 `t()`。zh 直通（原样显示中文），en 查分片词典。查表时先剥离 `|语境后缀`。
- **语义 code key**（主进程/持久化层产生的机器码，如 `"noKey"`、`"http"`、`"network"`）
  → 用 `tCode(prefix, code, params, fallback)`。en 查 `prefix.code`；zh 显示主进程原文
  `fallback`（调用方传入），绝不让裸 code 泄漏到中文界面。

小例子：

```ts
// ① 中文文案 key
t("保存");                 // zh → "保存"；en → "Save"
t("删除|标题");            // zh → "删除"；en 查 key "删除|标题" → "Delete"
t("已选择 {n} 张图片", { n: 2 }); // zh → "已选择 2 张图片"；en → "Selected 2 images"

// ② 语义 code key（fallback = 主进程中文原文）
tCode("test", "noKey", {}, "尚未配置 API 密钥");
// zh → "尚未配置 API 密钥"（fallback）；en → settings 分片里的 "test.noKey"
```

---

## 1. 术语对照表（zh → en）

> 来源为真实代码文案（`src/components/*`、`src/lib/*`、`README.md`、主进程）。
> 同一中文词在不同语境需要不同英文时，靠 `|语境后缀` 区分（见第 4 节）。
> 本表 ≥25 条；新增面板术语前先在此登记。

### 导航与模式

| 中文 | English | 说明 |
| --- | --- | --- |
| 创作 | Create | 生成模式；导航项 |
| 图库 | Gallery | 导航项；磁盘目录名不改（见第 6 节） |
| 任务队列 | Queue | 导航/侧栏入口；短标签用 Queue |
| 设置 | Settings | 导航项 |
| 本地 AI 工具箱 | Local AI toolbox | 导航项；短标签可作 Local AI |
| 新手教程 | Tutorial | 侧栏帮助入口 |

### 功能与模式

| 中文 | English | 说明 |
| --- | --- | --- |
| 扩图 | Outpaint | 模式名；「智能扩图」= Smart outpaint |
| 图反推 | Reverse prompt | 功能名；「图反推提示词」= Reverse prompt |
| 提示词增强 | Prompt enhance | 功能/角色名 |
| 生图 | Image generation | 角色名 |
| 文生图 | Text to image | 生成方式 |
| 图片编辑 | Image edit | 模式名 |
| 参考图生成 | Reference generation | 带参考图出图时的方法名 |
| 高清放大 | Upscale (HD) | 本地工具；简短处用 Upscale |
| 智能抠图 | Background removal | 本地工具 |
| 人脸优化 | Face restore | 本地工具；带 Beta 标记处写 Face restore Beta |
| 一键优化 | One-click enhance | 本地组合流程；表内 code 用 pipeline |
| 本地组合处理 | Local pipeline | 流水线名 |

### 配置与模型

| 中文 | English | 说明 |
| --- | --- | --- |
| 供应商 | Provider | 可能含多个平台 |
| 模型 | Model | |
| 模型角色配置 | Model roles | 标注哪些模型可承担哪个角色 |
| 模型分配 | Model assignment | 为三角色选择供应商与模型 |
| API Base URL | API Base URL | 专有名词保留 |
| API 密钥 | API key | |
| 测试连接 | Test connection | 动词短语式按钮 |
| 刷新模型 | Refresh models | |
| 自定义模型 | Custom model | |

### 创作表单

| 中文 | English | 说明 |
| --- | --- | --- |
| 提示词 | Prompt | 正向 |
| 负面提示词 | Negative prompt | |
| 参考图 / 参考图片 | Reference image | 复数按 n 分段 |
| 蒙版 | Mask | |
| 种子 | Seed | |
| 清晰度 | Quality | 分辨率档位（1K/2K/4K） |
| 画面比例 | Aspect ratio | |
| 尺寸 | Size | 自定义尺寸等 |
| 数量 | Quantity | 出图张数；简短处可作 Count |
| 生成速度 | Generation speed | |
| 扩图画布 | Outpaint canvas | |
| 归属项目 | Project | 归档目标项目 |
| 标签 | Tags | 用户数据，值本身不译（见第 6 节） |

### 队列状态与操作

| 中文 | English | 说明 |
| --- | --- | --- |
| 排队中 | Queued | 状态 |
| 运行中 | Running | 状态 |
| 已完成 | Completed | 状态 |
| 失败 | Failed | 状态 |
| 已取消 | Cancelled | 状态 |
| 已中断 | Interrupted | 状态 |
| 重试 | Retry | 按钮 |
| 移除 | Remove | 按钮 |
| 取消 | Cancel | 按钮 |
| 清空历史 | Clear history | 按钮；`queue.clear()` 的展示文案 |
| 尝试 | Attempt | 如「尝试 3 次」= Attempts: 3 |
| 用时 | Elapsed | 如「用时 2.3 秒」= Elapsed 2.3 s |
| 前面还有 {n} 个任务 | {n} job(s) ahead | 复数按 n 分段 |

### 图库

| 中文 | English | 说明 |
| --- | --- | --- |
| 收件箱 | Inbox | 固定项目；按 `id === "inbox"` 渲染 |
| 项目 | Project | |
| 收藏 | Favorite | 动词/名词同形；按钮用 Favorite |
| 全部图库 | All images | 筛选项 |
| 新建项目 | New project | |
| 重命名 | Rename | 按钮 |
| 导出 ZIP | Export ZIP | ZIP 为专有名词保留 |

### 本地 AI 选项

| 中文 | English | 说明 |
| --- | --- | --- |
| 放大倍率 | Scale | 2× / 4× |
| 边缘羽化 | Edge feather | 单位 px |
| 修复强度 | Restore strength | 百分比 |
| 处理全部人脸 | Process all faces | 勾选项 |

### 通用动作（按钮）

| 中文 | English | 说明 |
| --- | --- | --- |
| 保存 | Save | |
| 删除 | Delete | |
| 复制 | Copy | |
| 导入 | Import | |
| 导出 | Export | |
| 关闭 | Close | |
| 确认 | Confirm | |
| 刷新 | Refresh | |
| 继续 | Continue | |
| 替换 | Replace | |
| 追加 | Append | |
| 打开 | Open | |

---

## 2. 风格规范

- **按钮/动作标签用祈使动词原形**：`保存` → `Save`（不是 Saving / Saved）、
  `取消` → `Cancel`、`删除` → `Delete`、`重试` → `Retry`。
- **句子大小写（sentence case），不用 Title Case**：`Save as template`、
  `Clear history`、`Test connection`。除句首与专有名词外一律小写。
- **完整句子末尾加英文句点**：`All changes saved.`；**短语/标签/按钮不加句点**：
  `Save`、`Aspect ratio`、`Clear history`。
- **标点用英文半角**：逗号 `,`、句号 `.`、问号 `?`、冒号 `:`、括号 `()`；
  不使用全角 `，。？：（）`。
- **专有名词原样保留、不改写、不翻译**：
  `OpenAI` / `WebGPU` / `WASM` / `API` / `PNG` / `ZIP` / `JPG` / `SHA-256` / `Beta` /
  `ImagoTune` / `DM Sans` / `Noto Sans SC`。
- **数字与单位**：用半角数字，单位与数字间加空格（`8192 px`、`2.3 s`、`10 faces`）；
  乘号用 `×`（`2×`、`4×`）。
- **行尾无多余空格**；词典 value 一律 `trim`，不得以空格开头/结尾。

## 3. 复数规范

词典 value 支持 `one|other` 两段，用 `|` 分隔（UTF-8 竖线）：

- `n === 1` → 取**第一段**；`n !== 1` → 取**第二段**。
- **没有 `n` 参数**（或 `n` 非数字）→ 取**第一段**。
- key 中的 `{n}` 会在选定分段后再做插值。

示例：

```ts
// 中文 key: "已选择 {n} 张图片"
// en value:  "Selected {n} image|Selected {n} images"
t("已选择 {n} 张图片", { n: 1 }); // → Selected 1 image
t("已选择 {n} 张图片", { n: 3 }); // → Selected 3 images
```

```ts
// 中文 key: "前面还有 {n} 个任务"
// en value:  "{n} job ahead|{n} jobs ahead"
// 无 n：取第一段
```

注意：只有中文文案含数量变量时才用复数分段；`{n}` 为 0 时仍取 other 段（`0 images`）。

## 4. 语境后缀规范

同一个中文词可能在不同位置需要不同英文（如对话框标题 `删除` 与按钮 `删除`，
或「项目」在不同上下文）。为避免词典 key 冲突，重复中文词用 `|语境后缀` 消歧：

- 调用点写**完整带后缀的 key**：`t("删除|标题")`、`t("删除|按钮")`。
- **zh 直通时剥离后缀**：`"删除|标题"` → 显示 `删除`（后缀不进界面）。
- **en 词典以完整后缀 key 为键**：`en["删除|标题"] = "Delete"`。
- 后缀是**稳定机器标签**（如 `标题` / `按钮` / `项目`），不得含空格或标点；
  后缀只用中文，不翻译、不进界面。
- 同一中文词若只有一种译法，**不加后缀**；只有确实冲突时才加。

示例：

```ts
// 对话框标题
t("删除|标题");   // zh → "删除"；en → "Delete"
// 表格/卡片内的删除按钮
t("删除|按钮");   // zh → "删除"；en → "Delete"
```

## 5. 两类 key 规范

### ① 中文文案 key（`t()`）

用于**界面里直接可见的中文文案**：按钮、标题、标签、提示、placeholder、
aria-label、tooltip、对话框、空态等。

- key = 中文原文（可带 `|语境后缀`）。
- **zh**：直通显示（剥离后缀、做 `{param}` 插值），不查表。
- **en**：查 `src/lib/i18n/en/*.ts` 分片；命中后按复数规则选段、再做插值。
- 缺失 en 条目时回退显示中文原文（并应被 T33 的完整性检查捕获）。

适用：`src/components/*`、`src/main.tsx`、`src/lib/*` 的可见常量。

### ② 语义 code key（`tCode()`）

用于**主进程/持久化层产生的机器码**：错误分类、`settings:test` 结果、
IPC 错误、更新状态、本地 AI 动作 code。

- 签名：`tCode(prefix, code, params?, fallback?)`，
  `prefix ∈ { error, test, ipc, update, localai }`。
- **en**：查 `${prefix}.${code}`（如 `test.noKey`、`error.network`）。
- **zh**：显示调用方传入的 `fallback`（主进程原始中文文案）；**无 fallback 才回退
  裸 code 并 warn**。裸 code 绝不直接出现在中文界面。
- 调用方必须尽量提供 `fallback`（主进程原文），保证 zh 与历史记录一致。

示例：

```ts
// settings:test 结果（主进程返回 { code: "test.noKey", message: "尚未配置 API 密钥" }）
tCode("test", result.code, {}, result.message);
// zh → "尚未配置 API 密钥"（主进程中文原文）
// en → settings 分片 "test.noKey" 的英文
```

**选择依据**：文案本体在渲染层 → 用 `t()`；文案本体在主进程/持久化层、只传机器码
→ 用 `tCode()`。两者不可混用。

## 6. 不译清单（DO NOT TRANSLATE）

以下内容**永不进入 en 词典、永不翻译**，必须以原样透传/原样存储：

- **模型输入（模型侧文本）**：内置模板的 `prompt` / `promptSuffix`（本地提示词助手
  追加的「创作要求」等）、配方文本（recipe）、变体后缀（variation suffix）。
  翻译会改变发给模型的输入与出图结果。参见 `src/lib/creative.ts` 的 `promptSuffix`。
- **用户内容**：图片标题、项目名、标签、自定义模板内容（用户自填文本）。
- **模型名 / 许可证名等专有名词**：如 Real-ESRGAN、ISNet、GFPGAN、YuNet、
  BSD-3-Clause、MIT、Apache-2.0 等，原样保留。
- **`console.*` 内部日志**：仅开发者可见，不本地化。
- **磁盘目录名「图库」**：`path.join(saveDir, "图库")` 为路径契约，改名会破坏既有
  文件定位，保持中文 `图库` 不变（界面上的「图库」Gallery 照常翻译）。

> 生产 code（如 `"inbox"`、`"upscale"`、`"remove-background"`、`"face-restore"`、
> `"queued"` 等机器枚举）本身不译；只译其**面向用户的中文展示文案**。
