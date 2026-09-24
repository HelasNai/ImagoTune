import type { ReactNode } from "react";
import type { TutorialIconName } from "../lib/tutorial";

// 图标库：内联 Lucide（24×24 网格，stroke=currentColor），颜色随父级 color 自动切换。
// 采用内联 SVG 而非引入图标依赖：体积为零、无打包负担，风格与项目既有做法一致。
// 本文件集中登记「当前使用 + 备用」的全部图标；新增图标只需扩展 NavIconName 与 paths。
// 来源：Lucide（MIT）。

// 图标名 = 教程主题（lib/tutorial.ts 定义，侧栏/教程共用）+ 侧栏专用 + 通用备用池
export type NavIconName =
  // 教程主题（settings / sparkles / pen-line / images / package）
  | TutorialIconName
  // 侧栏专用
  | "expand"
  | "list-todo"
  | "graduation-cap"
  // 通用备用池
  | "x"
  | "plus"
  | "minus"
  | "check"
  | "chevron-right"
  | "chevron-down"
  | "arrow-left"
  | "arrow-right"
  | "refresh-cw"
  | "rotate-cw"
  | "loader-circle"
  | "download"
  | "upload"
  | "trash"
  | "copy"
  | "folder-open"
  | "external-link"
  | "search"
  | "tag"
  | "star"
  | "info"
  | "triangle-alert"
  | "circle-check"
  | "circle-alert"
  | "eye"
  | "play"
  | "pause"
  | "monitor"
  | "image"
  | "image-off"
  | "scan-line"
  | "wand-sparkles"
  | "cpu"
  | "hard-drive"
  | "clock"
  | "panel-left";

const paths: Record<NavIconName, ReactNode> = {
  // 创作生成：星芒（AI 生成）
  sparkles: (
    <>
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4m2-2h-4" />
      <circle cx="4" cy="20" r="2" />
    </>
  ),
  // 图片编辑：钢笔笔迹
  "pen-line": (
    <path d="M13 21h8m.174-14.188a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  ),
  // 智能扩图：四向外扩
  expand: (
    <path d="m15 15l6 6M15 9l6-6m0 13v5h-5m5-13V3h-5M3 16v5h5m-5 0l6-6M3 8V3h5m1 6L3 3" />
  ),
  // 项目图库：多图叠放
  images: (
    <>
      <path d="m22 11l-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" />
      <path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" />
      <circle cx="13" cy="7" r="1" fill="currentColor" />
      <rect width="14" height="14" x="8" y="2" rx="2" />
    </>
  ),
  // 本地工具箱：包裹（模型包）
  package: (
    <>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zm1 .27V12" />
      <path d="M3.29 7L12 12l8.71-5M7.5 4.27l9 5.15" />
    </>
  ),
  // 任务队列：待办列表
  "list-todo": (
    <>
      <path d="M13 5h8m-8 7h8m-8 7h8M3 17l2 2l4-4" />
      <rect width="6" height="6" x="3" y="4" rx="1" />
    </>
  ),
  // 设置：齿轮
  settings: (
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // 新手教程：学士帽
  "graduation-cap": (
    <>
      <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0zM22 10v6" />
      <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
    </>
  ),
  // 通用关闭：叉号
  x: <path d="M18 6L6 18M6 6l12 12" />,
  // 删除：垃圾桶
  trash: <path d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  // 单张图片：相框
  image: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  // 展开指示：右向折角
  "chevron-right": <path d="m9 18l6-6l-6-6" />,
  // 展开指示：下向折角
  "chevron-down": <path d="m6 9l6 6l6-6" />,

  // ---------- 通用操作（备用池） ----------
  // 增加
  plus: <path d="M5 12h14m-7-7v14" />,
  // 减少
  minus: <path d="M5 12h14" />,
  // 完成：对勾
  check: <path d="M20 6L9 17l-5-5" />,

  // ---------- 方向 ----------
  // 向左箭头
  "arrow-left": <path d="m12 19l-7-7l7-7m7 7H5" />,
  // 向右箭头
  "arrow-right": <path d="M5 12h14m-7-7l7 7l-7 7" />,

  // ---------- 刷新 / 加载 ----------
  // 刷新：双向循环箭头
  "refresh-cw": (
    <>
      <path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  // 重做：单向循环箭头
  "rotate-cw": (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  // 加载中：圆弧
  "loader-circle": <path d="M21 12a9 9 0 1 1-6.219-8.56" />,

  // ---------- 文件 / 传输 ----------
  // 下载
  download: (
    <>
      <path d="M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10l5 5l5-5" />
    </>
  ),
  // 上传
  upload: <path d="M12 3v12m5-7l-5-5l-5 5m14 7v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />,
  // 复制
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  // 打开文件夹
  "folder-open": (
    <path d="m6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  ),
  // 外部链接
  "external-link": (
    <path d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  ),

  // ---------- 检索 / 状态 ----------
  // 搜索
  search: (
    <>
      <path d="m21 21l-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
  // 标签
  tag: (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  // 收藏：星形
  star: (
    <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z" />
  ),
  // 提示：信息
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4m0-4h.01" />
    </>
  ),
  // 警告：三角叹号
  "triangle-alert": (
    <path d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01" />
  ),
  // 成功：圆形对勾
  "circle-check": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m16 9l-5.5 5.5L8 12" />
    </>
  ),
  // 错误：圆形叹号
  "circle-alert": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4m0 4h.01" />
    </>
  ),
  // 预览：眼睛
  eye: (
    <>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),

  // ---------- 媒体 / 图像 ----------
  // 播放
  play: (
    <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
  ),
  // 暂停
  pause: (
    <>
      <rect width="5" height="18" x="14" y="3" rx="1" />
      <rect width="5" height="18" x="5" y="3" rx="1" />
    </>
  ),
  // 显示器
  monitor: (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  // 图片不可用
  "image-off": (
    <>
      <path d="m2 2l20 20M10.41 10.41a2 2 0 1 1-2.83-2.83m5.92 5.92L6 21m12-9l3 3" />
      <path d="M3.59 3.59A2 2 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59M21 15V5a2 2 0 0 0-2-2H9" />
    </>
  ),
  // 扫描线
  "scan-line": (
    <path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2m4-5h10" />
  ),
  // 魔法棒：AI 润饰
  "wand-sparkles": (
    <path d="m21.64 3.64l-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72M14 7l3 3M5 6v4m14 4v4M10 2v2M7 8H3m18 8h-4M11 3H9" />
  ),

  // ---------- 本地 / 硬件 ----------
  // 处理器
  cpu: (
    <>
      <path d="M12 20v2m0-20v2m5 16v2m0-20v2M2 12h2m-2 5h2M2 7h2m16 5h2m-2 5h2M20 7h2M7 20v2M7 2v2" />
      <rect width="16" height="16" x="4" y="4" rx="2" />
      <rect width="8" height="8" x="8" y="8" rx="1" />
    </>
  ),
  // 硬盘
  "hard-drive": (
    <path d="M10 16h.01m-7.798-4.423a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zm19.734.436H2.054M6 16h.01" />
  ),
  // 时钟
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  // 侧栏面板
  "panel-left": (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
};

export function NavIcon({ name, size = 18 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
