import { afterEach, describe, expect, it, vi } from "vitest";
import { renderErrorInfo, statusErrorInfo } from "../src/lib/error-display";
import { setLocale } from "../src/lib/i18n";
import type { GenerationErrorCode, GenerationErrorInfo } from "../shared/types";

// 模块级 locale 单例在测试间共享：每个用例结束复位为默认中文，避免相互污染。
afterEach(() => {
  setLocale("zh");
  vi.restoreAllMocks();
});

const base: GenerationErrorInfo = {
  category: "timeout",
  title: "生成响应超时",
  message: "请求超过 300 秒仍未完成。",
  suggestion: "建议降低到 1K、单张并稍后手动重试。",
  retryable: true,
};

describe("renderErrorInfo", () => {
  it("zh + code：三层均回退到存储的中文原文（机器码不得泄漏）", () => {
    const rendered = renderErrorInfo({ ...base, code: "network.timeout", params: { seconds: 300 } });
    expect(rendered).toEqual({
      title: "生成响应超时",
      message: "请求超过 300 秒仍未完成。",
      suggestion: "建议降低到 1K、单张并稍后手动重试。",
    });
  });

  it("en + code：三层查词典返回英文并完成 {param} 插值", () => {
    setLocale("en");
    const rendered = renderErrorInfo({ ...base, code: "network.timeout", params: { seconds: 300 } });
    expect(rendered.title).toBe("Request timed out");
    expect(rendered.message).toBe("The image service did not respond within 300 seconds.");
    expect(rendered.suggestion).toBe("Lower to 1K, a single image, and retry manually later.");
  });

  it("无 code（历史错误）：zh 与 en 均原样直通存储文本，不查表", () => {
    expect(renderErrorInfo(base)).toEqual({
      title: base.title,
      message: base.message,
      suggestion: base.suggestion,
    });
    setLocale("en");
    expect(renderErrorInfo(base)).toEqual({
      title: base.title,
      message: base.message,
      suggestion: base.suggestion,
    });
  });

  it("params 在 zh 与 en 下都插值（中文回退与英文词典各自完成替换）", () => {
    const withPlaceholder: GenerationErrorInfo = {
      ...base,
      title: "请求超时",
      message: "在 {seconds} 秒内未收到响应。",
      suggestion: "等待 {seconds} 秒后重试。",
      code: "network.timeout",
      params: { seconds: 45 },
    };

    const zh = renderErrorInfo(withPlaceholder);
    expect(zh.message).toBe("在 45 秒内未收到响应。");
    expect(zh.suggestion).toBe("等待 45 秒后重试。");

    setLocale("en");
    const en = renderErrorInfo(withPlaceholder);
    expect(en.message).toBe("The image service did not respond within 45 seconds.");
  });

  it("en 下未知 code：不抛错、回退存储文本、绝不泄漏裸 key（tCode 缺失 key 路径）", () => {
    setLocale("en");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unknown: GenerationErrorInfo = { ...base, code: "does.not.exist" as GenerationErrorCode };

    const rendered = renderErrorInfo(unknown);

    expect(rendered.title).toBe(base.title);
    expect(rendered.message).toBe(base.message);
    expect(rendered.suggestion).toBe(base.suggestion);
    expect(rendered.message).not.toContain("error.");
    expect(warn).toHaveBeenCalled();
  });
});

describe("statusErrorInfo（T28 状态派生）", () => {
  it("interrupted 返回带 cancel.interrupt 的规范信息", () => {
    const info = statusErrorInfo("interrupted");
    expect(info?.code).toBe("cancel.interrupt");
    expect(info?.category).toBe("cancelled");
    expect(info?.retryable).toBe(true);
  });

  it("interrupted 经 renderErrorInfo：zh 用规范中文、en 用词典英文", () => {
    const info = statusErrorInfo("interrupted")!;
    expect(renderErrorInfo(info)).toEqual({
      title: "任务已中断",
      message: "应用关闭时任务仍在运行。",
      suggestion: "确认参数后手动重试，软件不会自动重复计费。",
    });
    setLocale("en");
    expect(renderErrorInfo(info)).toEqual({
      title: "Task interrupted",
      message: "The task was still running when the app closed.",
      suggestion: "Confirm the parameters and retry manually; the app will not bill you again automatically.",
    });
  });

  it("非 interrupted 状态返回 null（调用方回退已存 errorInfo / job.error）", () => {
    expect(statusErrorInfo("failed")).toBeNull();
    expect(statusErrorInfo("cancelled")).toBeNull();
    expect(statusErrorInfo("completed")).toBeNull();
  });
});
