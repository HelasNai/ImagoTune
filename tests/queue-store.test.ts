import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createQueueStore, compactQueue } from "../electron/queue-store";
import { renderErrorInfo } from "../src/lib/error-display";
import { setLocale } from "../src/lib/i18n";

// 渲染回退用例会切到 en，模块级 locale 单例需在每个用例后复位，避免污染其他断言。
afterEach(() => setLocale("zh"));

describe("persistent queue", () => {
  it("keeps enqueue order and marks running jobs interrupted on restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-queue-"));
    try {
      const store = createQueueStore(directory);
      const first = await store.enqueue("generate", { requestId: "one", prompt: "first" });
      const second = await store.enqueue("generate", { requestId: "two", prompt: "second" });
      expect((await store.read()).map((item) => item.id)).toEqual([first.id, second.id]);
      await store.save({ ...first, status: "running" });
      const recovered = await store.recover();
      expect(recovered.find((item) => item.id === first.id)?.status).toBe("interrupted");
      expect(JSON.parse(await readFile(store.queuePath, "utf8"))).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps active work and rejects an unsafe 101st waiting task", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-queue-limit-"));
    try {
      const store = createQueueStore(directory);
      const jobs = [];
      for (let index = 0; index < 100; index += 1) jobs.push(await store.enqueue("generate", { requestId: String(index), prompt: String(index) }));
      expect((await store.read()).length).toBe(100);
      await expect(store.enqueue("generate", { requestId: "101", prompt: "overflow" })).rejects.toThrow("100");
      expect(compactQueue((await store.read()).map((item) => ({ ...item, status: "completed" as const })))).toHaveLength(100);
      expect((await store.read()).some((item) => item.id === jobs[0].id)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads the legacy queue once and writes future state to the neutral filename", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-legacy-queue-"));
    try {
      const legacyJob = {
        id: "legacy-job",
        requestId: "legacy-request",
        kind: "generate" as const,
        status: "queued" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        attempts: 0,
        input: { prompt: "legacy" },
      };
      await writeFile(path.join(directory, "pinaic-image-queue.json"), JSON.stringify([legacyJob]), "utf8");
      const store = createQueueStore(directory);
      expect((await store.read()).map((item) => item.id)).toEqual(["legacy-job"]);
      await store.save({ ...legacyJob, status: "completed" });
      expect(JSON.parse(await readFile(store.queuePath, "utf8"))[0].status).toBe("completed");
      expect(path.basename(store.queuePath)).toBe("image-studio-queue.json");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("clears finished history but keeps queued and running jobs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-queue-clear-"));
    try {
      const store = createQueueStore(directory);
      const waiting = await store.enqueue("generate", { requestId: "waiting", prompt: "waiting" });
      const done = await store.enqueue("generate", { requestId: "done", prompt: "done" });
      const failed = await store.enqueue("generate", { requestId: "failed", prompt: "failed" });
      await store.save({ ...done, status: "completed" });
      await store.save({ ...failed, status: "failed" });
      expect(await store.clear()).toBe(2);
      expect((await store.read()).map((item) => item.id)).toEqual([waiting.id]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("恢复运行中任务为 interrupted 时写入带 code 的 errorInfo，并保留 error 文本", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-queue-interrupt-"));
    try {
      const store = createQueueStore(directory);
      const job = await store.enqueue("generate", { requestId: "interrupt", prompt: "interrupt" });
      await store.save({ ...job, status: "running" });
      const recovered = await store.recover();
      const interrupted = recovered.find((item) => item.id === job.id);
      expect(interrupted?.status).toBe("interrupted");
      // 新中断记录：errorInfo 必带 cancel.interrupt（渲染层据此本地化）
      expect(interrupted?.errorInfo?.code).toBe("cancel.interrupt");
      expect(interrupted?.errorInfo?.category).toBe("cancelled");
      // 兼容：error 文本字段仍保留，非空字符串
      expect(typeof interrupted?.error).toBe("string");
      expect((interrupted?.error ?? "").length).toBeGreaterThan(0);
      // 落盘副本同样带 code（新中断记录持久化即含码）
      const persisted = (JSON.parse(await readFile(store.queuePath, "utf8")) as Array<{ id: string; errorInfo?: { code?: string } }>).find((item) => item.id === job.id);
      expect(persisted?.errorInfo?.code).toBe("cancel.interrupt");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("不迁移历史记录：无 code 的旧记录原样加载，双语渲染均回退存储文本", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-queue-legacy-code-"));
    try {
      const legacyJob = {
        id: "legacy-failed",
        requestId: "legacy-failed-request",
        kind: "generate" as const,
        status: "failed" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        attempts: 1,
        input: { prompt: "legacy" },
        error: "生成请求失败：接口返回了未识别的错误。",
        errorInfo: {
          category: "unknown" as const,
          title: "生成请求失败",
          message: "接口返回了未识别的错误。",
          suggestion: "检查接口详情和当前参数后再提交。",
          retryable: false,
        },
      };
      await writeFile(path.join(directory, "image-studio-queue.json"), JSON.stringify([legacyJob]), "utf8");
      const store = createQueueStore(directory);
      const loaded = await store.read();
      expect(loaded).toHaveLength(1);
      // 冻结：读取不增删字段，无 code 仍无 code、error 文本原样，且不重写历史文件
      expect(loaded[0].errorInfo?.code).toBeUndefined();
      expect(loaded[0].error).toBe(legacyJob.error);
      expect(JSON.parse(await readFile(store.queuePath, "utf8"))).toEqual([legacyJob]);
      // 渲染回退：无 code 记录在 zh 与 en 下都显示存储中文（不查表、不崩）
      const expected = { title: legacyJob.errorInfo.title, message: legacyJob.errorInfo.message, suggestion: legacyJob.errorInfo.suggestion };
      expect(renderErrorInfo(loaded[0].errorInfo!)).toEqual(expected);
      setLocale("en");
      expect(renderErrorInfo(loaded[0].errorInfo!)).toEqual(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
