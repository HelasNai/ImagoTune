// gallery 分片：图库域（GalleryWorkspace / SidebarProjects / ipc.gallery.* code）。
export const gallery = {
  图库: "Gallery",

  // ipc.gallery.* — 主进程图库/项目 IPC 失败码（T24；zh 走 handler 中文 error 回退）。
  "ipc.gallery.notFound": "Gallery record not found",
  "ipc.gallery.thumbnailFailed": "The image file does not exist",
  "ipc.gallery.loadFailed": "The image file does not exist",
  "ipc.gallery.openFailed": "The image file does not exist or has been moved",
  "ipc.gallery.nothingSelected": "No images selected",
  "ipc.gallery.projectNameRequired": "Project name cannot be empty",
  "ipc.gallery.projectNotEditable": "This project cannot be modified",
  "ipc.gallery.inboxNotDeletable": "The inbox cannot be deleted",
  "ipc.gallery.projectNotFound": "Project not found",
  "ipc.gallery.coverMismatch": "The image does not belong to this project",
} as const;
