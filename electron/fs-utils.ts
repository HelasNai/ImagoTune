import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const RETRYABLE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** 统一的时间戳来源（gallery-store / queue-store / main.ts 共用）。 */
export function nowISO(): string {
  return new Date().toISOString();
}

/** 递归确保目录存在。 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * 重试语义与两处 store 原实现逐字一致：最多 4 次尝试，
 * 仅对 EPERM/EACCES/EBUSY 退避 30*(attempt+1)ms，其余错误立即抛出。
 */
export async function replaceWithRetry(operation: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_CODES.has(code) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}

/** 原子写 JSON：临时文件 + rename，失败时清理临时文件后重抛。 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2), "utf8");
    await replaceWithRetry(() => fs.rename(temporaryPath, filePath));
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/** 读取 primary，读取失败时回退 legacy；解析后非数组返回空数组。 */
export async function readJsonWithLegacy(primary: string, legacy: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await fs.readFile(primary, "utf8");
  } catch {
    raw = await fs.readFile(legacy, "utf8");
  }
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}
