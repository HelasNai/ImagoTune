import React, { useCallback, useEffect, useMemo, useState } from "react";
import { parseTags, resolutionLevels } from "../lib/creative";
import { INBOX_PROJECT_ID } from "../lib/constants";
import { formatTags } from "../lib/format";
import { b64ToDataUrl } from "../lib/media";
import type { LocalAIAction } from "./LocalAIToolbox";
import { useDialog } from "./Dialogs";
import { callIpc } from "./ipc";
import { NavIcon } from "./icons";
import type { StudioNotify } from "./StudioContext";

type OpenAction = "preview" | "reuse" | "edit" | "outpaint";
type CompareItem = { item: GalleryItem; b64: string };

export function GalleryWorkspace({
  onOpen,
  onVariation,
  onLocalAI,
  onNotice,
}: {
  onOpen: (item: GalleryItem, b64: string, action: OpenAction) => void;
  onVariation: (item: GalleryItem) => void;
  onLocalAI: (item: GalleryItem, b64: string, action: LocalAIAction) => void;
  onNotice: StudioNotify;
}) {
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [activeProject, setActiveProject] = useState("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [resolutionFilter, setResolutionFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [seedFilter, setSeedFilter] = useState("");
  const [availableSizes, setAvailableSizes] = useState<string[]>([]);
  const [hasSeeds, setHasSeeds] = useState(false);
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newProject, setNewProject] = useState("");
  const [bulkProjectId, setBulkProjectId] = useState(INBOX_PROJECT_ID);
  const [bulkTags, setBulkTags] = useState("");
  const [compare, setCompare] = useState<CompareItem[]>([]);
  const { requestText, requestConfirm } = useDialog();

  const refresh = useCallback(async (targetPage = page) => {
    try {
      const workspace = await callIpc(() => window.imageStudio.gallery.workspace(), { fallbackError: "图库读取失败" });
      setProjects(workspace.projects || []);
      const allItems = workspace.items || [];
      setAvailableSizes([...new Set(allItems.map((item) => item.recipe.size).filter(Boolean))].sort());
      setHasSeeds(allItems.some((item) => Boolean(item.recipe.seed)));
      const result = await callIpc(() => window.imageStudio.gallery.search({
        query,
        tag,
        favoriteOnly,
        projectId: activeProject === "all" ? undefined : activeProject,
        resolution: resolutionFilter || undefined,
        size: sizeFilter || undefined,
        seed: seedFilter || undefined,
        sort,
        page: targetPage,
        pageSize: 40,
      }), { fallbackError: "图库读取失败" });
      const nextItems = result.items || [];
      setItems((current) => {
        if (targetPage === 0) return nextItems;
        const map = new Map(current.map((item) => [item.id, item]));
        nextItems.forEach((item) => map.set(item.id, item));
        return [...map.values()];
      });
      setTotal(result.total || 0);
    } catch (cause) {
      onNotice("图库读取失败：" + ((cause as Error).message || "请检查本地保存目录"));
    }
  }, [activeProject, favoriteOnly, page, query, resolutionFilter, seedFilter, sizeFilter, sort, tag]);

  useEffect(() => {
    void refresh(page);
  }, [page, refresh]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [activeProject, favoriteOnly, query, resolutionFilter, seedFilter, sizeFilter, sort, tag]);

  useEffect(() => {
    let active = true;
    const missing = items.filter((item) => !thumbs[item.id]);
    if (!missing.length) return () => { active = false; };
    void Promise.all(missing.map(async (item) => {
      const response = await callIpc(() => window.imageStudio.gallery.thumbnail(item.id), { fallbackError: "缩略图加载失败", onError: (message) => onNotice(message, true) });
      return [item.id, response.b64 || ""] as const;
    })).then((values) => {
      if (!active) return;
      setThumbs((current) => ({
        ...current,
        ...Object.fromEntries(values.filter(([, b64]) => Boolean(b64))),
      }));
    });
    return () => { active = false; };
  }, [items, thumbs]);

  const projectName = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const toggleSelection = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePageSelection = () => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = items.length > 0 && items.every((item) => next.has(item.id));
      items.forEach((item) => allSelected ? next.delete(item.id) : next.add(item.id));
      return next;
    });
  };

  // open / openLocalAI 共用同一段「按 id 读取图片 → 交给对应消费者」逻辑，避免逐字复制。
  const loadAndOpen = async (item: GalleryItem, consume: (b64: string) => void) => {
    const response = await callIpc(() => window.imageStudio.gallery.loadImage(item.id), { fallbackError: "无法读取图片", onError: (message) => onNotice(message, true) });
    if (response.b64) consume(response.b64);
  };

  const open = (item: GalleryItem, action: OpenAction) => loadAndOpen(item, (b64) => onOpen(item, b64, action));

  const openLocalAI = (item: GalleryItem, action: LocalAIAction) => loadAndOpen(item, (b64) => onLocalAI(item, b64, action));

  const createProject = async () => {
    const response = await callIpc(() => window.imageStudio.projects.create(newProject), { fallbackError: "创建项目失败", onError: (message) => onNotice(message, true) });
    if (!response.ok) return;
    setNewProject("");
    await refresh(0);
    onNotice("项目已创建");
  };

  const renameProject = async (project: GalleryProject) => {
    const name = await requestText({ title: "重命名项目", message: "输入新的项目名称", defaultValue: project.name, confirmLabel: "重命名" });
    if (!name?.trim()) return;
    const response = await callIpc(() => window.imageStudio.projects.rename(project.id, name), { fallbackError: "重命名失败", onError: (message) => onNotice(message, true) });
    if (response.ok) onNotice("项目已重命名");
    await refresh(0);
  };

  const deleteProject = async (project: GalleryProject) => {
    if (!(await requestConfirm({ title: "删除项目", message: "删除项目后，其中图片会回到收件箱，确定继续吗？", confirmLabel: "删除", danger: true }))) return;
    const response = await callIpc(() => window.imageStudio.projects.delete(project.id), { fallbackError: "删除失败", onError: (message) => onNotice(message, true) });
    if (activeProject === project.id) setActiveProject("all");
    if (response.ok) onNotice("项目已删除，图片已移回收件箱");
    await refresh(0);
  };

  const updateMetadata = async (item: GalleryItem) => {
    const title = await requestText({ title: "编辑图片标题", defaultValue: item.title });
    if (title === null) return;
    const tags = await requestText({ title: "编辑标签", message: "用逗号分隔", defaultValue: formatTags(item.recipe.tags) });
    const response = await callIpc(() => window.imageStudio.gallery.update(item.id, {
      title,
      tags: tags === null ? item.recipe.tags : parseTags(tags),
    }), { fallbackError: "更新失败", onError: (message) => onNotice(message, true) });
    if (response.ok) onNotice("图片信息已更新");
    await refresh(0);
  };

  const bulk = async (
    action: "move" | "favorite" | "delete" | "tags",
    extra: Record<string, unknown> = {},
  ) => {
    const ids = [...selected];
    if (!ids.length) {
      onNotice("请先选择图片");
      return;
    }
    if (action === "delete" && !(await requestConfirm({ title: "删除所选图片", message: "删除所选图片及原始 PNG 文件吗？", confirmLabel: "删除", danger: true }))) return;
    const response = await callIpc(() => window.imageStudio.gallery.bulk({ ids, action, ...extra }), { fallbackError: "操作失败", onError: (message) => onNotice(message, true) });
    if (response.ok) {
      onNotice("已处理 " + String(response.count || ids.length) + " 张图片");
      setSelected(new Set());
    }
    await refresh(0);
  };

  const exportZip = async () => {
    if (!selected.size) {
      onNotice("请先选择需要导出的图片");
      return;
    }
    const response = await callIpc(() => window.imageStudio.gallery.exportZip([...selected]), { fallbackError: "导出失败", onError: (message) => onNotice(message, true) });
    if (response.ok && !response.canceled) onNotice("ZIP 已导出：" + (response.path || ""));
  };

  const compareSelected = async () => {
    const candidates = items.filter((item) => selected.has(item.id)).slice(0, 4);
    if (candidates.length < 2) {
      onNotice("请至少选择两张图片进行对比");
      return;
    }
    const results = await Promise.all(candidates.map(async (item) => {
      const response = await callIpc(() => window.imageStudio.gallery.loadImage(item.id), { fallbackError: "无法读取图片", onError: (message) => onNotice(message, true) });
      return { item, b64: response.b64 || "" };
    }));
    setCompare(results.filter((value) => Boolean(value.b64)));
  };

  const setCover = async (item: GalleryItem) => {
    if (item.recipe.projectId === INBOX_PROJECT_ID) {
      onNotice("收件箱没有项目封面，请先把图片移入一个项目");
      return;
    }
    const response = await callIpc(() => window.imageStudio.projects.setCover(item.recipe.projectId, item.id), { fallbackError: "设置失败", onError: (message) => onNotice(message, true) });
    if (response.ok) onNotice("已设为项目封面");
    await refresh(0);
  };

  return (
    <section className="gallery-workbench" data-tutorial="gallery-workspace">
      <section className="workspace-sidebar">
        <span className="eyebrow">PROJECTS</span>
        <h3>创作项目</h3>
        <div className="project-list">
          <div className={activeProject === "all" ? "project-row active" : "project-row"}>
            <button onClick={() => setActiveProject("all")}>全部图库</button>
          </div>
          {projects.map((project) => (
            <div className={activeProject === project.id ? "project-row active" : "project-row"} key={project.id}>
              <button onClick={() => setActiveProject(project.id)}>
                {project.name}{project.id === INBOX_PROJECT_ID ? "（收件箱）" : ""}
              </button>
              {project.id !== INBOX_PROJECT_ID && (
                <>
                  <button className="project-action" onClick={() => void renameProject(project)}><NavIcon name="pen-line" size={14} /></button>
                  <button className="project-action" onClick={() => void deleteProject(project)}><NavIcon name="trash" size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="new-project">
          <input
            value={newProject}
            onChange={(event) => setNewProject(event.target.value)}
            placeholder="新项目名称"
            onKeyDown={(event) => { if (event.key === "Enter") void createProject(); }}
          />
          <button onClick={() => void createProject()}>新建项目</button>
        </div>
      </section>

      <div className="gallery-main">
        <div className="section-head">
          <div>
            <span className="eyebrow">LOCAL LIBRARY</span>
            <h2>{activeProject === "all" ? "本地图库" : projectName.get(activeProject) || "项目图库"}</h2>
            <small>图片原文件始终保存在本地；删除项目只会将图片移回收件箱。</small>
          </div>
          <span className="muted">{total} 张</span>
        </div>

        <div className="gallery-toolbar">
          <label className="toolbar-search">关键词
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、提示词、模型、尺寸或标签" />
          </label>
          <label className="toolbar-tag">标签
            <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="筛选标签" />
          </label>
          <label>清晰度
            <select value={resolutionFilter} onChange={(event) => setResolutionFilter(event.target.value)}>
              <option value="">全部</option>
              {resolutionLevels.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
            </select>
          </label>
          <label>精确分辨率
            <select value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}>
              <option value="">全部尺寸</option>
              {availableSizes.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          {hasSeeds && <label>Seed
            <input value={seedFilter} onChange={(event) => setSeedFilter(event.target.value)} placeholder="搜索真实 Seed" />
          </label>}
          <label className="favorite-toggle">
            <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
            仅收藏
          </label>
          <label className="toolbar-sort">排序
            <select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest")}>
              <option value="newest">最新优先</option>
              <option value="oldest">最早优先</option>
            </select>
          </label>
        </div>

          <div className="bulk-toolbar">
            <div className="bulk-summary">
              <strong>已选择 {selected.size} 张</strong>
              <span>可批量归类、标注和导出</span>
              <button className="select-page" onClick={togglePageSelection} disabled={!items.length}>
                {items.length > 0 && items.every((item) => selected.has(item.id)) ? "取消全选本页" : "全选本页"}
              </button>
            </div>
            <div className="bulk-group">
            <label>移动到项目
              <select value={bulkProjectId} onChange={(event) => setBulkProjectId(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <button disabled={!selected.size} onClick={() => void bulk("move", { projectId: bulkProjectId })}>移动</button>
          </div>
          <div className="bulk-group">
            <label>批量标签
              <input value={bulkTags} onChange={(event) => setBulkTags(event.target.value)} placeholder="用逗号分隔" />
            </label>
            <button disabled={!selected.size} onClick={() => void bulk("tags", { tags: parseTags(bulkTags) })}>更新</button>
          </div>
          <div className="bulk-actions">
            <button disabled={!selected.size} onClick={() => void bulk("favorite", { favorite: true })}>收藏</button>
            <button disabled={selected.size < 2} onClick={() => void compareSelected()}>对比</button>
            <button disabled={!selected.size} onClick={() => void exportZip()}>导出 ZIP</button>
            <button className="danger" disabled={!selected.size} onClick={() => void bulk("delete")}>删除</button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <span><NavIcon name="images" size={40} /></span>
            <p>这里还没有图片</p>
            <small>生成完成后会自动归档到收件箱或你选择的项目。</small>
          </div>
        ) : (
          <div className="archive-grid">
            {items.map((item) => (
              <article className={selected.has(item.id) ? "archive-card selected" : "archive-card"} key={item.id}>
                <label className="select-box">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelection(item.id)} />
                </label>
                <button className={thumbs[item.id] ? "archive-preview" : "archive-preview loading"} onClick={() => void open(item, "preview")}>
                  {thumbs[item.id] ? <img src={b64ToDataUrl(thumbs[item.id], "image/jpeg")} alt={item.title} /> : <span>加载预览…</span>}
                </button>
                <div className="archive-meta">
                  <strong>{item.title}</strong>
                  <small>{item.recipe.size} · {item.recipe.model}{item.recipe.seed ? " · Seed " + item.recipe.seed : ""}</small>
                  <p>{item.recipe.prompt}</p>
                  <div className="tag-row">{item.recipe.tags.map((value) => <span key={value}>#{value}</span>)}</div>
                </div>
                <div className="card-actions">
                  <button onClick={() => void open(item, "preview")}>预览</button>
                  <button onClick={() => void open(item, "reuse")}>复用</button>
                  <button onClick={() => void open(item, "edit")}>继续编辑</button>
                  <button onClick={() => void open(item, "outpaint")}>智能扩图</button>
                </div>
                <details className="card-more">
                  <summary><NavIcon name="chevron-right" size={12} />更多操作</summary>
                  <div>
                    <button onClick={() => onVariation(item)}>创建变体</button>
                    <button onClick={() => void openLocalAI(item, "upscale")}>高清放大</button>
                    <button onClick={() => void openLocalAI(item, "remove-background")}>智能抠图</button>
                    <button onClick={() => void openLocalAI(item, "face-restore")}>人脸优化 Beta</button>
                    <button onClick={() => void openLocalAI(item, "pipeline")}>本地组合处理</button>
                    <button onClick={() => void callIpc(() => window.imageStudio.gallery.toggleFavorite(item.id), { fallbackError: "收藏操作失败", onError: (message) => onNotice(message, true) }).then(() => refresh(0)).catch(() => { /* callIpc 已上报 */ })}>
                      {item.favorite ? "取消收藏" : "收藏"}
                    </button>
                    <button onClick={() => void updateMetadata(item)}>编辑信息</button>
                    {item.recipe.projectId !== INBOX_PROJECT_ID && <button onClick={() => void setCover(item)}>设为封面</button>}
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
        {total > items.length && (
          <button className="load-more" onClick={() => setPage((current) => current + 1)}>加载下一页</button>
        )}
      </div>

      {compare.length > 0 && (
        <div className="compare-modal" onClick={() => setCompare([])}>
          <section onClick={(event) => event.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setCompare([])}><NavIcon name="x" size={20} /></button>
            <span className="eyebrow">COMPARE</span>
            <h2>图片对比</h2>
            <div className="compare-grid">
              {compare.map((value) => (
                <article key={value.item.id}>
                  <img src={b64ToDataUrl(value.b64)} alt={value.item.title} />
                  <strong>{value.item.title}</strong>
                  <button onClick={() => void setCover(value.item)}>设为项目封面</button>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
