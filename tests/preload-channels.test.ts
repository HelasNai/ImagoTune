import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as channels from "../electron/channels";

// preload.ts 与 channels.ts 的通道字符串必须双向一致。
// preload 处于 Electron sandbox 环境，无法 require 本地模块，因此刻意内联字符串
// 而非 import channels.ts；本测试替代编译期单源化，运行时锁死两端不失联。
const preloadSrc = readFileSync(new URL("../electron/preload.ts", import.meta.url), "utf8");

const CHANNEL_LITERAL_RE = /"([A-Za-z][A-Za-z0-9-]*:[A-Za-z][A-Za-z0-9-]*)"/g;

/** 抽取 preload 源码里所有「命名空间:动作」形态的字符串字面量。 */
function extractInlinedChannels(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(CHANNEL_LITERAL_RE)) {
    found.add(match[1]);
  }
  return found;
}

/** channels.ts 导出的全部字符串常量值（通道名的唯一来源）。 */
function declaredChannels(): Set<string> {
  return new Set(
    Object.values(channels).filter((value): value is string => typeof value === "string")
  );
}

describe("preload channel inlining consistency", () => {
  it("channels.ts 导出 75 个通道值（对外契约总数）", () => {
    expect(declaredChannels().size).toBe(75);
  });

  it("preload.ts 内联字符串与 channels.ts 导出值双向完全一致（75===75）", () => {
    const declared = declaredChannels();
    const inlined = extractInlinedChannels(preloadSrc);
    const onlyInChannels = [...declared].filter((channel) => !inlined.has(channel));
    const onlyInPreload = [...inlined].filter((channel) => !declared.has(channel));
    expect(onlyInChannels, "仅 channels.ts 声明、preload.ts 缺失的通道").toEqual([]);
    expect(onlyInPreload, "仅 preload.ts 使用、channels.ts 未声明的通道").toEqual([]);
    // 显式锁定两侧基数，避免两端同时漏掉同一通道而静默通过。
    expect(inlined.size).toBe(75);
    expect(declared.size).toBe(75);
  });

  it("preload.ts 绝不 import ./channels（沙箱化 preload 无法 require 本地模块）", () => {
    // Electron sandbox 下 preload 无法 require 本地文件：一旦 import ./channels，
    // 编译产物 dist-electron/preload.js 会执行 require("./channels")，运行时抛
    // "Unable to load preload script / module not found" -> window.imageStudio 从未
    // 暴露 -> 渲染进程 "Cannot read properties of undefined" -> 窗口白屏。
    // 此文本守卫锁死内联方案，回归即失败。
    expect(preloadSrc).not.toMatch(/from\s+["']\.\/channels["']/);
  });

  it("preload.ts 依赖图自包含：除 electron 外不 import 任何模块", () => {
    const specifiers = [...preloadSrc.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (match) => match[1]
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, "沙箱化 preload 只能从 electron 导入").toBe("electron");
    }
  });
});
