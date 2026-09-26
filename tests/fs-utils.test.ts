import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, ensureDir, nowISO, readJsonWithLegacy, replaceWithRetry } from "../electron/fs-utils";
import { createGalleryStore } from "../electron/gallery-store";

const retryableError = (code: string) => Object.assign(new Error(`模拟 ${code} 失败`), { code });

describe("fs-utils helpers", () => {
  it("ensureDir 递归创建缺失的多级目录", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "image-studio-fs-ensure-"));
    try {
      const target = path.join(root, "a", "b", "c");
      await ensureDir(target);
      const stat = await import("node:fs/promises").then((fs) => fs.stat(target));
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("atomicWriteJson 通过临时文件重命名落盘且不留 .tmp 残留", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "image-studio-fs-atomic-"));
    try {
      const file = path.join(root, "nested", "index.json");
      const data = { version: 3, items: [1, 2] };
      await atomicWriteJson(file, data);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(data);
      const names = await readdir(path.dirname(file));
      expect(names).toEqual(["index.json"]);
      expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("atomicWriteJson 失败时清理临时文件并向上抛出错误", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "image-studio-fs-atomic-fail-"));
    try {
      // 目标指向已存在目录：rename 无法用文件覆盖目录，替换必然失败。
      const targetDir = path.join(root, "occupied");
      await mkdir(targetDir);
      await expect(atomicWriteJson(targetDir, { a: 1 })).rejects.toThrow();
      const names = await readdir(root);
      expect(names.some((name) => name.includes(".tmp"))).toBe(false);
      expect(names).toContain("occupied");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("readJsonWithLegacy 优先读取 primary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "image-studio-fs-primary-"));
    try {
      const primary = path.join(root, "primary.json");
      const legacy = path.join(root, "legacy.json");
      await writeFile(primary, JSON.stringify([{ id: "primary" }]), "utf8");
      await writeFile(legacy, JSON.stringify([{ id: "legacy" }]), "utf8");
      expect(await readJsonWithLegacy(primary, legacy)).toEqual([{ id: "primary" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("readJsonWithLegacy 在 primary 缺失时回退 legacy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "image-studio-fs-legacy-"));
    try {
      const primary = path.join(root, "primary.json");
      const legacy = path.join(root, "legacy.json");
      await writeFile(legacy, JSON.stringify([{ id: "legacy" }]), "utf8");
      expect(await readJsonWithLegacy(primary, legacy)).toEqual([{ id: "legacy" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("readJsonWithLegacy 解析结果非数组时返回空数组", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "image-studio-fs-nonarray-"));
    try {
      const primary = path.join(root, "primary.json");
      const legacy = path.join(root, "legacy.json");
      await writeFile(primary, JSON.stringify({ not: "an array" }), "utf8");
      expect(await readJsonWithLegacy(primary, legacy)).toEqual([]);
      await rm(primary, { force: true });
      await writeFile(legacy, JSON.stringify("still not an array"), "utf8");
      expect(await readJsonWithLegacy(primary, legacy)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replaceWithRetry 对可重试错误退避重试并在最终失败时抛出", async () => {
    let attempts = 0;
    const started = Date.now();
    await expect(replaceWithRetry(async () => {
      attempts += 1;
      throw retryableError("EPERM");
    })).rejects.toMatchObject({ code: "EPERM" });
    const elapsed = Date.now() - started;
    expect(attempts).toBe(4);
    // 退避为 30 + 60 + 90 = 180ms，取保守下界证明确实发生等待。
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it("replaceWithRetry 在可重试错误后成功则停止重试", async () => {
    let attempts = 0;
    await replaceWithRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw retryableError("EBUSY");
    });
    expect(attempts).toBe(3);
  });

  it("replaceWithRetry 对非可重试错误立即抛出（不重试）", async () => {
    let attempts = 0;
    await expect(replaceWithRetry(async () => {
      attempts += 1;
      throw retryableError("ENOENT");
    })).rejects.toMatchObject({ code: "ENOENT" });
    expect(attempts).toBe(1);
  });

  it("nowISO 返回可解析的 ISO 时间字符串", () => {
    const value = nowISO();
    expect(value).toBe(new Date(value).toISOString());
  });
});

describe("gallery-store persistence through fs-utils", () => {
  it("损坏的 index.json 被隔离为 index.corrupt-* 并重建有效索引", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "image-studio-gallery-corrupt-"));
    try {
      const indexPath = path.join(root, "index.json");
      await writeFile(indexPath, "{ not valid json", "utf8");
      const state = await createGalleryStore(root).read();
      expect(state.version).toBe(3);

      const names = await readdir(root);
      const corrupt = names.find((name) => name.startsWith("index.corrupt-") && name.endsWith(".json"));
      console.log(`[failure-proof] 隔离文件已生成: ${corrupt}`);
      expect(corrupt).toBeTruthy();

      const rebuilt = JSON.parse(await readFile(indexPath, "utf8")) as { version: number; items: unknown[]; projects: unknown[] };
      console.log(`[failure-proof] 重建索引 version=${rebuilt.version} projects=${rebuilt.projects.length} items=${rebuilt.items.length}`);
      expect(rebuilt.version).toBe(3);
      expect(Array.isArray(rebuilt.items)).toBe(true);
      expect(rebuilt.items).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
