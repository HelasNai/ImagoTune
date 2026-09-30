# 本地 AI 推理 GPU 后端可行性评估（核显 / 独显 / 原生后端）

- **版本**: v1.0
- **日期**: 2026-09-28
- **范围**: 本地 AI 工具箱推理后端（`src/workers/local-ai.worker.ts`、`src/components/LocalAIToolbox.tsx`、`electron/main.ts` 的 `local-ai*` 部分、打包配置）
- **方法**: Chromium / Electron / Dawn / ONNX Runtime 源码与官方文档核查 + npm 包内容实测 + 本仓架构盘点（并行后台调研）
- **状态**: 评估完成，**未实施**（决定：先记录，暂不改动）

> 本报告为**可行性评估/复盘**性质，未修改任何代码。外部结论均附来源链接，本仓结论附文件与行号，便于未来决策时追溯。

---

## 一、问题背景

本地 AI 工具箱（高清放大 / 智能抠图 / 人脸优化）当前在渲染层 Worker 中用 `onnxruntime-web` 的 WebGPU EP 推理（`src/workers/local-ai.worker.ts:2,44`）。

在 Windows 上，Chromium/Electron 的 WebGPU 有两条硬限制：

1. **忽略 `powerPreference`**：Chrome 始终复用 Chromium GPU 进程已占用的那一个适配器；笔电上通常是核显（省电考虑）。自 Chrome 132 起 DevTools 会打印 "powerPreference is currently ignored on Windows" 警告（crbug 369219127）。
2. **不支持同时使用多个 GPU 适配器**（chromium:329211593）：WebGPU 应用只能看到那一个 DXGI/ANGLE 适配器。

结果：双显卡笔电上推理落在核显，无法只靠 `powerPreference` 切到独显；可控手段只有"整机 GPU 进程切独显"（`force_high_performance_gpu` 或 Windows 图形设置）。

来源：
- https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- https://issues.chromium.org/issues/369219127
- https://issues.chromium.org/issues/329211593
- https://github.com/huggingface/transformers.js/pull/1199（ORT 维护者确认 Windows 上该选项几乎无差别）

## 二、评估目标

"界面渲染留在核显，只让模型推理跑在独显"——即让推理后端**绕开 Chromium 的适配器选择限制**。

## 三、关键结论：Windows 上不能用 CUDA，应改走 DirectML

原假设"`onnxruntime-node` + CUDA EP"在 Windows 上不成立。三份独立证据：

1. **官方支持表**：`onnxruntime-node` 在 Windows x64 支持 CPU / DirectML / WebGPU(实验)，**CUDA 仅 Linux x64**。
2. **安装清单**：`js/node/script/install-metadata.js` 的 `requirements['win32/x64'] = []`（CUDA 清单仅存在于 `linux/x64`），postinstall 在 Windows 上不下载任何 GPU provider。
3. **npm 包实测**：win32/x64 目录只有 `onnxruntime.dll` / `DirectML.dll` / `dxcompiler.dll` / `dxil.dll` / binding，**无任何 CUDA provider DLL**。

CUDA-on-Windows 的剩余路径均不推荐：源码自建 `--use_cuda`（需完整 CUDA/cuDNN + 构建环境），或 2023 年停更的社区包 `onnxruntime-node-gpu@1.14.0`。

来源：
- https://github.com/microsoft/onnxruntime/blob/main/js/node/README.md
- https://github.com/microsoft/onnxruntime/blob/f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7/js/node/script/install-metadata.js#L11-L13
- https://github.com/microsoft/onnxruntime/pull/16050

## 四、推荐路径：onnxruntime-node + DirectML EP（跑在 utilityProcess）

Node 绑定会把 `deviceId` 透传给 DirectML，可按适配器下标选卡：

```cpp
// js/node/src/session_options_helper.cc（v1.30.0）
} else if (name == "dml") {
  Ort::ThrowOnError(OrtSessionOptionsAppendExecutionProvider_DML(sessionOptions, deviceId));
}
```

```js
const session = await ort.InferenceSession.create(modelPath, {
  executionProviders: [{ name: 'dml', deviceId: 1 }, 'cpu'],
  graphOptimizationLevel: 'all',
});
```

- **绕开 Chromium**：DirectML 经 D3D12/DXGI 自行枚举适配器，不受 WebGPU 单适配器限制。
- **厂商无关**：NVIDIA / AMD / Intel 同一条路径（对本次 NVIDIA 目标同样有效）。
- **官方同架构先例**：Microsoft 的 Electron 指南正是"onnxruntime-node 跑在 **utilityProcess** + `[{name:'dml',deviceId:0},'cpu']`"，并明确"session 创建与推理都是阻塞调用，必须放 utilityProcess"。
- **性能量级参考**（ResNet152 batch1）：TensorRT 5.80ms / **DirectML 7.80ms** / CUDA 9.05ms / CPU 36.9ms；另有 WebGPU 比 CUDA 慢 6–14× 的讨论（小模型 per-op 派发开销）。对 Real-ESRGAN/ISNet/GFPGAN 的原生 DML vs WebGPU 直接倍率**尚属 UNKNOWN，必须实测**。
- **算子覆盖**：三类模型的算子集均在 DirectML 覆盖内；注意 DirectML opset 上限 20，且不支持 Gridsample-5d 与 DeformConv。存在**静默 CPU 回退**风险（个别算子会落回 CPU 且无显著告警），需用日志或 `disable_cpu_ep_fallback` 校验。

来源：
- https://github.com/microsoft/onnxruntime/blob/f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7/js/node/src/session_options_helper.cc#L63-L64
- https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html
- https://github.com/microsoft/WinAppCli/blob/8158d14f8940e1a23d972e729e1dcce84de423ef/docs/guides/electron/js-winml.md
- https://nietras.com/2021/01/25/onnxruntime/
- https://github.com/microsoft/onnxruntime/discussions/20177

## 五、必须自研的两点（风险源头）

1. **DXGI 适配器枚举 → deviceId 映射**：`deviceId` 是 `IDXGIFactory::EnumAdapters` 的顺序，**笔记本插电/电池会改变 0/1 映射**，且 Node 绑定**不提供枚举 API**。要稳定选独显，需自写小型原生助手（或 N-API 模块）枚举适配器并按厂商/名称定位，运行时动态解析下标。
2. **无 GPU 时不自动回退**：`AppendExecutionProvider_DML` 失败会直接 reject，**ORT 不会自动退 CPU**。必须 `try/catch` 后显式退到 `['cpu']`，否则部分用户机器会直接报错。

来源：
- https://github.com/microsoft/DirectML/issues/535
- https://github.com/microsoft/onnxruntime/issues/13276

## 六、改造面清单（本仓架构盘点）

| # | 变更 | 主要文件 | 规模 | 关键风险 |
|---|---|---|---|---|
| M1 | Worker 推理协议整体替换（299 行 worker + 渲染层镜像类型） | `src/workers/local-ai.worker.ts`、`src/components/LocalAIToolbox.tsx:25-35,204-268` | L | 协议语义漂移；`PostProcessingStep.device` 联合类型（当前 `"webgpu"\|"wasm"`）需扩展 |
| M2 | 引入 `onnxruntime-node` + 原生模块打包 | `package.json:24-29,36,45-49,90-94`、`tools/*` | M | `build.files` 白名单必须显式加入；打包器不能内联 `.node`；须裁剪到 win32/x64 |
| M3 | 模型交付从 `local-ai-model://` 改为文件路径 | `electron/main.ts:55,899-906,1069-1072` | M | 现有协议可能变死代码 |
| M4 | 像素数据跨进程（原零拷贝 transfer 消失） | `LocalAIToolbox.tsx:71-95,235,250,259` | **L** | 最坏 8192² RGBA ≈ **280 MB** 需跨进程/落盘临时文件 |
| M5 | 进度改走 `progress:update` 推送 | `electron/main.ts:633-636`、`ProgressContext.tsx` | M | 每分块/每脸发进度 → 跨 IPC 高频推送风暴 |
| M6 | 取消语义（协作式 Set → IPC + abort 标志） | `worker.ts:22,31-33,294-298`、`main.ts:62-64,1138` | M | **单次 1024 分割 / YuNet 检测期间无法取消**（原生 `session.run` 不可中断） |
| M7 | 会话缓存 + 设备回退（WebGPU→WASM 三层 → DML→CPU） | `worker.ts:21,38-57,123-133`、`shared/types.d.ts:77` | M | `capabilities.webgpu`（`main.ts:1059`）语义需重定义 |
| M8 | 主进程阻塞 → **utilityProcess** | `electron/main.ts`（进程模型）、新增进程入口 | **L** | 新进程生命周期/崩溃恢复 + 打包入口 |
| M9 | 共享类型与桥声明更新（通道四处同步，基数 72） | `shared/types.d.ts`、`src/global.d.ts`、`electron/preload.ts`、`electron/channels.ts` | S | 遗漏同步 → 通道失联/白屏 |
| M10 | 归档路径（当前最大跨 IPC payload 为 PNG dataURL） | `electron/main.ts:1082-1090`、`gallery-store.ts:170-205` | S | 可选顺带优化为落盘 |
| M11 | 测试与打包校验 | `tests/*.test.ts`、`tools/verify-package.cjs` | M | worker / 原生推理无运行时测试（现状如此） |
| M12 | 渲染层能力门与文案（"WebGPU 优先" chip） | `LocalAIToolbox.tsx:342,347`、`main.ts:1059` | S | 文案与实际后端不一致会误导 |

**迁移后仍有效**：`tests/local-ai.test.ts`（tile/mask/affine 纯算法）、`tests/local-ai-limits.test.ts`、`tests/local-ai-model-manager.test.ts`、`tests/progress.test.ts`、`tests/data-url.test.ts`。

## 七、成本与收益

**成本**

| 项 | 数据 |
|---|---|
| 安装包增量（win32/x64 解包） | 约 **+64 MiB**（onnxruntime.dll 28.75 + DirectML.dll 18.53 + dxcompiler.dll 17.99 + dxil.dll 1.51 + binding 0.3 MB）；当前安装包 112 MB → 预估约 175 MB |
| 平台裁剪 | npm 包为单一大包（113.5 MB，含 6 平台，无平台子包），打包后须裁剪到 win32/x64 |
| ABI / 重建 | `onnxruntime-node@1.30` 为 Node-API v6，ABI 稳定；Electron 44（Chromium 152 / Node 24.18）可直接加载，**`npmRebuild:false` 无需改** |
| 打包坑 | 打包器不能内联 `.node`（`No loader for ".node"`）；建议显式 `asarUnpack: ["**/node_modules/onnxruntime-node/**"]`；`dxcompiler/dxil` 理论可裁但有风险、非官方支持 |

**收益（三档对照）**

| 档位 | 推理后端 | 性能 | 功耗/散热 | 改动成本 |
|---|---|---|---|---|
| 现状 | WebGPU on 核显 | 最慢 | 低 | 0 |
| 整机切独显 | WebGPU on 独显 | 中 | 界面也上独显 | **1 行开关 / OS 设置** |
| 原生 DML（本评估） | DirectML on 独显 | 预期最好（无浏览器 per-op 派发开销） | 界面留核显 | 架构级改造 M1–M12 |

## 八、决策与后续

**决策（2026-09-28）**：评估通过先记录，**暂不实施**。

**若未来启动，建议先做 POC（2–3 天，不动现有架构）**：

1. 安装 `onnxruntime-node@1.30`，写独立 utilityProcess 脚本，用 `[{ name: 'dml', deviceId: N }, 'cpu']` 跑一次 Real-ESRGAN。
2. 验收 A：通过适配器枚举将推理 pin 到独显，任务管理器独显 Compute 引擎出现负载。
3. 验收 B：实测三组耗时——现状 WebGPU on 核显 / WebGPU on 独显（临时加 `force_high_performance_gpu`）/ 原生 DML。
4. 仅当验收 B 显示原生增量显著，才值得进入 M1–M12 正式迁移。

**备选（若目标仅为本次性能，而非"界面留核显"）**：`app.commandLine.appendSwitch("force_high_performance_gpu")`（须在 `app.whenReady()` 前）整机切独显；Chromium ≥145 在 Windows 上确认生效（Electron 44 ≈ Chromium 152）；单显卡机器无影响，代价是界面也走独显（功耗略增）。注意开关为**下划线形式**，且 Dawn 自 2026-04 起在不传 `powerPreference` 时尊重 OS 的适配器顺序。

来源：
- https://github.com/electron/electron/blob/main/docs/api/command-line-switches.md
- https://github.com/MicrosoftEdge/WebView2Feedback/issues/5072
- https://dawn.googlesource.com/dawn/+/da528f525fa90b223dcbcb16be3250c3ccb14016

## 附录：参考来源汇总

**WebGPU / Chromium 限制**
- Chrome WebGPU Troubleshooting（Windows 限制）：https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- crbug 369219127（powerPreference 被忽略）：https://issues.chromium.org/issues/369219127
- chromium:329211593（不支持多适配器）：https://issues.chromium.org/issues/329211593
- `gpu.cc` 警告：https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/webgpu/gpu.cc
- Chrome 132 发布说明：https://developer.chrome.com/blog/new-in-webgpu-132
- gpuweb#2107（Windows 只暴露 ANGLE 适配器）：https://github.com/gpuweb/gpuweb/issues/2107
- WebLLM#609（WebGPU 落实核显实证）：https://github.com/mlc-ai/web-llm/issues/609

**onnxruntime-node / DirectML**
- Node README 支持表：https://github.com/microsoft/onnxruntime/blob/main/js/node/README.md
- install-metadata.js（win32/x64 无 CUDA）：https://github.com/microsoft/onnxruntime/blob/f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7/js/node/script/install-metadata.js#L11-L13
- session_options_helper.cc（deviceId / dml / cuda）：https://github.com/microsoft/onnxruntime/blob/f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7/js/node/src/session_options_helper.cc
- DirectML EP 文档（device_id 语义、opset 20）：https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html
- CUDA EP 文档（版本要求）：https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html
- WebGPU EP 文档（Node 未暴露选卡）：https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html
- PR #16050（Windows 分发 CPU+DML）：https://github.com/microsoft/onnxruntime/pull/16050
- DirectML#535（deviceId 下标漂移）：https://github.com/microsoft/DirectML/issues/535
- ORT#13276（DML 不回退 CPU）：https://github.com/microsoft/onnxruntime/issues/13276
- ORT#25980（No loader for ".node"）：https://github.com/microsoft/onnxruntime/issues/25980
- microsoft/WinAppCli Electron 指南（utilityProcess + dml）：https://github.com/microsoft/WinAppCli/blob/8158d14f8940e1a23d972e729e1dcce84de423ef/docs/guides/electron/js-winml.md
- xopc 平台裁剪先例：https://github.com/xopcai/xopc/blob/e3eb518a/scripts/prepare-electron-pack-dir.mjs
- electron-builder 原生模块自动解包：https://github.com/electron-userland/electron-builder/pull/8392
