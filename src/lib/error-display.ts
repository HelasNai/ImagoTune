// 生成错误展示层：把 GenerationErrorInfo 渲染为可显示的三层文本（title/message/suggestion）。
// - 有 code：三层各经 tCode("error", "<code>.<field>", params, 存储原文)——zh 用存储中文、en 查词典。
// - 无 code（历史 / 未分类）：直接回退存储文本，绝不查表。
// 纯逻辑，无 React/DOM；动态 key 只经 tCode（全仓唯一 `as I18nKey` cast 点）。
import type { GenerationErrorInfo } from "../../shared/types";
import { interpolate, tCode } from "./i18n";

type ErrorField = "title" | "message" | "suggestion";

function renderField(info: GenerationErrorInfo, field: ErrorField): string {
  const stored = info[field];
  if (!info.code) return stored;
  const code = `${info.code}.${field}`;
  const text = tCode("error", code, info.params, stored);
  // en 缺失词条时 tCode 返回 key 原文（`error.<code>.<field>`）——此时回退存储文本，
  // 避免历史错误或未来新增 code 把裸 key 泄漏进界面。
  if (text === `error.${code}`) return interpolate(stored, info.params);
  return text;
}

export function renderErrorInfo(info: GenerationErrorInfo): { title: string; message: string; suggestion: string } {
  return {
    title: renderField(info, "title"),
    message: renderField(info, "message"),
    suggestion: renderField(info, "suggestion"),
  };
}
