import { dialog, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "./net-utils";
import type { IpcCode } from "../shared/types";

/** IPC handler 返回结构：成功、取消、失败三种形态保持与原内联实现一致。 */
export type DirectoryIpcResult = { ok: boolean; error?: string; code?: IpcCode; [key: string]: unknown };

export type DirectoryManagerOptions = {
  /** keytar 账号键（如 `${ACCOUNT}:saveDir`），读写都经注入的凭据回调，以复用 legacy service 回退。 */
  credentialKey: string;
  /** 系统默认目录（保存目录 = “图片”/ImagoTune；模型目录 = userData/models）。 */
  systemDir: () => string;
  /** 兼容旧版开发机的硬编码目录，仅当能 stat 为目录时使用（保存目录专属）。 */
  legacyDir?: string;
  /** 目录切换副作用：保存目录初始化图库、模型目录重建 LocalAIModelManager。 */
  activate: (directory: string, copyFrom?: string) => Promise<string>;
  /** 读取当前生效目录（对话框 defaultPath / 取消回包 / 打开目录使用）。 */
  currentDir: () => string;
  /** 选择目录对话框标题；传函数时在每次打开对话框时求值（供 i18n 按当前 locale 生成）。 */
  dialogTitle: string | (() => string);
  /** 返回结构中的目录字段名（saveDir / modelsDir）。 */
  resultKey: string;
  /** 切换前置守卫；返回错误对象表示拒绝（队列忙碌 / 模型下载中）。 */
  guard?: () => { ok: false; error: string; code?: IpcCode } | null;
  /** 切换成功后附加字段（模型目录需要 items）。 */
  resultExtras?: () => Promise<Record<string, unknown>>;
  /** 选择失败时的兜底文案。 */
  chooseError: string;
  /** 选择失败时的语义码（T25；缺省则无码，en 直通兜底文案）。 */
  chooseErrorCode?: IpcCode;
  /** 恢复默认失败时的兜底文案。 */
  resetError: string;
  /** 恢复默认失败时的语义码（T25；缺省则无码）。 */
  resetErrorCode?: IpcCode;
  readCredential: (account: string) => Promise<string | null>;
  writeCredential: (account: string, value: string) => Promise<void>;
};

export type DirectoryManager = {
  resolve: () => Promise<string>;
  activate: (directory: string, copyFrom?: string) => Promise<string>;
  choose: () => Promise<DirectoryIpcResult>;
  reset: () => Promise<DirectoryIpcResult>;
  open: () => Promise<DirectoryIpcResult>;
};

/**
 * 合并保存目录与模型目录两组同构的目录管理行为：
 * resolve（已存凭据 → 旧版目录回退 → 系统默认）/ activate / choose / reset / open。
 * 各目录的差异（默认目录、旧版目录、激活副作用、守卫、字段名、文案）全部由 options 注入。
 */
export function createDirectoryManager(options: DirectoryManagerOptions): DirectoryManager {
  const {
    credentialKey, systemDir, legacyDir, activate, currentDir, dialogTitle,
    resultKey, guard, resultExtras, chooseError, chooseErrorCode, resetError, resetErrorCode, readCredential, writeCredential,
  } = options;

  async function resolve(): Promise<string> {
    const preferred = await readCredential(credentialKey);
    if (preferred) {
      try {
        await fs.mkdir(preferred, { recursive: true });
        return path.resolve(preferred);
      } catch {
        // 可移动盘或网络盘可能暂时不可用，落到下一层回退。
      }
    }
    if (legacyDir) {
      try {
        if ((await fs.stat(legacyDir)).isDirectory()) return legacyDir;
      } catch {
        // 新安装设备通常没有开发机的旧目录，改用系统默认目录。
      }
    }
    return systemDir();
  }

  async function choose(): Promise<DirectoryIpcResult> {
    const blocked = guard?.();
    if (blocked) return blocked;
    const result = await dialog.showOpenDialog({
      title: typeof dialogTitle === "function" ? dialogTitle() : dialogTitle,
      defaultPath: currentDir(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: true, canceled: true, [resultKey]: currentDir() };
    try {
      const previous = currentDir();
      const next = await activate(result.filePaths[0], previous);
      await writeCredential(credentialKey, next);
      return { ok: true, canceled: false, [resultKey]: next, ...(resultExtras ? await resultExtras() : {}) };
    } catch (error) {
      return { ok: false, error: errorMessage(error, chooseError), code: chooseErrorCode };
    }
  }

  async function reset(): Promise<DirectoryIpcResult> {
    const blocked = guard?.();
    if (blocked) return blocked;
    try {
      const previous = currentDir();
      const next = await activate(systemDir(), previous);
      await writeCredential(credentialKey, next);
      return { ok: true, [resultKey]: next, ...(resultExtras ? await resultExtras() : {}) };
    } catch (error) {
      return { ok: false, error: errorMessage(error, resetError), code: resetErrorCode };
    }
  }

  async function open(): Promise<DirectoryIpcResult> {
    const directory = currentDir();
    await fs.mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    return error ? { ok: false, error } : { ok: true };
  }

  return { resolve, activate, choose, reset, open };
}
