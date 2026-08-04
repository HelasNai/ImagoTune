import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const INBOX_PROJECT_ID = "inbox";
export type GalleryProject = { id: string; name: string; createdAt: string; updatedAt: string; coverId?: string };
export type GalleryItem = { id: string; fileName: string; title: string; prompt: string; model: string; size: string; quality?: string; ratio?: string; resolution?: string; mode: "generate" | "edit"; createdAt: string; favorite: boolean; projectId: string; tags: string[]; sourceId?: string; variationLabel?: string };
export type GalleryState = { version: 2; projects: GalleryProject[]; items: GalleryItem[] };
export type GallerySearch = { query?: string; favoriteOnly?: boolean; projectId?: string; tag?: string; sort?: "newest" | "oldest"; page?: number; pageSize?: number };

const now = () => new Date().toISOString();
export function createInitialState(): GalleryState { const timestamp = now(); return { version: 2, projects: [{ id: INBOX_PROJECT_ID, name: "收件箱", createdAt: timestamp, updatedAt: timestamp }], items: [] }; }
function normalizeTags(tags: unknown) { return Array.isArray(tags) ? [...new Set(tags.map(value => String(value).trim()).filter(Boolean))].slice(0, 20) : []; }
function normalizeItem(value: Partial<GalleryItem>): GalleryItem { return { id: String(value.id || randomUUID()), fileName: String(value.fileName || ""), title: String(value.title || value.prompt || "Untitled image").slice(0, 120), prompt: String(value.prompt || ""), model: String(value.model || "gpt-image-2"), size: String(value.size || "1024x1024"), quality: value.quality, ratio: value.ratio, resolution: value.resolution, mode: value.mode === "edit" ? "edit" : "generate", createdAt: String(value.createdAt || now()), favorite: Boolean(value.favorite), projectId: String(value.projectId || INBOX_PROJECT_ID), tags: normalizeTags(value.tags), sourceId: value.sourceId, variationLabel: value.variationLabel }; }
function normalizeProject(value: Partial<GalleryProject>): GalleryProject { const timestamp = now(); return { id: String(value.id || randomUUID()), name: String(value.name || "Untitled project").trim().slice(0, 80) || "Untitled project", createdAt: String(value.createdAt || timestamp), updatedAt: String(value.updatedAt || timestamp), coverId: value.coverId }; }
export function migrateGallery(raw: unknown): GalleryState {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { version?: number }).version === 2) {
    const value = raw as Partial<GalleryState>; const state = createInitialState(); state.projects = (Array.isArray(value.projects) ? value.projects : []).map(normalizeProject); state.items = (Array.isArray(value.items) ? value.items : []).map(normalizeItem);
    if (!state.projects.some(project => project.id === INBOX_PROJECT_ID)) state.projects.unshift(createInitialState().projects[0]);
    state.items = state.items.map(item => state.projects.some(project => project.id === item.projectId) ? item : { ...item, projectId: INBOX_PROJECT_ID }); return state;
  }
  const state = createInitialState(); if (Array.isArray(raw)) state.items = raw.map(value => normalizeItem({ ...(value as Partial<GalleryItem>), projectId: INBOX_PROJECT_ID })); return state;
}
export function searchGallery(state: GalleryState, input: GallerySearch = {}) {
  const query = (input.query || "").trim().toLowerCase(); const tag = (input.tag || "").trim().toLowerCase(); let items = [...state.items];
  if (query) items = items.filter(item => [item.title, item.prompt, item.model, item.size, item.ratio, item.tags.join(" ")].filter(Boolean).some(value => String(value).toLowerCase().includes(query)));
  if (input.favoriteOnly) items = items.filter(item => item.favorite); if (input.projectId) items = items.filter(item => item.projectId === input.projectId); if (tag) items = items.filter(item => item.tags.some(value => value.toLowerCase() === tag));
  items.sort((a, b) => input.sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)); const pageSize = Math.max(1, Math.min(100, input.pageSize || 40)); const page = Math.max(0, input.page || 0); return { items: items.slice(page * pageSize, (page + 1) * pageSize), total: items.length, page, pageSize };
}
export function createGalleryStore(galleryDir: string) {
  const indexPath = path.join(galleryDir, "index.json"); const backupPath = path.join(galleryDir, "index.v1.backup.json"); const thumbsDir = path.join(galleryDir, ".thumbs");
  async function read(): Promise<GalleryState> {
    await fs.mkdir(galleryDir, { recursive: true });
    try {
      const rawText = await fs.readFile(indexPath, "utf8"); const raw = JSON.parse(rawText) as unknown; const migrated = migrateGallery(raw);
      if (Array.isArray(raw)) { try { await fs.copyFile(indexPath, backupPath, fs.constants.COPYFILE_EXCL); } catch {} await write(migrated); } return migrated;
    } catch { const state = createInitialState(); await write(state); return state; }
  }
  async function write(state: GalleryState) { await fs.mkdir(galleryDir, { recursive: true }); await fs.writeFile(indexPath, JSON.stringify(state, null, 2), "utf8"); }
  async function addImages(images: Array<{ b64_json?: string }>, metadata: Omit<GalleryItem, "id" | "fileName" | "createdAt" | "favorite">, enabled: boolean) {
    if (!enabled) return [] as GalleryItem[]; const state = await read(); const created: GalleryItem[] = []; const projectId = state.projects.some(project => project.id === metadata.projectId) ? metadata.projectId : INBOX_PROJECT_ID; await fs.mkdir(galleryDir, { recursive: true });
    for (const image of images) {
      if (!image.b64_json) continue; const id = randomUUID(); const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.png`; const base64 = image.b64_json.replace(/^data:image\/\w+;base64,/, "");
      await fs.writeFile(path.join(galleryDir, fileName), Buffer.from(base64, "base64")); created.push({ ...metadata, id, fileName, createdAt: now(), favorite: false, projectId });
    }
    if (created.length) { state.items = [...created, ...state.items]; const project = state.projects.find(value => value.id === projectId); if (project) project.updatedAt = now(); await write(state); } return created;
  }
  async function load(id: string) { const state = await read(); const item = state.items.find(value => value.id === id); if (!item) return null; try { return { item, b64: (await fs.readFile(path.join(galleryDir, path.basename(item.fileName)))).toString("base64") }; } catch { return { item, b64: "" }; } }
  async function thumbnail(id: string) {
    const state = await read(); const item = state.items.find(value => value.id === id); if (!item) return null; await fs.mkdir(thumbsDir, { recursive: true }); const thumbPath = path.join(thumbsDir, `${id}.jpg`);
    try { const stat = await fs.stat(thumbPath); const sourceStat = await fs.stat(path.join(galleryDir, path.basename(item.fileName))); if (stat.mtimeMs >= sourceStat.mtimeMs) return (await fs.readFile(thumbPath)).toString("base64"); } catch {}
    return { sourcePath: path.join(galleryDir, path.basename(item.fileName)), thumbPath };
  }
  return { galleryDir, indexPath, thumbsDir, read, write, addImages, load, thumbnail, search: async (input: GallerySearch = {}) => searchGallery(await read(), input), getProjects: async () => (await read()).projects, readState: read, writeState: write };
}
export type GalleryStore = ReturnType<typeof createGalleryStore>;
