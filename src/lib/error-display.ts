// 生成错误展示层：把 GenerationErrorInfo 渲染为可显示的三层文本（title/message/suggestion）。
// - 有 code：三层各经 tCode("error", "<code>.<field>", params, 存储原文)——zh 用存储中文、en 查词典。
// - 无 code（历史 / 未分类）：直接回退存储文本，绝不查表。
// 纯逻辑，无 React/DOM；动态 key 只经 tCode（全仓唯一 `as I18nKey` cast 点）。
import type { GenerationErrorInfo, QueueStatus } from "../../shared/types";
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

// 任务状态派生的规范错误信息（仅 interrupted）：中断是「应用关闭时任务仍在运行」这一状态本身的语义，
// 与历史记录里存储的 errorInfo 文本无关。历史中断记录可能无 errorInfo / 无 code，
// 按状态派生后经 renderErrorInfo 走同一条 tCode 路径，新建与历史记录都能随语言本地化。
// 选用该路径而非在 QueuePanel 内联三次 tCode：沿用 T10 renderErrorInfo 单一渲染通道，
// 中文回退原文与 en 词条集中在 error-display.ts 一处，避免三处可漂移的字面量。
const STATUS_ERROR_INFOS: Partial<Record<QueueStatus, GenerationErrorInfo>> = {
  interrupted: {
    category: "cancelled",
    code: "cancel.interrupt",
    title: "任务已中断",
    message: "应用关闭时任务仍在运行。",
    suggestion: "确认参数后手动重试，软件不会自动重复计费。",
    retryable: true,
  },
};

/** 状态派生错误信息：interrupted → 规范信息（忽略存储文本）；其余状态 → null（调用方回退已存 errorInfo）。 */
export function statusErrorInfo(status: QueueStatus): GenerationErrorInfo | null {
  return STATUS_ERROR_INFOS[status] ?? null;
}
