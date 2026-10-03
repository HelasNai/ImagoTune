// i18n 运行时核心：中文文案 key（zh 直通 / en 查表）+ 语义 code key（tCode）两类 API。
// 设计要点：
// - key 策略 = 中文当 key（zh 直通不查表，现有中文断言测试免改；重复串加 `|语境` 后缀消歧）。
// - en 词典按域分片（./en/*），聚合后 `keyof typeof en` 即类型化 I18nKey。
// - t()/tCode() 绝不抛错、绝不返回 undefined；en 缺失 key 回退为剥离后缀的中文 key 并 warn。
// - 插值 `{name}`：缺失参数保留占位符原文（绝不出现 "undefined"）。
// - en value 复数分段 `one|other`：params.n === 1 取第一段、n 为其他值取最后一段、无 n 取第一段。
// - tCode 的 zh 分支显示调用方传入的主进程中文原文（fallback），机器码不得泄漏进中文界面。
// - 无 React/IPC/DOM 依赖；React 订阅由上层 useSyncExternalStore(subscribe, getLocale) 封装（T7）。
import { en, type I18nKey } from "./en";

export type { I18nKey };

// Locale 不再本地定义：单一来源 = shared/types.d.ts 的 Locale（经 src/global.d.ts 全局别名）。
// 本模块与消费方直接使用环境中的全局 `Locale` 类型，禁止再次 export 同名类型。

/** tCode 的 code 前缀域：error=生成错误、test=settings:test、ipc=IPC 失败、update=更新状态、localai=本地 AI。 */
export type I18nCodePrefix = "error" | "test" | "ipc" | "update" | "localai";

// 初始默认固定为 "zh"：保证未初始化与 Vitest/Node 环境下中文直通；
// 运行时由 T7 在首个设置快照到达后经 setLocale 覆盖。
let current: Locale = "zh";

const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

/** 幂等（相同值不通知）；通知全部订阅者。 */
export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  for (const fn of [...listeners]) fn(next);
}

/** 订阅 locale 变化；返回取消订阅函数。 */
export function subscribe(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `{name}` 插值：缺失参数保留占位符原文（绝不出现 "undefined"）。 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** 剥离 key 的 `|语境` 后缀（`"删除|标题"` → `"删除"`）。 */
function stripContext(key: string): string {
  const index = key.indexOf("|");
  return index === -1 ? key : key.slice(0, index);
}

/** en value 复数分段：n === 1 取第一段，n 为其他值取最后一段，无 n 取第一段。 */
function resolvePlural(value: string, params?: Record<string, string | number>): string {
  const segments = value.split("|");
  if (segments.length === 1) return value;
  if (params && params.n === 1) return segments[0];
  if (params && typeof params.n === "number") return segments[segments.length - 1];
  return segments[0];
}

/**
 * 中文文案 key 翻译：
 * - zh：剥离 `|语境` 后缀后直通插值（不查表）。
 * - en：查表 → 复数分段 → 插值；缺失 key 回退为剥离后缀的中文 key 并 warn（绝不抛错/undefined）。
 */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  if (current === "zh") {
    return interpolate(stripContext(key), params);
  }
  const value = (en as Record<string, string>)[key];
  if (typeof value !== "string" || value === "") {
    console.warn(`[i18n] missing en entry: ${key}`);
    return interpolate(stripContext(key), params);
  }
  return interpolate(resolvePlural(value, params), params);
}

/**
 * 语义 code key 翻译（如 `error.network.timeout.title`）：
 * - en：等价于 t(`${prefix}.${code}`)。
 * - zh：返回调用方传入的主进程中文原文 fallback（插值后）——机器码不得泄漏进中文界面；
 *   无 fallback 时回退 code 并 warn。
 * 本函数是全仓唯一的动态 key `as I18nKey` cast 点。
 */
export function tCode(
  prefix: I18nCodePrefix,
  code: string,
  params?: Record<string, string | number>,
  fallback?: string,
): string {
  if (current === "en") {
    return t(`${prefix}.${code}` as I18nKey, params);
  }
  if (fallback !== undefined && fallback !== "") {
    return interpolate(fallback, params);
  }
  console.warn(`[i18n] zh fallback missing for code: ${prefix}.${code}`);
  return code;
}
