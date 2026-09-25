import React, { createContext, useContext } from "react";

type StudioContextValue = {
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  notice: string;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  errorInfo: GenerationErrorInfo | null;
  setErrorInfo: React.Dispatch<React.SetStateAction<GenerationErrorInfo | null>>;
  projectId: string;
  setProjectId: React.Dispatch<React.SetStateAction<string>>;
  tagsText: string;
  setTagsText: React.Dispatch<React.SetStateAction<string>>;
  imageModel: string;
  setImageModel: React.Dispatch<React.SetStateAction<string>>;
  chatModel: string;
  setChatModel: React.Dispatch<React.SetStateAction<string>>;
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
