// composer 分片：创作域（ComposerPanel / creative.ts / layout.ts / MaskPainter）。
// 注意：模型输入（creative.ts 的 promptSuffix、variationOptions[].suffix）刻意不登记、不翻译。
// 「图反推」的 en 值已由 settings 分片承载（模型角色名同键），此处不得重复登记。
export const composer = {
  创作: "Create",

  // 清晰度档位（creative.ts resolutionOptions）。
  "1K（标准）": "1K (Standard)",
  "2K（高清）": "2K (HD)",
  "4K（超清）": "4K (Ultra HD)",

  // 画面比例（creative.ts ratioOptions）。
  "1:1 正方形": "1:1 Square",
  "4:3 横向": "4:3 Landscape",
  "3:4 竖向": "3:4 Portrait",
  "3:2 横向": "3:2 Landscape",
  "2:3 竖向": "2:3 Portrait",
  "16:9 宽屏": "16:9 Widescreen",
  "9:16 手机": "9:16 Phone",
  "4:5 人像": "4:5 Portrait",
  "5:4 横幅": "5:4 Banner",
  "21:9 超宽": "21:9 Ultra-wide",

  // 自定义安全尺寸校验（creative.ts validateCanvasSize）。
  "请输入宽 x 高，例如 1536x1024": "Enter width x height, e.g. 1536x1024",
  "宽高需要是 16 的倍数": "Width and height must be multiples of 16",
  "最长边不能超过 3840 px": "The longest edge cannot exceed 3840 px",
  "长宽比不能超过 3:1": "The aspect ratio cannot exceed 3:1",
  "总像素需在 65 万到 1475 万之间": "Total pixels must be between 0.65M and 14.75M",
  "{w} × {h}，约 {mp} MP": "{w} × {h}, about {mp} MP",

  // 变体选项 label（creative.ts variationOptions）；suffix 为模型输入不译。
  "更高级": "More premium",
  "更写实": "More realistic",
  "更简洁": "More minimal",
  "更有视觉冲击力": "More visual impact",

  // 布局模块名（layout.ts moduleLabel）。
  "项目归属": "Project",
  "提示词": "Prompt",
  "负面提示词": "Negative prompt",
  "上传区": "Upload",
  "蒙版绘制": "Mask",
  "参考图": "References",
  "扩图画布": "Outpaint canvas",
  "输出控制": "Output controls",

  // 布局默认方案名（useComposerLayout）。
  "默认": "Default",

  // ipc.template.* — 主进程提示词模板 IPC 失败码（T24，模板归创作域；zh 走 handler 中文 error 回退）。
  "ipc.template.empty": "Template title and prompt cannot be empty",
  "ipc.template.builtinNotDeletable": "Built-in templates cannot be deleted",

  // ===================== T19：ComposerPanel / MaskPainter 文案 =====================
  // 通用短词带 `|语境` 后缀消歧（zh 直通剥离后缀），避免与并行分片（T18/T20/T21/T22）撞 key。

  // --- 模式标题（整句三选一，不做拼接）---
  "透明画布 + 自动蒙版": "Transparent canvas + auto mask",
  "原图 + 蒙版 + 参考图": "Source image + mask + references",
  "提示词 + 参考图 + 队列": "Prompt + references + queue",
  "智能扩展画面": "Extend the frame intelligently",
  "编辑与局部重绘": "Edit and local redraw",
  "描述你想要的画面": "Describe the image you want",

  // --- 布局编辑入口与工具条 ---
  "调整布局": "Adjust layout",
  "完成布局": "Done editing",
  "自定义各模块的位置与大小": "Customize the position and size of each module",
  "拖动移动 · 边角缩放 · × 隐藏": "Drag to move · Corner to resize · × to hide",
  "方案|布局": "Preset",
  "将当前布局另存为新方案": "Save the current layout as a new preset",
  "另存为": "Save as",
  "重命名当前方案": "Rename the current preset",
  "重命名|方案": "Rename",
  "删除当前方案（默认方案不可删除）": "Delete the current preset (the default preset cannot be deleted)",
  "删除|方案": "Delete",
  "撤销（Ctrl+Z）": "Undo (Ctrl+Z)",
  "撤销|布局": "Undo",
  "重做（Ctrl+Shift+Z / Ctrl+Y）": "Redo (Ctrl+Shift+Z / Ctrl+Y)",
  "重做|布局": "Redo",
  "复制当前布局的分享码": "Copy the current layout's share code",
  "复制分享码": "Copy share code",
  "粘贴布局分享码并导入": "Paste a layout share code to import",
  "导入分享码": "Import share code",
  "已隐藏 {n} 个：": "{n} hidden:|{n} hidden:",
  "恢复显示该模块": "Show this module again",
  "清除自定义布局并恢复默认排列（需确认）": "Clear the custom layout and restore the default arrangement (confirmation required)",
  "恢复默认布局": "Restore default layout",
  "隐藏该模块（可从「已隐藏」列表恢复）": "Hide this module (restore it from the “hidden” list)",

  // --- 布局方案对话框与通知 ---
  "将清除自定义的模块位置、大小与隐藏设置，恢复为默认排列。此操作不可撤销，确定继续吗？":
    "This clears the custom module positions, sizes, and hidden settings and restores the default arrangement. This cannot be undone. Continue?",
  "先调整布局，再复制分享码": "Adjust the layout first, then copy the share code",
  "布局分享码已复制，可粘贴分享": "Layout share code copied; paste it to share",
  "导入布局分享码": "Import layout share code",
  "粘贴布局分享码（ITL2；ITL1 旧码将按当前窗口近似换算）。导入只替换通用模块的位置与隐藏状态，专属模块保持不动。":
    "Paste a layout share code (ITL2; legacy ITL1 codes are approximated to the current window). Importing only replaces the shared modules' positions and hidden state; mode-specific modules are left unchanged.",
  "导入|布局": "Import",
  "分享码无效或已损坏": "The share code is invalid or corrupted",
  "旧版分享码已按当前窗口换算，可能需要微调": "The legacy share code was converted to the current window and may need fine-tuning",
  "布局已导入（通用模块已更新）": "Layout imported (shared modules updated)",
  "保存为新方案": "Save as new preset",
  "为新方案取一个名字（当前布局会被复制）": "Name the new preset (the current layout will be copied)",
  "保存|方案": "Save",
  "已保存方案「{name}」": "Saved preset “{name}”",
  "重命名方案": "Rename preset",
  "输入新的方案名称": "Enter a new preset name",
  "删除方案": "Delete preset",
  "删除方案「{name}」？该方案保存的布局将丢失（不可撤销）。": "Delete preset “{name}”? Its saved layout will be lost (cannot be undone).",

  // --- 项目归属 / 标签 ---
  "归属项目": "Project",
  "默认归档到收件箱，可随时批量移动。": "Archived to the inbox by default; you can move them in bulk anytime.",
  "标签|创作": "Tags",
  "例如：海报，蓝粉，产品": "e.g. poster, blue-pink, product",

  // --- 提示词卡片 ---
  "正向描述画面；可保存为模板复用。": "Describe the image positively; save it as a template for reuse.",
  "选择模板…": "Select a template…",
  "保存为模板": "Save as template",
  "更新模板": "Update template",
  "删除模板": "Delete template",
  "精炼主体": "Refine subject",
  "强化细节": "Enhance detail",
  "海报化": "Posterize",
  "社媒化": "Social media",
  "AI 增强中…": "Enhancing with AI…",
  "AI 增强 · {model}": "AI enhance · {model}",
  "恢复原提示词": "Restore original prompt",
  "例如：保持主体不变，把背景改成未来城市夜景":
    "e.g. keep the subject unchanged and turn the background into a futuristic city night scene",
  "例如：一张科技感产品海报，蓝白配色，干净高级":
    "e.g. a techy product poster, blue and white palette, clean and premium",

  // --- 负面提示词卡片 ---
  "独立保存；提交时转换为「必须避免」的自然语言约束。":
    "Saved separately; on submit it is converted into natural-language constraints to avoid.",
  "选择负面词模板…": "Select a negative prompt template…",
  "例如：水印、乱码文字、重复元素、肢体畸形、塑料质感":
    "e.g. watermark, garbled text, duplicated elements, deformed limbs, plastic texture",

  // --- 图反推卡片 ---
  "图反推提示词 · {model}": "Reverse prompt · {model}",
  "未配置|模型": "Not configured",
  "待分析：{name}": "To analyze: {name}",
  "选择需要反推的图片": "Choose an image to reverse-engineer",
  "分析中…": "Analyzing…",
  "生成中英文提示词": "Generate Chinese and English prompts",
  "中文提示词": "Chinese prompt",
  "替换当前": "Replace current",
  "追加": "Append",
  "复制|创作": "Copy",
  "反推提示词已复制": "Reversed prompt copied",

  // --- 上传区（原图 / 外部蒙版）---
  "原图：{name}": "Source: {name}",
  "上传扩图原图": "Upload outpaint source",
  "上传原图": "Upload source image",
  "外部蒙版：{name}": "External mask: {name}",
  "可选外部蒙版": "Optional external mask",

  // --- 参考图卡片 ---
  "参考图片": "Reference images",
  "参考图 {n}": "Reference image {n}",
  "移除参考图 {n}": "Remove reference image {n}",
  "可参考构图、风格、配色或主体特征生成新画面。添加参考图后会自动使用兼容图片编辑接口，一次生成 1 张；不添加时仍使用普通文生图接口。":
    "Can reference composition, style, palette, or subject traits to generate a new image. Adding reference images automatically uses a compatible image-editing endpoint and generates 1 image at a time; without them the standard text-to-image endpoint is used.",
  "与原图合成参考画板，帮助模型理解风格和元素。局部蒙版与多参考图不能同时提交；需要局部修改时请先移除参考图。":
    "Composed with the source image into a reference board to help the model understand the style and elements. A partial mask and multiple reference images cannot be submitted together; remove the reference images first for local edits.",
  "导入图片|创作": "Import image",
  "从剪贴板粘贴|创作": "Paste from clipboard",
  "清空|参考图": "Clear",
  "剪贴板中已有图片时，可直接点击这里粘贴": "If the clipboard already has an image, click here to paste",

  // --- 扩图卡片 ---
  "原图 {w}x{h}": "Source {w}x{h}",
  "上传原图后可设置目标画布": "Upload a source image to set the target canvas",
  "仅扩展，不裁剪": "Extend only, never crop",
  "快捷转换": "Quick convert",
  "四向百分比": "Four-way percentage",
  "目标分辨率": "Target resolution",
  "上|方向": "Top",
  "右|方向": "Right",
  "下|方向": "Bottom",
  "左|方向": "Left",
  "（%）": "(%)",
  "例如 1080x1920": "e.g. 1080x1920",
  "目标 {size} · 原图位于 ({x}, {y})": "Target {size} · source at ({x}, {y})",

  // --- 输出控制卡片 ---
  "生成速度": "Generation speed",
  "快速预览": "Fast preview",
  "稳定创作": "Stable creation",
  "最终高清": "Final high-res",
  "细节质量": "Detail quality",
  "清晰度|创作": "Resolution",
  "推荐配置：1K、自动细节、1 张，通常响应更快、失败率更低。":
    "Recommended: 1K, auto detail, 1 image — usually faster and less likely to fail.",
  "画面比例|创作": "Aspect ratio",
  "例如 1536x1024": "e.g. 1536x1024",
  "返回预设比例": "Back to preset ratio",
  "自定义尺寸": "Custom size",
  "数量|创作": "Count",
  "{n} 张": "{n} image|{n} images",

  // --- 底部状态 / 性能提示 / 运行行 ---
  "扩展画布": "Extend canvas",
  "{ratio} 比例": "{ratio} ratio",
  "当前输出：{size} · {mode} · {resolution} 清晰度 · 项目：{project}":
    "Current output: {size} · {mode} · {resolution} quality · Project: {project}",
  "收件箱|创作": "Inbox",
  "当前组合需要更长等待时间，也更容易遇到接口限制。建议先用 1K、自动细节、1 张确定构图。":
    "This combination takes longer and is more likely to hit endpoint limits. Try 1K, auto detail, and 1 image first to lock in the composition.",
  "正在准备任务…": "Preparing task…",
  "继续加入队列": "Add to queue again",
  "加入扩图队列": "Add to outpaint queue",
  "加入编辑队列": "Add to edit queue",
  "加入参考图生成队列": "Add reference generation to queue",
  "加入生成队列": "Add to generation queue",
  "取消任务": "Cancel task",
  "自动归档：已开启": "Auto-archive: On",
  "自动归档：已关闭": "Auto-archive: Off",

  // --- MaskPainter ---
  "局部重绘蒙版": "Local redraw mask",
  "在需要修改的位置涂抹，未涂抹区域将尽量保持不变。":
    "Paint over the areas to change; unpainted areas are kept as unchanged as possible.",
  "画笔": "Brush",
  "撤销|蒙版": "Undo",
  "清空|蒙版": "Clear",
  "编辑原图": "Source image for editing",
} as const;
