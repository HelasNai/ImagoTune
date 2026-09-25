# tests — 纯逻辑单元测试

## OVERVIEW
项目唯一测试层：10 个 `*.test.ts`（扁平结构），Vitest 4.x 纯 Node 环境，无 DOM。

## COVERAGE BOUNDARY
可测（仅纯逻辑，文件名 kebab-case 与模块一一对应）：
- `electron/`：queue-store、gallery-store、png-metadata、image-recipe、generation-error、reverse-prompt、local-ai-model-manager
- `src/lib/`：creative、local-ai、outpaint、tutorial

绝不测：
- UI 组件（`src/components`、`src/main.tsx`）
- `electron/main.ts`、`electron/preload.ts`（IPC / 窗口 / 生命周期）
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
新逻辑若可测试，应落在 `electron/`（stores / 元数据 / 模型管理）或 `src/lib/`（纯函数）。新模块 → 同目录加 `*.test.ts`，遵循上方 conventions。UI / 主进程 / preload / worker 逻辑不写测试。
