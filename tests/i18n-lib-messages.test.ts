import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "../src/lib/i18n";
import { validateUpscaleOutput } from "../src/lib/local-ai";
import { outpaintToSize } from "../src/lib/outpaint";

// T23：lib 层错误文案本地化——锁定 zh 直通精确原文（回归）+ en 查表命中（无缺词回退）。
// 默认 zh 由 i18n 运行时初值保证；每个用例后复位，避免共享模块单例污染其它文件。
afterEach(() => setLocale("zh"));

describe("i18n lib-layer messages (T23)", () => {
  it("local-ai 校验错误 zh 直通还原精确原文、en 命中词典", () => {
    const zh = validateUpscaleOutput(2049, 1024, 4);
    expect(zh.ok).toBe(false);
    if (zh.ok) return;
    expect(zh.error).toBe("输出最长边 8196 px，超过 8192 px 限制");

    setLocale("en");
    const en = validateUpscaleOutput(2049, 1024, 4);
    expect(en.ok).toBe(false);
    if (en.ok) return;
    expect(en.error).toBe("The longest output edge is 8196 px, exceeding the 8192 px limit");
    expect(en.error).not.toContain("输出");
  });

  it("outpaint 目标小于原图 zh 直通、en 查表", () => {
    const zh = outpaintToSize(1024, 1024, "768x1024");
    expect(zh.ok).toBe(false);
    if (zh.ok) return;
    expect(zh.error).toBe("扩图目标不能小于原图，智能扩图不会裁剪内容");

    setLocale("en");
    const en = outpaintToSize(1024, 1024, "768x1024");
    expect(en.ok).toBe(false);
    if (en.ok) return;
    expect(en.error).toBe("The outpaint target cannot be smaller than the source; smart outpaint never crops content");
  });

  it("模板插值 key zh 还原原文（{n} 插值 + 语境后缀剥离）", () => {
    expect(t("输出约 {n} 百万像素，超过 7000 万像素限制", { n: "100.0" }))
      .toBe("输出约 100.0 百万像素，超过 7000 万像素限制");
    expect(t("自动|质量")).toBe("自动");
    expect(t("保存|模板")).toBe("保存");
    expect(t("删除模板|标题")).toBe("删除模板");
  });
});
