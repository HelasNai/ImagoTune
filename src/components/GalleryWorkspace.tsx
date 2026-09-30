import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseTags, resolutionLevels } from "../lib/creative";
import { INBOX_PROJECT_ID } from "../lib/constants";
import { formatTags } from "../lib/format";
import { resolveFocusLocation } from "../lib/gallery-focus";
import { b64ToDataUrl } from "../lib/media";
import type { LocalAIAction } from "./LocalAIToolbox";
import { useDialog } from "./Dialogs";
import { callIpc } from "./ipc";
import { NavIcon } from "./icons";
import { ProgressBar } from "./ProgressBar";
import { useProgressEvent } from "./ProgressContext";
import type { StudioNotify } from "./StudioContext";

type OpenAction = "preview" | "reuse" | "edit" | "outpaint";
type CompareItem = { item: GalleryItem; b64: string };

/** 图库每页条数：refresh 的 search 与跨页聚焦的页码推导共用同一分页契约。 */
const GALLERY_PAGE_SIZE = 40;
/** 聚焦高亮持续时间（毫秒）。 */
const FOCUS_FLASH_MS = 2000;

export function GalleryWorkspace({
  onOpen,
  onVariation,
  onLocalAI,
  onNotice,
  focusImageId,
  onFocusConsumed,
}: {
  onOpen: (item: GalleryItem, b64: string, action: OpenAction) => void;
  onVariation: (item: GalleryItem) => void;
  onLocalAI: (item: GalleryItem, b64: string, action: LocalAIAction) => void;
  onNotice: StudioNotify;
  /** 跨页跳转目标：定位到该图片（切项目 → 翻页 → 滚动并短暂高亮）。 */
  focusImageId?: string;
  /** 跳转意图消费回调：定位完成或目标失效后调用一次，父级据此清空目标（图片级 / 项目级共用）。 */
  onFocusConsumed?: () => void;
}) {
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  /** 导出 ZIP 的进度事件（主进程逐张推送；导出为单例操作，id 固定）。 */
  const exportProgress = useProgressEvent("gallery-export");
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
  // —— 跨页聚焦（focusImageId 驱动）：待落地的页码 / 待滚动的目标 / 网格容器等 ——
  const [pendingFocus, setPendingFocus] = useState<{ projectId: string; page: number } | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** 刷新请求序号：只用于「page 0 替换语义」的过期响应保护（见 refresh 内的检查）。 */
  const refreshSeqRef = useRef(0);
  /** 聚焦落地中：抑制自动刷新，等目标页确定后再拉取。 */
  const focusLandingRef = useRef(false);
  /** 已消费的聚焦 id：同一跳转意图只驱动一次；prop 清空时复位。 */
  const processedFocusRef = useRef<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  /** 聚焦流程要读取的最新值（不进入 effect 依赖，避免父级重渲染重启流程）。 */
  const focusEnvRef = useRef({ sort, onNotice, onFocusConsumed });

  const refresh = useCallback(async (targetPage = page) => {
    const seq = ++refreshSeqRef.current;
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
        pageSize: GALLERY_PAGE_SIZE,
      }), { fallbackError: "图库读取失败" });
      // 过期保护：page 0 是「替换」语义（挂载 / 筛选重置），只有它仍是最新一次刷新时才允许应用——
      // 否则聚焦跳页期间晚到的第 0 页响应会把目标页覆盖掉；page>0 是「加载更多」的累加语义，保持原样。
      if (targetPage === 0 && seq !== refreshSeqRef.current) return;
      const nextItems = result.items || [];
      setItems((current) => {
        if (targetPage === 0) return nextItems;
        const map = new Map(current.map((item) => [item.id, item]));
        nextItems.forEach((item) => map.set(item.id, item));
        return [...map.values()];
      });
      setTotal(result.total || 0);
    } catch (cause) {
      onNotice("图库读取失败：" + ((cause as Error).message || "请检查本地保存目录"), true);
    }
  }, [activeProject, favoriteOnly, page, query, resolutionFilter, seedFilter, sizeFilter, sort, tag]);

  useEffect(() => {
    // 聚焦落地期间跳过中间态刷新：等目标页确定后（见下方 pendingFocus effect）再拉取，
    // 避免用旧页码发出的请求污染 items。
    if (focusLandingRef.current) return;
    void refresh(page);
  }, [page, refresh]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [activeProject, favoriteOnly, query, resolutionFilter, seedFilter, sizeFilter, sort, tag]);

  // ——————————————— 跨页聚焦（focusImageId 驱动） ———————————————
  // 由 App 经 openGalleryAt 写入跳转意图；这里按三步落地：
  // ① 验证目标并解析项目与页码 → ② 切项目并在「筛选器重置」之后落页 → ③ 滚动高亮并消费意图。
  const consumeFocus = (focusId: string) => {
    if (processedFocusRef.current === focusId) return;
    processedFocusRef.current = focusId;
    focusEnvRef.current.onFocusConsumed?.();
  };

  // 同步聚焦流程要读取的最新值（每次渲染后更新）。
  useEffect(() => {
    focusEnvRef.current = { sort, onNotice, onFocusConsumed };
  });

  // 第一步：验证目标 id 并解析所属项目与页码。
  // 同一 id 只消费一次；prop 清空时复位标记，保证对同一图片的再次跳转仍然生效。
  useEffect(() => {
    if (!focusImageId) {
      processedFocusRef.current = null;
      return;
    }
    if (processedFocusRef.current === focusImageId) return;
    let active = true;
    void (async () => {
      // 悬空 id（已删除 / 图库重建为全新 uuid）一律优雅降级：提示 + 消费，绝不抛出。
      let exists = false;
      try {
        const response = await callIpc(() => window.imageStudio.gallery.loadImage(focusImageId), { fallbackError: "图片不存在或已被删除" });
        exists = response.ok !== false;
      } catch { /* callIpc 已抛出结构化错误，按不存在处理 */ }
      if (!active) return;
      if (!exists) {
        onNotice("图片不存在或已被删除", true);
        consumeFocus(focusImageId);
        return;
      }
      // 用全量（未分页）数据定位：页码 = 目标在「所属项目自身列表」中的位置换算（1 基）。
      let location: { projectId: string; page: number } | null = null;
      try {
        const workspace = await callIpc(() => window.imageStudio.gallery.workspace(), { fallbackError: "图库读取失败", onError: (message) => onNotice(message, true) });
        location = resolveFocusLocation(workspace.items || [], focusImageId, GALLERY_PAGE_SIZE, focusEnvRef.current.sort);
      } catch { /* callIpc 已上报 */ }
      if (!active) return;
      if (!location) {
        onNotice("图片不存在或已被删除", true);
        consumeFocus(focusImageId);
        return;
      }
      // 先切项目；页码由第二步在「筛选器重置」之后落地，并由 focusLandingRef 抑制中间态刷新。
      focusLandingRef.current = true;
      setScrollTarget(focusImageId);
      setPendingFocus({ projectId: location.projectId, page: location.page - 1 });
      setActiveProject(location.projectId);
    })();
    return () => { active = false; };
  }, [focusImageId, onNotice]);

  // 第二步：落到目标页（setActiveProject 与 setPendingFocus 同批提交，此刻 activeProject 必已生效）。
  // 必须声明在「筛选条件变化重置页码」effect 之后：两者同批执行，setPage 以最后者为准，
  // 否则目标页会被重置回第 0 页。这里顺带清空 items，让目标页以「替换」而非并集方式呈现。
  useEffect(() => {
    if (!pendingFocus) return;
    setItems([]);
    setPendingFocus(null);
    focusLandingRef.current = false;
    const pageChanged = page !== pendingFocus.page;
    setPage(pendingFocus.page);
    // 目标页恰好等于当前页时刷新 effect 不会触发（page 未变化），这里补一次拉取。
    if (!pageChanged) void refresh(pendingFocus.page);
  }, [page, pendingFocus, refresh]);

  // 第三步：目标页渲染完成后滚动到卡片并短暂高亮（~2s），然后消费跳转意图。
  useEffect(() => {
    if (!scrollTarget) return;
    if (pendingFocus) return; // 聚焦尚未落入目标页：等第二步完成后再滚动
    const node = gridRef.current?.querySelector<HTMLElement>(`[data-item-id="${scrollTarget}"]`);
    if (!node) return; // 目标页数据尚未就绪：等 items 更新后重试
    setScrollTarget(null);
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("archive-card-flash");
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      node.classList.remove("archive-card-flash");
    }, FOCUS_FLASH_MS);
    consumeFocus(scrollTarget);
  }, [items, pendingFocus, scrollTarget]);

  // 卸载时清理高亮定时器（避免对已卸载节点回调）。
  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

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

  // 交给操作系统：默认关联程序打开 / 在文件资源管理器中定位（仅传 id，绝对路径由主进程解析）。
  const openLocally = (item: GalleryItem, mode: "open" | "reveal") => {
    void callIpc(
      () => window.imageStudio.gallery.openLocal(item.id, mode),
      { fallbackError: mode === "reveal" ? "无法定位文件" : "无法打开文件", onError: (message) => onNotice(message, true) },
    ).catch(() => { /* callIpc 已上报 */ });
  };

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

        {exportProgress && exportProgress.state === "running" ? <ProgressBar event={exportProgress} /> : null}

        {items.length === 0 ? (
          <div className="empty">
            <span><NavIcon name="images" size={40} /></span>
            <p>这里还没有图片</p>
            <small>生成完成后会自动归档到收件箱或你选择的项目。</small>
          </div>
        ) : (
          <div className="archive-grid" ref={gridRef}>
            {items.map((item) => (
              <article className={selected.has(item.id) ? "archive-card selected" : "archive-card"} key={item.id} data-item-id={item.id}>
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
                    <button onClick={() => openLocally(item, "open")}>用系统应用打开</button>
                    <button onClick={() => openLocally(item, "reveal")}>在文件夹中显示</button>
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
