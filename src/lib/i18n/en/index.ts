// en 词典聚合：按域分片展开合并。
// 分片之间不得出现重复 key（spread 会静默覆盖）——由 tests/i18n.test.ts 的完整性用例锁定。
import { core } from "./core";
import { settings } from "./settings";
import { gallery } from "./gallery";
import { composer } from "./composer";
import { localai } from "./localai";
import { queue } from "./queue";
import { tutorial } from "./tutorial";
import { shell } from "./shell";
import { errors } from "./errors";

export const en = {
  ...core,
  ...settings,
  ...gallery,
  ...composer,
  ...localai,
  ...queue,
  ...tutorial,
  ...shell,
  ...errors,
} as const;

/** 类型化词典 key：中文文案（可带 `|语境` 后缀）或语义 code（如 `error.<code>.title`）。 */
export type I18nKey = keyof typeof en;
