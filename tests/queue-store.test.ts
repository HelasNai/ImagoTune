import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQueueStore } from "../electron/queue-store";

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
});
