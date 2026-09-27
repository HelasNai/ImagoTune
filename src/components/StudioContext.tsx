import React, { createContext, useContext } from "react";

/**
 * 统一通知接口：`message` 为可展示文案，`isError` 为 true 时归为错误/需处理。
 * 全应用（创作、图库、本地工具箱）共用此签名，成功/失败互斥逻辑集中在实现处（`main.tsx` 的 `notify`）。
 */
export type StudioNotify = (message: string, isError?: boolean) => void;

type StudioContextValue = {
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  notice: string;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  errorInfo: GenerationErrorInfo | null;
  setErrorInfo: React.Dispatch<React.SetStateAction<GenerationErrorInfo | null>>;
  /** 唯一通知入口：集中成功/失败互斥（同一时刻只保留成功或错误之一）。 */
  notify: StudioNotify;
  projectId: string;
  setProjectId: React.Dispatch<React.SetStateAction<string>>;
  tagsText: string;
  setTagsText: React.Dispatch<React.SetStateAction<string>>;
  /** 供应商全量快照（含 hasKey）；由 refreshSettings 填充。 */
  providers: ProviderSummary[];
  /** 三角色绑定快照；由 refreshSettings 填充。 */
  roles: Record<ModelRole, RoleBinding | null>;
  /** 重新拉取设置并刷新 providers/roles/configured/autoArchive；返回快照（失败返回 null）。 */
  refreshSettings: () => Promise<SettingsSnapshot | null>;
  /** 派生值：当前生图模型名（未绑定时回退默认）——无 setter。 */
  imageModel: string;
  /** 派生值：当前提示词增强模型名（未绑定时回退默认）——无 setter。 */
  chatModel: string;
  configured: boolean;
  setConfigured: React.Dispatch<React.SetStateAction<boolean>>;
  autoArchive: boolean;
  setAutoArchive: React.Dispatch<React.SetStateAction<boolean>>;
};

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ value, children }: { value: StudioContextValue; children: React.ReactNode }) {
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio 必须在 StudioProvider 内使用");
  return value;
}
