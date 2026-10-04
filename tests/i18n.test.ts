import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, interpolate, setLocale, subscribe, t, tCode } from "../src/lib/i18n";
import { en } from "../src/lib/i18n/en";
import { core } from "../src/lib/i18n/en/core";
import { settings } from "../src/lib/i18n/en/settings";
import { gallery } from "../src/lib/i18n/en/gallery";
import { composer } from "../src/lib/i18n/en/composer";
import { localai } from "../src/lib/i18n/en/localai";
import { queue } from "../src/lib/i18n/en/queue";
import { tutorial } from "../src/lib/i18n/en/tutorial";
import { shell } from "../src/lib/i18n/en/shell";
import { errors } from "../src/lib/i18n/en/errors";

// 模块级单例在测试间共享：每个用例结束复位为默认中文，避免相互污染。
afterEach(() => {
  setLocale("zh");
  vi.restoreAllMocks();
});

describe("i18n locale 单例", () => {
  it("默认 locale 为 zh（保证现有中文断言测试免改）", () => {
    expect(getLocale()).toBe("zh");
  });

  it("setLocale 切换并通知订阅者，subscribe 返回取消订阅函数", () => {
    const seen: string[] = [];
    const unsubscribe = subscribe((locale) => seen.push(locale));
    setLocale("en");
    setLocale("zh");
    unsubscribe();
    setLocale("en");
    expect(seen).toEqual(["en", "zh"]);
  });

  it("setLocale 幂等：相同值不通知订阅者", () => {
    const seen: string[] = [];
    const unsubscribe = subscribe((locale) => seen.push(locale));
    setLocale("zh"); // 与当前相同
    setLocale("en");
    setLocale("en"); // 再次相同
    unsubscribe();
    expect(seen).toEqual(["en"]);
  });
});

describe("t() 中文直通", () => {
  it("zh 下直通中文文案 key", () => {
    expect(t("取消")).toBe("取消");
  });

  it("zh 下剥离 |语境后缀", () => {
    expect(t("删除|标题")).toBe("删除");
  });

  it("zh 下先做后缀剥离再做 {param} 插值", () => {
    expect(t("已选择 {n} 张", { n: 3 })).toBe("已选择 3 张");
  });
});

describe("t() 英文查表", () => {
  it("en 下按 key 查表返回英文", () => {
    setLocale("en");
    expect(t("取消")).toBe("Cancel");
    expect(t("删除|标题")).toBe("Delete");
  });

  it("en 下插值 {param}", () => {
    setLocale("en");
    expect(t("已选择 {n} 张", { n: 1 })).toBe("1 image selected");
  });

  it("en 缺失 key 时回退为剥离后缀的中文 key 并 console.warn，绝不抛错", () => {
    setLocale("en");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 经 tCode 走动态 key 路径触发缺失（避免在 tCode 之外出现 as I18nKey）
    const text = tCode("ipc", "unknown.code");
    expect(text).toBe("ipc.unknown.code");
    expect(warn).toHaveBeenCalled();
  });
});

describe("t() 复数分段（en value 的 one|other）", () => {
  it("n === 1 取第一段", () => {
    setLocale("en");
    expect(t("已选择 {n} 张", { n: 1 })).toBe("1 image selected");
  });

  it("n 为其他值取最后一段", () => {
    setLocale("en");
    expect(t("已选择 {n} 张", { n: 5 })).toBe("5 images selected");
  });

  it("无 n 参数取第一段", () => {
    setLocale("en");
    expect(t("已选择 {n} 张")).toBe("{n} image selected");
  });
});

describe("interpolate", () => {
  it("缺失参数保留占位符原文（绝不出现 undefined）", () => {
    expect(interpolate("已选择 {n} 张", {})).toBe("已选择 {n} 张");
  });

  it("支持 string 与 number 参数、同一参数多次出现", () => {
    expect(interpolate("{name} 的 {name}（{count}）", { name: "项目", count: 2 })).toBe("项目 的 项目（2）");
  });

  it("无 params 时原样返回模板", () => {
    expect(interpolate("纯文本 {n}")).toBe("纯文本 {n}");
  });
});

describe("tCode() 语义 code key", () => {
  it("en 下命中词典返回英文并插值", () => {
    setLocale("en");
    expect(tCode("error", "network.timeout.message", { seconds: 30 })).toBe(
      "The image service did not respond within 30 seconds.",
    );
  });

  it("zh 下返回调用方传入的主进程中文 fallback（插值后）", () => {
    expect(tCode("error", "network.timeout.message", { seconds: 30 }, "图片服务在 30 秒内未响应。")).toBe(
      "图片服务在 30 秒内未响应。",
    );
  });

  it("zh 下无 fallback 时回退 code 并 console.warn，绝不抛错（机器码不得泄漏进中文界面）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(tCode("error", "network.timeout.message")).toBe("network.timeout.message");
    expect(warn).toHaveBeenCalled();
  });

  it("tCode 在 zh/en 下都不返回 undefined", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(typeof tCode("update", "anything")).toBe("string");
    setLocale("en");
    expect(typeof tCode("localai", "anything")).toBe("string");
  });
});

describe("settings:test 语义码（T13）", () => {
  // tCode 走动态 key（`as I18nKey`），类型系统无法保证 test.* 词条存在——用测试锁定。
  it("en 下 8 个 test.* code 均命中英文", () => {
    setLocale("en");
    expect(tCode("test", "ok")).toBe("Connection successful");
    expect(tCode("test", "noProvider")).toBe("Provider not found");
    expect(tCode("test", "notConfigured")).toBe("Not configured");
    expect(tCode("test", "noKey")).toBe("No API key configured");
    expect(tCode("test", "badBaseUrl")).toBe("Invalid API Base URL");
    expect(tCode("test", "scheme")).toBe("API Base URL only supports http/https");
    expect(tCode("test", "http", { status: 404 })).toBe("Endpoint returned 404");
    expect(tCode("test", "network")).toBe("Connection failed");
  });

  it("zh 下回退主进程中文 message", () => {
    expect(tCode("test", "noKey", {}, "尚未配置 API 密钥")).toBe("尚未配置 API 密钥");
  });
});

describe("localai 进度码（T26）", () => {
  // tCode 走动态 key（`as I18nKey`），类型系统无法保证 localai.* 词条存在——用测试锁定。
  it("en 下 9 个 localai.* code 均命中英文并插值", () => {
    setLocale("en");
    expect(tCode("localai", "verifyingExisting")).toBe("Verifying the installed model");
    expect(tCode("localai", "verifyingSha")).toBe("Verifying SHA-256 integrity");
    expect(tCode("localai", "installed")).toBe("Model installed; ready for offline use");
    expect(tCode("localai", "paused")).toBe("Download paused; you can resume later");
    expect(tCode("localai", "downloading", { name: "tiny.onnx" })).toBe("Downloading tiny.onnx");
    expect(tCode("localai", "verifyFailed", { expected: "aaaa", actual: "bbbb" })).toBe(
      "Model verification failed: expected aaaa, got bbbb",
    );
    expect(tCode("localai", "httpStatus", { status: 500 })).toBe("The download server returned HTTP 500");
    expect(tCode("localai", "noBody")).toBe("The download response has no readable data");
    expect(tCode("localai", "failed")).toBe("Model download failed");
  });

  it("zh 下回退 manager 中文 message", () => {
    expect(tCode("localai", "downloading", { name: "x" }, "正在下载 x")).toBe("正在下载 x");
  });
});

describe("词典完整性", () => {
  const shards = { core, settings, gallery, composer, localai, queue, tutorial, shell, errors };

  it("每个分片非空，且所有 value 为非空字符串（无 undefined）", () => {
    for (const [name, shard] of Object.entries(shards)) {
      const entries = Object.entries(shard);
      expect(entries.length, `分片 ${name} 不得为空`).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(typeof value, `${name}["${key}"] 必须是 string`).toBe("string");
        expect(value.trim().length, `${name}["${key}"] 不得为空串`).toBeGreaterThan(0);
      }
    }
  });

  it("聚合后无跨分片重复 key（spread 静默覆盖检测）", () => {
    const total = Object.values(shards).reduce((sum, shard) => sum + Object.keys(shard).length, 0);
    expect(Object.keys(en).length).toBe(total);
  });
});
