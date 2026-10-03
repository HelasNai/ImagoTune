import React, { useMemo, useState } from "react";
import { INBOX_PROJECT_ID } from "../lib/constants";
import { formatShortDate } from "../lib/format";
import { useDialog } from "./Dialogs";
import { GalleryThumb } from "./GalleryThumb";
import { NavIcon } from "./icons";
import { useIpcAction } from "./ipc";
import { useStudio } from "./StudioContext";
import { Tooltip } from "./Tooltip";

/** 展开区最多展示的行数（缩略图 + 标题 + 时间；其余经「查看全部」进入图库查看）。 */
const PREVIEW_LIMIT = 5;

/**
 * 侧栏项目树（v3.3；v3.6 起头部为「任务队列」入口 + 新建按钮）。
 *
 * - 头部行（含新建输入行）：位于滚动容器（.sidebar-projects）之外，项目列表滚动时保持固定；
 *   队列入口复用 .nav 视觉（含活跃数量徽章，点击跳转队列页）+ `[+]` 新建项目；
 * - 收件箱固定第一行，其余项目保持 `projects` 数组顺序；不渲染「全部图库」行（那是图库页内视图）；
 * - 行点击展开/收起，展开后展示该项目最新 5 张图片的行式列表（缩略图 + 标题 + 紧凑时间，
 *   GalleryThumb 懒加载）+「查看全部 (N)」；
 * - 收件箱不提供重命名/删除；其余项目悬停显示两项操作，输入/确认一律走 useDialog（禁止原生弹窗）；
 * - 任何项目增删改成功后调用 onChanged，驱动父级刷新 projects/items（数量与缩略图保持新鲜）。
 */
export function SidebarProjects({
  projects,
  items,
  onOpenProject,
  onOpenImage,
  onChanged,
  onOpenQueue,
  queueActive,
  queueCount,
}: {
  projects: GalleryProject[];
  items: GalleryItem[];
  onOpenProject: (projectId: string) => void;
  onOpenImage: (imageId: string) => void;
  onChanged: () => void | Promise<void>;
  onOpenQueue: () => void;
  queueActive: boolean;
  queueCount: number;
}) {
  const { notify, setError } = useStudio();
  const { pending, run } = useIpcAction(setError);
  const { requestText, requestConfirm } = useDialog();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");

  // 按项目归组并按 createdAt 倒序（最新在前）：计数与展开预览共用同一份分组结果。
  const grouped = useMemo(() => {
    const map = new Map<string, GalleryItem[]>();
    items.forEach((item) => {
      const list = map.get(item.recipe.projectId);
      if (list) list.push(item);
      else map.set(item.recipe.projectId, [item]);
    });
    map.forEach((list) => list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
    return map;
  }, [items]);

  // 收件箱固定第一行（gallery-store 保证其始终存在于 projects），其余保持数组顺序。
  const ordered = useMemo(() => {
    const inbox = projects.find((project) => project.id === INBOX_PROJECT_ID);
    const rest = projects.filter((project) => project.id !== INBOX_PROJECT_ID);
    return inbox ? [inbox, ...rest] : rest;
  }, [projects]);

  const toggleExpand = (projectId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const createProject = async () => {
    const name = draftName.trim();
    if (!name) return;
    const result = await run(() => window.imageStudio.projects.create(name), { fallbackError: "创建项目失败" });
    if (!result) return;
    setDraftName("");
    setCreating(false);
    notify("项目已创建");
    await onChanged();
  };

  const renameProject = async (project: GalleryProject) => {
    const name = await requestText({ title: "重命名项目", message: "输入新的项目名称", defaultValue: project.name, confirmLabel: "重命名" });
    if (!name?.trim()) return;
    const result = await run(() => window.imageStudio.projects.rename(project.id, name.trim()), { fallbackError: "重命名失败" });
    if (!result) return;
    notify("项目已重命名");
    await onChanged();
  };

  const deleteProject = async (project: GalleryProject) => {
    if (!(await requestConfirm({ title: "删除项目", message: "删除项目后，其中图片会回到收件箱，确定继续吗？", confirmLabel: "删除", danger: true }))) return;
    const result = await run(() => window.imageStudio.projects.delete(project.id), { fallbackError: "删除失败" });
    if (!result) return;
    // 已删除项目的展开态一并收起，避免留下空壳。
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(project.id);
      return next;
    });
    notify("项目已删除，图片已移回收件箱");
    await onChanged();
  };

  return (
    <>
      <div className="sidebar-projects-head">
        <Tooltip content="任务队列">
          <button
            className={queueActive ? "nav sidebar-queue-nav active" : "nav sidebar-queue-nav"}
            data-mode="queue"
            onClick={onOpenQueue}
          >
            <NavIcon name="list-todo" size={18} />
            <span className="sidebar-queue-nav-label">任务队列</span>
            {queueCount > 0 && <span className="sidebar-queue-nav-badge">{queueCount}</span>}
          </button>
        </Tooltip>
        <Tooltip content="新建项目">
          <button
            className="sidebar-projects-add"
            aria-label="新建项目"
            disabled={pending}
            onClick={() => setCreating((current) => !current)}
          >
            <NavIcon name="plus" size={14} />
          </button>
        </Tooltip>
      </div>
      {creating && (
        <div className="sidebar-projects-new">
          <input
            autoFocus
            value={draftName}
            placeholder="新项目名称"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createProject();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setCreating(false);
                setDraftName("");
              }
            }}
          />
          <button disabled={pending || !draftName.trim()} onClick={() => void createProject()}>创建</button>
        </div>
      )}
      <section className="sidebar-projects" aria-label="项目">
        <div className="sidebar-project-list">
          {ordered.map((project) => {
            const list = grouped.get(project.id) ?? [];
            const open = expanded.has(project.id);
            return (
              <div className="sidebar-project" key={project.id}>
                <div className="sidebar-project-row">
                  <button className="sidebar-project-toggle" aria-expanded={open} onClick={() => toggleExpand(project.id)}>
                    <span className={open ? "sidebar-project-caret open" : "sidebar-project-caret"}>
                      <NavIcon name="chevron-right" size={12} />
                    </span>
                    <Tooltip content={project.name}>
                      <span className="sidebar-project-name">{project.name}</span>
                    </Tooltip>
                    <span className="sidebar-project-count">{list.length}</span>
                  </button>
                  {project.id !== INBOX_PROJECT_ID && (
                    <span className="sidebar-project-actions">
                      <Tooltip content="重命名">
                        <button aria-label="重命名项目" disabled={pending} onClick={() => void renameProject(project)}>
                          <NavIcon name="pen-line" size={12} />
                        </button>
                      </Tooltip>
                      <Tooltip content="删除">
                        <button aria-label="删除项目" disabled={pending} onClick={() => void deleteProject(project)}>
                          <NavIcon name="trash" size={12} />
                        </button>
                      </Tooltip>
                    </span>
                  )}
                </div>
                {/* v3.4：展开区始终渲染（不再条件挂载），由 .sidebar-project-body 的
                    grid-template-rows 0fr↔1fr 过渡实现平滑展开/收起；visibility 在收起动画
                    结束后才隐藏，故收起态的内部按钮不会成为 Tab 焦点。 */}
                <div className={open ? "sidebar-project-body open" : "sidebar-project-body"}>
                  <div className="sidebar-project-body-inner">
                    {list.length === 0 ? (
                      <p className="sidebar-project-empty">还没有图片</p>
                    ) : (
                      <div className="sidebar-project-items">
                        {list.slice(0, PREVIEW_LIMIT).map((item) => (
                          <Tooltip key={item.id} content={item.title}>
                            <button
                              className="sidebar-project-item"
                              onClick={() => onOpenImage(item.id)}
                            >
                              <GalleryThumb id={item.id} className="sidebar-project-item-thumb" alt={item.title} />
                              <span className="sidebar-project-item-text">
                                <span className="sidebar-project-item-title">{item.title || "未命名图片"}</span>
                                <span className="sidebar-project-item-time">{formatShortDate(item.createdAt)}</span>
                              </span>
                            </button>
                          </Tooltip>
                        ))}
                      </div>
                    )}
                    <button className="sidebar-project-more" onClick={() => onOpenProject(project.id)}>查看全部 ({list.length})</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
