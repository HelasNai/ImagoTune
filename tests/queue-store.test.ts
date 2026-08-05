import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQueueStore, compactQueue } from "../electron/queue-store";

describe("persistent queue", () => {
  it("keeps enqueue order and marks running jobs interrupted on restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pinaic-queue-"));
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
    const directory = await mkdtemp(path.join(os.tmpdir(), "pinaic-queue-limit-"));
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
});
