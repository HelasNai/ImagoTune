import { useSyncExternalStore } from "react";
import { getLocale, setLocale, subscribe } from "../lib/i18n";

/** 返回 [当前语言, 切换函数]；订阅 i18n 模块单例。 */
export function useLocale(): [Locale, (next: Locale) => void] {
  const locale = useSyncExternalStore(subscribe, getLocale);
  return [locale, setLocale];
}
