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
} as const;
