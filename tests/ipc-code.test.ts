import { afterEach, describe, expect, it } from "vitest";
import type { IpcCode } from "../shared/types";
import { setLocale, tCode } from "../src/lib/i18n";
import { gallery } from "../src/lib/i18n/en/gallery";
import { queue } from "../src/lib/i18n/en/queue";
import { composer } from "../src/lib/i18n/en/composer";
import { localai } from "../src/lib/i18n/en/localai";
import { shell } from "../src/lib/i18n/en/shell";

// 主进程 IpcCode 全量清单：必须与 shared/types.d.ts 的 IpcCode 联合及 main.ts 的改动保持同步。
// 类型注解 `IpcCode[]` 在 vitest/esbuild 下被擦除，仅起文档/IDE 提示作用；真正的锁是下面的词条存在性断言。
const IPC_CODES: IpcCode[] = [
  "gallery.notFound",
  "gallery.thumbnailFailed",
  "gallery.loadFailed",
  "gallery.openFailed",
  "gallery.nothingSelected",
  "gallery.projectNameRequired",
  "gallery.projectNotEditable",
  "gallery.inboxNotDeletable",
  "gallery.projectNotFound",
  "gallery.coverMismatch",
  "queue.noBinding",
  "queue.enqueueFailed",
  "queue.notRetryable",
  "queue.notCancellable",
  "queue.runningNotRemovable",
  "queue.clearFailed",
  "template.empty",
  "template.builtinNotDeletable",
  "localai.notInstalled",
  "localai.downloadFailed",
  "localai.deleteFailed",
  "localai.emptyResult",
  "localai.archiveFailed",
  "clipboard.copyImageFailed",
  "clipboard.noImage",
  "clipboard.readImageFailed",
];

// 按前缀域直接 import 分片（不依赖聚合，锁定各自的 ipc.<code> 归属）。
const shards: Record<string, string> = { ...gallery, ...queue, ...composer, ...localai, ...shell };

afterEach(() => {
  setLocale("zh");
});

describe("IpcCode en 覆盖（T24）", () => {
  it("每个 IpcCode 都有非空的 `ipc.<code>` en 词条", () => {
    for (const code of IPC_CODES) {
      const key = `ipc.${code}`;
      const value = shards[key];
      expect(typeof value, `缺少 en 词条：${key}`).toBe("string");
      expect(value.trim().length, `en 词条为空：${key}`).toBeGreaterThan(0);
    }
  });

  it("清单无重复 code", () => {
    expect(new Set(IPC_CODES).size).toBe(IPC_CODES.length);
  });

  it("en 下 tCode 命中英文，zh 下回退主进程中文原文", () => {
    setLocale("en");
    expect(tCode("ipc", "gallery.notFound")).toBe("Gallery record not found");
    expect(tCode("ipc", "queue.notRetryable")).toBe("This task cannot be retried");
    expect(tCode("ipc", "template.empty")).toBe("Template title and prompt cannot be empty");
    expect(tCode("ipc", "localai.notInstalled")).toBe("The model is not installed yet");
    expect(tCode("ipc", "clipboard.readImageFailed")).toBe("Could not read the clipboard image");

    setLocale("zh");
    expect(tCode("ipc", "gallery.notFound", {}, "图库记录不存在")).toBe("图库记录不存在");
  });
});
