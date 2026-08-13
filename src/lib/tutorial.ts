export const TUTORIAL_CONTENT_VERSION = 1;
export const TUTORIAL_STORAGE_KEY = "ai-image-studio:tutorial-state";
export const TUTORIAL_REMIND_DELAY_MS = 24 * 60 * 60 * 1000;
export const TUTORIAL_EXISTING_USER_GRACE_MS = 10 * 60 * 1000;

export type TutorialStatus = "new" | "in_progress" | "completed" | "dismissed";
export type TutorialMode = "generate" | "settings" | "gallery" | "local-ai";

export interface TutorialState {
  version: number;
  status: TutorialStatus;
  currentStep: number;
  remindAt?: number;
  updatedAt: string;
}

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  hint: string;
  mode?: TutorialMode;
  target?: string;
}

export interface TutorialTopic {
  id: string;
  icon: string;
  title: string;
  purpose: string;
  steps: string[];
  commonIssue: string;
  mode: TutorialMode;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "欢迎来到 AI Image Studio",
    description: "这里把图片生成、编辑、归档和本地后期处理集中在一个工作台中。图库、任务和模型都保存在本机。",
    hint: "教程只展示功能位置，不会测试连接、生成图片或下载模型，因此不会消耗 API 额度。",
  },
  {
    id: "connection",
    title: "连接你的图片服务",
    description: "在设置中填写兼容平台提供的 API Base URL、API 密钥和图片模型名称。密钥保存到 Windows 凭据库，界面不会回显原文。",
    hint: "填写后先保存设置，再按需测试连接。教程不会替你提交任何信息。",
    mode: "settings",
    target: "connection-settings",
  },
  {
    id: "prompt",
    title: "描述画面并选择输出规格",
    description: "输入正面提示词，也可以从模板开始；再选择质量、清晰度、比例和数量。负面提示词用于说明希望避免的内容。",
    hint: "第一次建议使用 1K、自动质量和 1 张，通常响应更快、失败率更低。",
    mode: "generate",
    target: "creation-form",
  },
  {
    id: "references",
    title: "使用参考图片",
    description: "最多添加 3 张参考图，可以从本地导入或直接粘贴剪贴板图片，用于参考构图、风格、配色或主体特征。",
    hint: "添加参考图后会走兼容图片编辑流程；不添加时仍是普通文生图。",
    mode: "generate",
    target: "reference-images",
  },
  {
    id: "queue",
    title: "加入顺序生成队列",
    description: "确认提示词和参数后加入生成队列。任务会逐个执行，你可以离开当前页面并在任务队列中查看进度。",
    hint: "按钮在这里，但教程不会点击它，也不会产生任何计费请求。",
    mode: "generate",
    target: "generation-actions",
  },
  {
    id: "gallery",
    title: "保存、查找和继续创作",
    description: "生成结果可自动归档到项目图库。历史图片能再次预览、复用参数、继续编辑、创建变体或进入本地工具箱。",
    hint: "图库文件始终保存在本机；你可以在设置中更换保存目录。",
    mode: "gallery",
    target: "gallery-workspace",
  },
  {
    id: "local-ai",
    title: "本地 AI 后期工具箱",
    description: "在本地进行 2x/4x 高清放大、智能抠图和人脸优化。模型首次按需下载，安装后可以离线处理。",
    hint: "本地处理不读取 API 密钥，也不会上传图片；人脸优化目前为 Beta。",
    mode: "local-ai",
    target: "local-ai-toolbox",
  },
  {
    id: "complete",
    title: "准备开始创作",
    description: "你已经了解完整核心流程。现在可以进入创作页，也可以打开教程中心查看每项功能的详细步骤和常见问题。",
    hint: "教程可从左侧“新手教程”或顶部“帮助”菜单随时重新打开。",
  },
];

export const TUTORIAL_TOPICS: TutorialTopic[] = [
  {
    id: "connection",
    icon: "⚙",
    title: "连接与模型配置",
    purpose: "连接任意符合当前请求格式的 OpenAI 兼容图片平台。",
    steps: ["填写 API Base URL", "保存 API 密钥", "填写平台提供的图片模型名称", "保存后按需测试连接"],
    commonIssue: "如果提示 401 或 403，请确认密钥有效、基础地址包含正确的 /v1 路径，并检查图片模型权限。",
    mode: "settings",
  },
  {
    id: "first-image",
    icon: "✦",
    title: "第一次生成图片",
    purpose: "从一句自然语言描述生成第一张图片。",
    steps: ["输入画面主体与风格", "选择 1K、自动质量和常用比例", "保持数量为 1 张", "加入生成队列并等待结果"],
    commonIssue: "高清、多张或复杂提示词需要更长时间；首次使用推荐轻量参数确认连接正常。",
    mode: "generate",
  },
  {
    id: "references",
    icon: "◌",
    title: "参考图与图片编辑",
    purpose: "基于已有图片继续生成、修改局部或参考视觉风格。",
    steps: ["在创作页添加最多 3 张参考图", "或切换图片编辑并上传原图", "局部修改时涂抹蒙版", "用提示词明确说明保留与修改内容"],
    commonIssue: "参考图与局部蒙版不能同时提交时，软件会提示移除冲突素材，不会自动重复请求。",
    mode: "generate",
  },
  {
    id: "gallery",
    icon: "▧",
    title: "保存、图库与参数复用",
    purpose: "让生成结果可搜索、可复用，并按项目持续迭代。",
    steps: ["在设置中开启自动归档", "在图库创建项目和标签", "从历史图片复用参数或继续编辑", "批量收藏、移动或导出 ZIP"],
    commonIssue: "切换保存目录不会删除旧图库；旧目录仍保留，可随时切换回去。",
    mode: "gallery",
  },
  {
    id: "local-ai",
    icon: "◈",
    title: "本地 AI 工具箱与模型",
    purpose: "不消耗图片 API 额度完成高清化、抠图和人脸优化。",
    steps: ["导入或从图库打开图片", "选择处理工具", "首次使用时下载对应模型", "对比结果后复制、保存或归档"],
    commonIssue: "WebGPU 不可用时会自动回退 WASM/CPU；大图和人脸优化可能需要更长时间。",
    mode: "local-ai",
  },
];

export function createTutorialState(now = Date.now()): TutorialState {
  return {
    version: TUTORIAL_CONTENT_VERSION,
    status: "new",
    currentStep: 0,
    updatedAt: new Date(now).toISOString(),
  };
}

export function parseTutorialState(raw: string | null, now = Date.now()): TutorialState {
  if (!raw) return createTutorialState(now);
  try {
    const value = JSON.parse(raw) as Partial<TutorialState>;
    if (value.version !== TUTORIAL_CONTENT_VERSION) return createTutorialState(now);
    if (!(["new", "in_progress", "completed", "dismissed"] as const).includes(value.status as TutorialStatus)) {
      return createTutorialState(now);
    }
    return {
      version: TUTORIAL_CONTENT_VERSION,
      status: value.status as TutorialStatus,
      currentStep: Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, Number(value.currentStep) || 0)),
      remindAt: Number.isFinite(value.remindAt) ? Number(value.remindAt) : undefined,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(now).toISOString(),
    };
  } catch {
    return createTutorialState(now);
  }
}

export function shouldShowTutorialWelcome(state: TutorialState, now = Date.now()) {
  if (state.status === "new") return true;
  return state.status === "dismissed" && typeof state.remindAt === "number" && state.remindAt <= now;
}

export function shouldInitializeAsExistingUser(options: {
  configured: boolean;
  galleryCount: number;
  queueCount: number;
  localDataSince?: number;
}, now = Date.now()) {
  if (options.configured || options.galleryCount > 0 || options.queueCount > 0) return true;
  return typeof options.localDataSince === "number" && now - options.localDataSince > TUTORIAL_EXISTING_USER_GRACE_MS;
}

export function startTutorial(state: TutorialState, now = Date.now(), restart = false): TutorialState {
  const resumeStep = state.status === "in_progress" ? state.currentStep : 0;
  return {
    version: TUTORIAL_CONTENT_VERSION,
    status: "in_progress",
    currentStep: restart ? 0 : Math.min(resumeStep, TUTORIAL_STEPS.length - 1),
    updatedAt: new Date(now).toISOString(),
  };
}

export function postponeTutorial(state: TutorialState, now = Date.now()): TutorialState {
  return {
    ...state,
    status: "dismissed",
    remindAt: now + TUTORIAL_REMIND_DELAY_MS,
    updatedAt: new Date(now).toISOString(),
  };
}

export function dismissTutorial(state: TutorialState, now = Date.now()): TutorialState {
  return {
    ...state,
    status: "dismissed",
    remindAt: undefined,
    updatedAt: new Date(now).toISOString(),
  };
}

export function advanceTutorial(state: TutorialState, step: number, now = Date.now()): TutorialState {
  return {
    ...state,
    status: "in_progress",
    currentStep: Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, step)),
    remindAt: undefined,
    updatedAt: new Date(now).toISOString(),
  };
}

export function completeTutorial(state: TutorialState, now = Date.now()): TutorialState {
  return {
    ...state,
    status: "completed",
    currentStep: TUTORIAL_STEPS.length - 1,
    remindAt: undefined,
    updatedAt: new Date(now).toISOString(),
  };
}

export function tutorialProgress(state: TutorialState) {
  if (state.status === "completed") return 100;
  if (state.status === "new") return 0;
  return Math.round((state.currentStep / (TUTORIAL_STEPS.length - 1)) * 100);
}
