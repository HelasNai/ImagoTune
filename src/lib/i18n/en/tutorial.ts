// tutorial 分片：新手教程（TutorialExperience / lib/tutorial）。
// key = 中文文案（必须与源串逐字节一致——zh 直通返回 key 本身）。
// lib/tutorial.ts 的步骤/主题「结构」（id/icon/mode/target）不是文案；
// 文案存于 STEP_TEMPLATES/TOPIC_TEMPLATES，由 tutorialSteps()/tutorialTopics() 调用时经 t() 求值。
export const tutorial = {
  新手教程: "Tutorial",

  // --- 欢迎对话框（welcome view）---
  "WELCOME TO IMAGOTUNE": "WELCOME TO IMAGOTUNE",
  稍后再看: "Remind me later",
  "用 2–3 分钟熟悉创作流程": "Get familiar with the workflow in 2–3 minutes",
  "教程会带你查看连接设置、提示词、参考图片、生成队列、图库和本地 AI 工具箱。":
    "The tutorial walks you through connection settings, prompts, reference images, the generation queue, the gallery, and the local AI toolbox.",
  不会产生费用: "No cost",
  "教程只高亮和说明功能，不会生成图片、测试连接、下载模型或读取你的输入。":
    "The tutorial only highlights and explains features; it never generates images, tests connections, downloads models, or reads your input.",
  开始教程: "Start tutorial",
  "24 小时后提醒": "Remind me in 24 hours",
  当前教程版本不再提醒: "Don't remind me about this tutorial version",

  // --- 教程中心（center view）---
  "LEARNING CENTER": "LEARNING CENTER",
  关闭教程中心: "Close learning center",
  新手教程中心: "Learning center",
  "按主题快速了解用途、步骤和常见问题。": "Explore purposes, steps, and common issues by topic.",
  核心教程已完成: "Core tutorial completed",
  "已学习 {current}/{total}": "Studied {current}/{total}",
  尚未开始核心教程: "Core tutorial not started",
  常见问题: "Common issues",
  前往该功能: "Go to this feature",
  继续上次进度: "Resume where you left off",
  重新开始完整引导: "Restart the full tour",
  关闭: "Close",

  // --- 引导步骤卡片（tour view）---
  核心教程: "Core tutorial",
  "提示|教程": "Tip",
  "当前布局中没有找到目标控件，已切换为居中讲解，你仍可继续教程。":
    "The target control was not found in the current layout, so this step is shown centered. You can still continue the tutorial.",
  上一步: "Previous",
  下一步: "Next",
  开始创作: "Start creating",
  查看教程中心: "Open learning center",
  暂停并退出: "Pause and exit",
  跳过教程: "Skip tutorial",
  "← → 切换步骤 · Esc 暂停": "← → Change step · Esc to pause",

  // --- 步骤模板（STEP_TEMPLATES 文案）---
  "欢迎来到 ImagoTune": "Welcome to ImagoTune",
  "这里把图片生成、编辑、归档和本地后期处理集中在一个工作台中。图库、任务和模型都保存在本机。":
    "Image generation, editing, archiving, and local post-processing are all in one workspace. Your gallery, tasks, and models stay on this device.",
  "教程只展示功能位置，不会测试连接、生成图片或下载模型，因此不会消耗 API 额度。":
    "The tutorial only points out where features are; it never tests connections, generates images, or downloads models, so it uses no API credits.",
  连接你的图片服务: "Connect your image service",
  "在设置中可以添加多个兼容平台，分别填写 API Base URL 与密钥，再为生图、图反推、提示词增强绑定各自的供应商与模型。密钥只保存到 Windows 凭据库，界面不会回显原文。":
    "In Settings you can add multiple compatible platforms, enter the API Base URL and key for each, then bind models for generation, reverse prompt, and prompt enhancement. Keys are stored only in Windows Credential Manager and are never shown again.",
  "每个供应商都能单独测试连接、刷新模型；教程不会替你提交任何信息。":
    "Each provider can be tested and refreshed independently; the tutorial never submits anything for you.",
  描述画面并选择输出规格: "Describe the image and choose output specs",
  "输入正面提示词，也可以从模板开始；再选择质量、清晰度、比例和数量。负面提示词用于说明希望避免的内容。":
    "Enter a positive prompt, or start from a template; then choose quality, resolution, aspect ratio, and count. The negative prompt describes what to avoid.",
  "第一次建议使用 1K、自动质量和 1 张，通常响应更快、失败率更低。":
    "For your first try, use 1K, Auto quality, and 1 image for a faster response and fewer failures.",
  使用参考图片: "Use reference images",
  "最多添加 3 张参考图，可以从本地导入或直接粘贴剪贴板图片，用于参考构图、风格、配色或主体特征。":
    "Add up to 3 reference images from local files or the clipboard to guide composition, style, color, or subject features.",
  "添加参考图后会走兼容图片编辑流程；不添加时仍是普通文生图。":
    "Adding references switches to the compatible image-edit flow; without them it stays plain text-to-image.",
  加入顺序生成队列: "Add to the sequential generation queue",
  "确认提示词和参数后加入生成队列。任务会逐个执行，你可以离开当前页面并在任务队列中查看进度。":
    "Confirm the prompt and parameters, then add to the generation queue. Tasks run one at a time, and you can leave the page and track progress in the task queue.",
  "按钮在这里，但教程不会点击它，也不会产生任何计费请求。":
    "The button is here, but the tutorial never clicks it and never creates a billable request.",
  "保存、查找和继续创作": "Save, find, and keep creating",
  "生成结果可自动归档到项目图库。历史图片能再次预览、复用参数、继续编辑、创建变体或进入本地工具箱。":
    "Results can be archived automatically to project galleries. Past images can be previewed again, reused for parameters, edited further, turned into variations, or sent to the local toolbox.",
  "图库文件始终保存在本机；你可以在设置中更换保存目录。":
    "Gallery files always stay on this device; you can change the save directory in Settings.",
  // 「本地 AI 后期工具箱」的 en 值由 en/localai.ts 承载（同键复用，避免跨分片重复）。
  "在本地进行 2x/4x 高清放大、智能抠图和人脸优化。模型首次按需下载，安装后可以离线处理。":
    "Do 2x/4x upscaling, background removal, and face enhancement locally. Models download on demand the first time and then run offline.",
  "本地处理不读取 API 密钥，也不会上传图片；人脸优化目前为 Beta。":
    "Local processing never reads API keys or uploads images; face enhancement is currently Beta.",
  准备开始创作: "Ready to start creating",
  "你已经了解完整核心流程。现在可以进入创作页，也可以打开教程中心查看每项功能的详细步骤和常见问题。":
    "You now know the full core flow. Head to the creation page, or open the learning center for detailed steps and common issues for each feature.",
  "教程可从左侧“新手教程”或顶部“帮助”菜单随时重新打开。":
    "Reopen the tutorial anytime from “Tutorial” in the sidebar or the Help menu at the top.",

  // --- 主题模板（TOPIC_TEMPLATES 文案）---
  连接与模型配置: "Connections and model setup",
  "添加并管理一个或多个符合当前请求格式的 OpenAI 兼容图片平台。":
    "Add and manage one or more OpenAI-compatible image platforms that match the current request format.",
  "添加供应商并填写 API Base URL 与 API 密钥": "Add a provider and fill in the API Base URL and API key",
  "刷新平台模型列表或手动添加自定义模型": "Refresh the platform model list or add custom models manually",
  "为生图、图反推、提示词增强分别标注并绑定模型":
    "Tag and bind models for generation, reverse prompt, and prompt enhancement",
  保存后按需测试连接: "Test the connection after saving if needed",
  "如果提示 401 或 403，请确认密钥有效、基础地址包含正确的 /v1 路径，并检查模型权限；如果提示某个角色尚未配置，请回到「模型分配」为它选择供应商与模型。":
    "If you see 401 or 403, check that the key is valid, the base URL includes the correct /v1 path, and the model permissions. If a role is reported as not configured, go back to Model Assignment and pick a provider and model for it.",
  第一次生成图片: "Your first image",
  "从一句自然语言描述生成第一张图片。": "Generate your first image from a single natural-language description.",
  输入画面主体与风格: "Enter the subject and style",
  "选择 1K、自动质量和常用比例": "Choose 1K, Auto quality, and a common aspect ratio",
  "保持数量为 1 张": "Keep the count at 1",
  加入生成队列并等待结果: "Add to the queue and wait for the result",
  "高清、多张或复杂提示词需要更长时间；首次使用推荐轻量参数确认连接正常。":
    "High resolution, multiple images, or complex prompts take longer; for your first run, lightweight settings confirm the connection.",
  参考图与图片编辑: "References and image editing",
  "基于已有图片继续生成、修改局部或参考视觉风格。":
    "Continue generating from an existing image, edit a region, or borrow its visual style.",
  "在创作页添加最多 3 张参考图": "Add up to 3 reference images on the creation page",
  或切换图片编辑并上传原图: "Or switch to image editing and upload the source image",
  局部修改时涂抹蒙版: "Paint a mask for local edits",
  用提示词明确说明保留与修改内容: "Use the prompt to state clearly what to keep and what to change",
  "参考图与局部蒙版不能同时提交时，软件会提示移除冲突素材，不会自动重复请求。":
    "If references and a local mask cannot be submitted together, the app asks you to remove the conflicting input; it never retries automatically.",
  "保存、图库与参数复用": "Saving, galleries, and reusing parameters",
  "让生成结果可搜索、可复用，并按项目持续迭代。":
    "Make results searchable and reusable, and iterate by project.",
  在设置中开启自动归档: "Turn on auto-archive in Settings",
  在图库创建项目和标签: "Create projects and tags in the gallery",
  从历史图片复用参数或继续编辑: "Reuse parameters from past images or keep editing",
  "批量收藏、移动或导出 ZIP": "Favorite, move, or export ZIP in bulk",
  "切换保存目录不会删除旧图库；旧目录仍保留，可随时切换回去。":
    "Changing the save directory does not delete the old gallery; the old folder is kept so you can switch back anytime.",
  "本地 AI 工具箱与模型": "Local AI toolbox and models",
  "不消耗图片 API 额度完成高清化、抠图和人脸优化。":
    "Upscale, remove backgrounds, and enhance faces without using image API credits.",
  导入或从图库打开图片: "Import an image or open one from the gallery",
  选择处理工具: "Choose a processing tool",
  首次使用时下载对应模型: "Download the matching model on first use",
  "对比结果后复制、保存或归档": "Compare the result, then copy, save, or archive it",
  "WebGPU 不可用时会自动回退 WASM/CPU；大图和人脸优化可能需要更长时间。":
    "When WebGPU is unavailable, it falls back to WASM/CPU automatically; large images and face enhancement may take longer.",
} as const;
