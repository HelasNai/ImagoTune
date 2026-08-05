import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { GenerationErrorInfo } from "./generation-error";

export type BinaryPayload = { name: string; type: string; data: number[] };
export type QueueStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type QueueJob = { id: string; requestId: string; kind: "generate" | "edit"; status: QueueStatus; createdAt: string; updatedAt: string; attempts: number; input: Record<string, unknown>; attachments?: { image?: StoredAttachment; mask?: StoredAttachment }; error?: string; errorInfo?: GenerationErrorInfo; elapsedMs?: number; resultGalleryIds?: string[] };
type StoredAttachment = { name: string; type: string; path: string };

const timestamp = () => new Date().toISOString();
export function createQueueStore(baseDir: string) {
  const queuePath = path.join(baseDir, "pinaic-image-queue.json"); const assetsDir = path.join(baseDir, "pinaic-image-queue-assets");
  async function write(items: QueueJob[]) { await fs.mkdir(baseDir, { recursive: true }); const compact = items.slice(0, 100); await fs.writeFile(queuePath, JSON.stringify(compact, null, 2), "utf8"); }
  async function read(recoverRunning = false) {
    try { const raw = await fs.readFile(queuePath, "utf8"); const parsed = JSON.parse(raw) as unknown; const items = Array.isArray(parsed) ? parsed as QueueJob[] : []; const normalized = recoverRunning ? items.map(item => item.status === "running" ? { ...item, status: "interrupted" as const, error: "应用关闭时任务正在运行，请手动重试。", errorInfo: { category: "cancelled" as const, title: "任务已中断", message: "应用关闭时任务仍在运行。", suggestion: "确认参数后手动重试，软件不会自动重复计费。", retryable: true }, updatedAt: timestamp() } : item) : items; if (recoverRunning && JSON.stringify(normalized) !== JSON.stringify(items)) await write(normalized); return normalized; } catch { return [] as QueueJob[]; }
  }
  async function save(item: QueueJob) { const items = await read(); const next = [...items.filter(value => value.id !== item.id), item]; await write(next); return item; }
  async function enqueue(kind: "generate" | "edit", rawInput: Record<string, unknown>) {
    const id = randomUUID(); const now = timestamp(); const { image, mask, ...input } = rawInput as Record<string, unknown> & { image?: BinaryPayload; mask?: BinaryPayload }; const attachments: QueueJob["attachments"] = {}; await fs.mkdir(assetsDir, { recursive: true });
    for (const [key, value] of [["image", image], ["mask", mask]] as const) { if (!value) continue; const filePath = path.join(assetsDir, `${id}-${key}.bin`); await fs.writeFile(filePath, Buffer.from(value.data)); attachments[key] = { name: value.name, type: value.type, path: filePath }; }
    const item: QueueJob = { id, requestId: String(input.requestId || randomUUID()), kind, status: "queued", createdAt: now, updatedAt: now, attempts: 0, input, attachments }; await save(item); return item;
  }
  async function materialize(item: QueueJob) {
    const input: Record<string, unknown> = { ...item.input, requestId: item.requestId }; for (const key of ["image", "mask"] as const) { const attachment = item.attachments?.[key]; if (attachment) input[key] = { name: attachment.name, type: attachment.type, data: Array.from(await fs.readFile(attachment.path)) }; } return input;
  }
  async function removeAssets(item: QueueJob) { for (const attachment of Object.values(item.attachments || {})) { if (attachment) await fs.rm(attachment.path, { force: true }); } }
  async function remove(id: string) { const items = await read(); const item = items.find(value => value.id === id); if (item) await removeAssets(item); await write(items.filter(value => value.id !== id)); }
  async function recover() { return read(true); }
  return { queuePath, read, write, save, enqueue, materialize, remove, removeAssets, recover };
}
export type QueueStore = ReturnType<typeof createQueueStore>;
