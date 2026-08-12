import React, { useCallback, useEffect, useMemo, useState } from "react";
import { parseTags } from "../lib/creative";
import type { LocalAIAction } from "./LocalAIToolbox";

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
  onNotice: (message: string) => void;
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
  const [bulkProjectId, setBulkProjectId] = useState("inbox");
  const [bulkTags, setBulkTags] = useState("");
  const [compare, setCompare] = useState<CompareItem[]>([]);

  const refresh = useCallback(async (targetPage = page) => {
    try {
      const workspace = await window.imageStudio.gallery.workspace();
      setProjects(workspace.projects || []);
      const allItems = workspace.items || [];
      setAvailableSizes([...new Set(allItems.map((item) => item.recipe.size).filter(Boolean))].sort());
      setHasSeeds(allItems.some((item) => Boolean(item.recipe.seed)));
      const result = await window.imageStudio.gallery.search({
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
      });
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
      const response = await window.imageStudio.gallery.thumbnail(item.id);
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

  const open = async (item: GalleryItem, action: OpenAction) => {
    const response = await window.imageStudio.gallery.loadImage(item.id);
    if (response.b64) onOpen(item, response.b64, action);
    else onNotice(response.error || "无法读取图片");
  };

  const openLocalAI = async (item: GalleryItem, action: LocalAIAction) => {
    const response = await window.imageStudio.gallery.loadImage(item.id);
    if (response.b64) onLocalAI(item, response.b64, action);
    else onNotice(response.error || "无法读取图片");
  };

  const createProject = async () => {
    const response = await window.imageStudio.projects.create(newProject);
    if (!response.ok) {
      onNotice(response.error || "创建项目失败");
      return;
    }
    setNewProject("");
    await refresh(0);
    onNotice("项目已创建");
  };

  const renameProject = async (project: GalleryProject) => {
    const name = window.prompt("项目名称", project.name);
    if (!name?.trim()) return;
    const response = await window.imageStudio.projects.rename(project.id, name);
    onNotice(response.ok ? "项目已重命名" : response.error || "重命名失败");
    await refresh(0);
  };

  const deleteProject = async (project: GalleryProject) => {
    const message = "删除项目后，其中图片会回到收件箱，确定继续吗？";
    if (!window.confirm(message)) return;
    const response = await window.imageStudio.projects.delete(project.id);
    if (activeProject === project.id) setActiveProject("all");
    onNotice(response.ok ? "项目已删除，图片已移回收件箱" : response.error || "删除失败");
    await refresh(0);
  };

  const updateMetadata = async (item: GalleryItem) => {
    const title = window.prompt("图片标题", item.title);
    if (title === null) return;
    const tags = window.prompt("标签（用逗号分隔）", item.recipe.tags.join("，"));
    const response = await window.imageStudio.gallery.update(item.id, {
      title,
      tags: tags === null ? item.recipe.tags : parseTags(tags),
    });
    onNotice(response.ok ? "图片信息已更新" : response.error || "更新失败");
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
    if (action === "delete" && !window.confirm("删除所选图片及原始 PNG 文件吗？")) return;
    const response = await window.imageStudio.gallery.bulk({ ids, action, ...extra });
    onNotice(response.ok
      ? "已处理 " + String(response.count || ids.length) + " 张图片"
      : response.error || "操作失败");
    if (response.ok) setSelected(new Set());
    await refresh(0);
  };

  const exportZip = async () => {
    if (!selected.size) {
      onNotice("请先选择需要导出的图片");
      return;
    }
    const response = await window.imageStudio.gallery.exportZip([...selected]);
    if (!response.ok) onNotice(response.error || "导出失败");
    else if (!response.canceled) onNotice("ZIP 已导出：" + (response.path || ""));
  };

  const compareSelected = async () => {
    const candidates = items.filter((item) => selected.has(item.id)).slice(0, 4);
    if (candidates.length < 2) {
      onNotice("请至少选择两张图片进行对比");
      return;
    }
    const results = await Promise.all(candidates.map(async (item) => {
      const response = await window.imageStudio.gallery.loadImage(item.id);
      return { item, b64: response.b64 || "" };
    }));
    setCompare(results.filter((value) => Boolean(value.b64)));
  };

  const setCover = async (item: GalleryItem) => {
    if (item.recipe.projectId === "inbox") {
      onNotice("收件箱没有项目封面，请先把图片移入一个项目");
      return;
    }
    const response = await window.imageStudio.projects.setCover(item.recipe.projectId, item.id);
    onNotice(response.ok ? "已设为项目封面" : response.error || "设置失败");
    await refresh(0);
  };

  return (
    <section className="gallery-workbench">
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
                {project.name}{project.id === "inbox" ? "（收件箱）" : ""}
              </button>
              {project.id !== "inbox" && (
                <>
                  <button className="project-action" onClick={() => void renameProject(project)}>✎</button>
                  <button className="project-action" onClick={() => void deleteProject(project)}>×</button>
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
              <option value="1k">1K</option>
              <option value="2k">2K</option>
              <option value="4k">4K</option>
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
            <span>▧</span>
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
                  {thumbs[item.id] ? <img src={"data:image/jpeg;base64," + thumbs[item.id]} alt={item.title} /> : <span>加载预览…</span>}
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
                  <summary>更多操作</summary>
                  <div>
                    <button onClick={() => onVariation(item)}>创建变体</button>
                    <button onClick={() => void openLocalAI(item, "upscale")}>高清放大</button>
                    <button onClick={() => void openLocalAI(item, "remove-background")}>智能抠图</button>
                    <button onClick={() => void openLocalAI(item, "face-restore")}>人脸优化 Beta</button>
                    <button onClick={() => void openLocalAI(item, "pipeline")}>本地组合处理</button>
                    <button onClick={() => void window.imageStudio.gallery.toggleFavorite(item.id).then(() => refresh(0))}>
                      {item.favorite ? "取消收藏" : "收藏"}
                    </button>
                    <button onClick={() => void updateMetadata(item)}>编辑信息</button>
                    {item.recipe.projectId !== "inbox" && <button onClick={() => void setCover(item)}>设为封面</button>}
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
            <button className="lightbox-close" onClick={() => setCompare([])}>×</button>
            <span className="eyebrow">COMPARE</span>
            <h2>图片对比</h2>
            <div className="compare-grid">
              {compare.map((value) => (
                <article key={value.item.id}>
                  <img src={"data:image/png;base64," + value.b64} alt={value.item.title} />
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
