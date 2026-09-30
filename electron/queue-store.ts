import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { interruptedErrorInfo } from "./generation-error";
import { atomicWriteJson, ensureDir, nowISO, readJsonWithLegacy } from "./fs-utils";

import type { BinaryPayload, QueueJob, QueueStatus } from "../shared/types";

export type { BinaryPayload, QueueJob, QueueStatus };

const ACTIVE_STATUSES = new Set<QueueStatus>(["queued", "running"]);

export function compactQueue(items: QueueJob[], historyLimit = 100) {
  const active = items.filter((item) => ACTIVE_STATUSES.has(item.status));
  const history = items.filter((item) => !ACTIVE_STATUSES.has(item.status));
  return [...active, ...history.slice(-Math.max(0, historyLimit - active.length))];
}

export function createQueueStore(baseDir: string) {
  const queuePath = path.join(baseDir, "image-studio-queue.json");
  const legacyQueuePath = path.join(baseDir, "pinaic-image-queue.json");
  const assetsDir = path.join(baseDir, "image-studio-queue-assets");
  async function write(items: QueueJob[]) {
    await atomicWriteJson(queuePath, compactQueue(items));
  }
  async function read(recoverRunning = false) {
    try {
      const items = (await readJsonWithLegacy(queuePath, legacyQueuePath)) as QueueJob[];
      const normalized = recoverRunning ? items.map(item => item.status === "running" ? { ...item, status: "interrupted" as const, error: "应用关闭时任务正在运行，请手动重试。", errorInfo: interruptedErrorInfo(), updatedAt: nowISO() } : item) : items;
      if (recoverRunning && !isDeepStrictEqual(normalized, items)) await write(normalized);
      return normalized;
    } catch { return [] as QueueJob[]; }
  }
  async function save(item: QueueJob) { const items = await read(); const next = [...items.filter(value => value.id !== item.id), item]; await write(next); return item; }
  async function enqueue(kind: "generate" | "edit", rawInput: Record<string, unknown>, snapshot?: { providerId: string; model: string }) {
    const existing = await read();
    if (existing.filter((item) => ACTIVE_STATUSES.has(item.status)).length >= 100) {
      throw new Error("待执行任务已达到 100 条，请先处理或移除旧任务。");
    }
    const id = randomUUID(); const now = nowISO(); const { image, mask, ...input } = rawInput as Record<string, unknown> & { image?: BinaryPayload; mask?: BinaryPayload }; const attachments: QueueJob["attachments"] = {}; await ensureDir(assetsDir);
    for (const [key, value] of [["image", image], ["mask", mask]] as const) { if (!value) continue; const filePath = path.join(assetsDir, `${id}-${key}.bin`); await fs.writeFile(filePath, Buffer.from(value.data)); attachments[key] = { name: value.name, type: value.type, path: filePath }; }
    const item: QueueJob = { id, requestId: String(input.requestId || randomUUID()), kind, status: "queued", createdAt: now, updatedAt: now, attempts: 0, input, attachments }; if (snapshot) { item.providerId = snapshot.providerId; item.model = snapshot.model; } await save(item); return item;
  }
  async function materialize(item: QueueJob) {
    const input: Record<string, unknown> = { ...item.input, requestId: item.requestId }; for (const key of ["image", "mask"] as const) { const attachment = item.attachments?.[key]; if (attachment) input[key] = { name: attachment.name, type: attachment.type, data: Array.from(await fs.readFile(attachment.path)) }; } return input;
  }
  async function removeAssets(item: QueueJob) { for (const attachment of Object.values(item.attachments || {})) { if (attachment) await fs.rm(attachment.path, { force: true }); } }
  async function remove(id: string) { const items = await read(); const item = items.find(value => value.id === id); if (item) await removeAssets(item); await write(items.filter(value => value.id !== id)); }
  // 一键清空历史：仅移除「非活跃」任务（completed/failed/cancelled/interrupted）并回收其附件；
  // queued/running 一律保留——正在排队或花钱的任务绝不能被批量删除。返回清除条数。
  async function clear() {
    const items = await read();
    const kept = items.filter((item) => ACTIVE_STATUSES.has(item.status));
    const removed = items.filter((item) => !ACTIVE_STATUSES.has(item.status));
    for (const item of removed) await removeAssets(item);
    await write(kept);
    return removed.length;
  }
  async function recover() { return read(true); }
  return { queuePath, read, write, save, enqueue, materialize, remove, removeAssets, clear, recover };
}
export type QueueStore = ReturnType<typeof createQueueStore>;
