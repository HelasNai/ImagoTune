import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/lib/i18n";
import { templateCategory, templateTitle } from "../src/lib/template-labels";

// i18n locale 为模块级单例：每个用例结束复位为默认中文，避免污染其余 zh 直通断言。
afterEach(() => {
  setLocale("zh");
});

const builtinPoster = { id: "builtin-poster", title: "科技产品海报", category: "海报", builtin: true };
const builtinNegativePortrait = { id: "builtin-negative-portrait", title: "人像无畸变", category: "人像", builtin: true };
const userTemplate = { id: "custom-1", title: "我的模板", category: "custom" };
const legacyUserTemplate = { id: "custom-2", title: "旧模板", category: "自定义" };
const userCategory = { id: "custom-3", title: "自定义分类模板", category: "我的分类" };

describe("template labels", () => {
  it("zh 直通：内置模板返回存储中文标题/分类", () => {
    expect(templateTitle(builtinPoster)).toBe("科技产品海报");
    expect(templateCategory(builtinPoster)).toBe("海报");
  });

  it("en：内置模板按 id 映射英文标题/分类", () => {
    setLocale("en");
    expect(templateTitle(builtinPoster)).toBe("Tech product poster");
    expect(templateCategory(builtinPoster)).toBe("Poster");
    expect(templateTitle(builtinNegativePortrait)).toBe("Portrait, no distortion");
    expect(templateCategory(builtinNegativePortrait)).toBe("Portrait");
  });

  it("用户模板标题冻结（两语言都不翻译）", () => {
    expect(templateTitle(userTemplate)).toBe("我的模板");
    setLocale("en");
    expect(templateTitle(userTemplate)).toBe("我的模板");
    expect(templateTitle(legacyUserTemplate)).toBe("旧模板");
  });

  it("默认分类码：新 custom 与历史 自定义 均本地化", () => {
    expect(templateCategory(userTemplate)).toBe("自定义");
    expect(templateCategory(legacyUserTemplate)).toBe("自定义");
    setLocale("en");
    expect(templateCategory(userTemplate)).toBe("Custom");
    expect(templateCategory(legacyUserTemplate)).toBe("Custom");
  });

  it("非默认的用户分类冻结为原值", () => {
    setLocale("en");
    expect(templateCategory(userCategory)).toBe("我的分类");
  });

  it("未知 id 或 builtin 标记缺失时回退存储值（不抛错）", () => {
    setLocale("en");
    const unknown = { id: "builtin-future", title: "未来模板", category: "未来", builtin: true };
    expect(templateTitle(unknown)).toBe("未来模板");
    expect(templateCategory(unknown)).toBe("未来");
    const notBuiltin = { id: "builtin-poster", title: "用户同名", category: "custom" };
    expect(templateTitle(notBuiltin)).toBe("用户同名");
    expect(templateCategory(notBuiltin)).toBe("Custom");
  });
});
