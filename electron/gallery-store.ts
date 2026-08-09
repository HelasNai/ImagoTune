import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ImageRecipeV1, normalizeRecipe } from "./image-recipe";
import { embedRecipeInPng, readRecipeFromPng } from "./png-metadata";

export const INBOX_PROJECT_ID = "inbox";
export type GalleryProject = { id: string; name: string; createdAt: string; updatedAt: string; coverId?: string };
export type GalleryItem = { id: string; fileName: string; title: string; createdAt: string; favorite: boolean; recipe: ImageRecipeV1 };
export type GalleryState = { version: 3; projects: GalleryProject[]; items: GalleryItem[] };
export type GallerySearch = {
  query?: string;
  favoriteOnly?: boolean;
  projectId?: string;
  tag?: string;
  resolution?: string;
  size?: string;
  seed?: string;
  sort?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
};

const now = () => new Date().toISOString();

async function replaceWithRetry(source: string, target: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}
export function createInitialState(): GalleryState {
  const timestamp = now();
  return { version: 3, projects: [{ id: INBOX_PROJECT_ID, name: "收件箱", createdAt: timestamp, updatedAt: timestamp }], items: [] };
}

function normalizeProject(value: Partial<GalleryProject>): GalleryProject {
  const timestamp = now();
  return {
    id: String(value.id || randomUUID()),
    name: String(value.name || "Untitled project").trim().slice(0, 80) || "Untitled project",
    createdAt: String(value.createdAt || timestamp),
    updatedAt: String(value.updatedAt || timestamp),
    coverId: value.coverId,
  };
}

function normalizeItem(value: Record<string, unknown>): GalleryItem {
  const legacyMode = value.mode === "edit" ? "edit" : "generate";
  const recipeInput = value.recipe && typeof value.recipe === "object"
    ? { recipe: value.recipe }
    : value;
  const recipe = normalizeRecipe(recipeInput as Record<string, unknown>, legacyMode);
  const createdAt = String(value.createdAt || recipe.createdAt || now());
  recipe.createdAt = createdAt;
  return {
    id: String(value.id || randomUUID()),
    fileName: String(value.fileName || ""),
    title: String(value.title || recipe.prompt || "Untitled image").slice(0, 120),
    createdAt,
    favorite: Boolean(value.favorite),
    recipe,
  };
}

export function migrateGallery(raw: unknown): GalleryState {
  const state = createInitialState();
  if (Array.isArray(raw)) {
    state.items = raw.map((value) => normalizeItem({ ...(value as Record<string, unknown>), projectId: INBOX_PROJECT_ID }));
    return state;
  }
  if (!raw || typeof raw !== "object") return state;
  const value = raw as { projects?: unknown; items?: unknown };
  state.projects = Array.isArray(value.projects) ? value.projects.map((project) => normalizeProject(project as Partial<GalleryProject>)) : [];
  if (!state.projects.some((project) => project.id === INBOX_PROJECT_ID)) state.projects.unshift(createInitialState().projects[0]);
  state.items = Array.isArray(value.items) ? value.items.map((item) => normalizeItem(item as Record<string, unknown>)) : [];
  state.items = state.items.map((item) => state.projects.some((project) => project.id === item.recipe.projectId)
    ? item
    : { ...item, recipe: { ...item.recipe, projectId: INBOX_PROJECT_ID } });
  return state;
}

export function searchGallery(state: GalleryState, input: GallerySearch = {}) {
  const query = (input.query || "").trim().toLowerCase();
  const tag = (input.tag || "").trim().toLowerCase();
  const seed = (input.seed || "").trim().toLowerCase();
  let items = [...state.items];
  if (query) {
    items = items.filter((item) => [
      item.title,
      item.recipe.prompt,
      item.recipe.negativePrompt,
      item.recipe.model,
      item.recipe.size,
      item.recipe.ratio,
      item.recipe.seed,
      item.recipe.tags.join(" "),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }
  if (input.favoriteOnly) items = items.filter((item) => item.favorite);
  if (input.projectId) items = items.filter((item) => item.recipe.projectId === input.projectId);
  if (tag) items = items.filter((item) => item.recipe.tags.some((value) => value.toLowerCase() === tag));
  if (input.resolution) items = items.filter((item) => item.recipe.resolution === input.resolution);
  if (input.size) items = items.filter((item) => item.recipe.size === input.size);
  if (seed) items = items.filter((item) => item.recipe.seed?.toLowerCase().includes(seed));
  items.sort((a, b) => input.sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
  const pageSize = Math.max(1, Math.min(100, input.pageSize || 40));
  const page = Math.max(0, input.page || 0);
  return { items: items.slice(page * pageSize, (page + 1) * pageSize), total: items.length, page, pageSize };
}

export function createGalleryStore(galleryDir: string) {
  const indexPath = path.join(galleryDir, "index.json");
  const backupPath = path.join(galleryDir, "index.v2.backup.json");
  const thumbsDir = path.join(galleryDir, ".thumbs");

  async function write(state: GalleryState) {
    await fs.mkdir(galleryDir, { recursive: true });
    const temporaryPath = indexPath + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
      await replaceWithRetry(temporaryPath, indexPath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async function rebuildFromPngFiles() {
    const state = createInitialState();
    const entries = await fs.readdir(galleryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".png") continue;
      const filePath = path.join(galleryDir, entry.name);
      try {
        const [buffer, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
        const embedded = readRecipeFromPng(buffer);
        const createdAt = embedded?.createdAt || stat.birthtime.toISOString() || stat.mtime.toISOString();
        const recipe = normalizeRecipe({
          recipe: embedded || {
            prompt: "恢复的历史图片",
            mode: "generate",
            projectId: INBOX_PROJECT_ID,
            createdAt,
          },
        });
        recipe.projectId = INBOX_PROJECT_ID;
        state.items.push({
          id: randomUUID(),
          fileName: entry.name,
          title: recipe.prompt || "恢复的历史图片",
          createdAt,
          favorite: false,
          recipe,
        });
      } catch {
        // 单个损坏图片不阻断其他原图的恢复。
      }
    }
    state.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return state;
  }

  async function read(): Promise<GalleryState> {
    await fs.mkdir(galleryDir, { recursive: true });
    try {
      const rawText = await fs.readFile(indexPath, "utf8");
      const raw = JSON.parse(rawText) as unknown;
      const migrated = migrateGallery(raw);
      if (!raw || typeof raw !== "object" || (raw as { version?: number }).version !== 3) {
        try { await fs.copyFile(indexPath, backupPath, fs.constants.COPYFILE_EXCL); } catch {}
        await write(migrated);
      }
      return migrated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      if (error instanceof SyntaxError) {
        const corruptPath = path.join(galleryDir, `index.corrupt-${Date.now()}.json`);
        await fs.copyFile(indexPath, corruptPath).catch(() => undefined);
        try {
          const backup = migrateGallery(JSON.parse(await fs.readFile(backupPath, "utf8")) as unknown);
          await write(backup);
          return backup;
        } catch {
          const rebuilt = await rebuildFromPngFiles();
          await write(rebuilt);
          return rebuilt;
        }
      }
      const state = createInitialState();
      await write(state);
      return state;
    }
  }

  async function addImages(
    images: Array<{ b64_json?: string; seed?: string | number }>,
    metadata: { title: string; recipe: ImageRecipeV1 },
    enabled: boolean,
  ) {
    if (!enabled) return [] as GalleryItem[];
    const state = await read();
    const created: GalleryItem[] = [];
    const projectId = state.projects.some((project) => project.id === metadata.recipe.projectId)
      ? metadata.recipe.projectId
      : INBOX_PROJECT_ID;
    await fs.mkdir(galleryDir, { recursive: true });
    for (const image of images) {
      if (!image.b64_json) continue;
      const id = randomUUID();
      const createdAt = now();
      const recipe: ImageRecipeV1 = {
        ...metadata.recipe,
        projectId,
        createdAt,
        seed: image.seed === undefined ? metadata.recipe.seed : String(image.seed),
      };
      const fileName = `${createdAt.replace(/[:.]/g, "-")}-${id}.png`;
      const base64 = image.b64_json.replace(/^data:image\/\w+;base64,/, "");
      const png = embedRecipeInPng(Buffer.from(base64, "base64"), recipe);
      await fs.writeFile(path.join(galleryDir, fileName), png);
      created.push({ id, fileName, title: metadata.title, createdAt, favorite: false, recipe });
    }
    if (created.length) {
      state.items = [...created, ...state.items];
      const project = state.projects.find((value) => value.id === projectId);
      if (project) project.updatedAt = now();
      await write(state);
    }
    return created;
  }

  async function load(id: string) {
    const state = await read();
    const item = state.items.find((value) => value.id === id);
    if (!item) return null;
    try { return { item, b64: (await fs.readFile(path.join(galleryDir, path.basename(item.fileName)))).toString("base64") }; }
    catch { return { item, b64: "" }; }
  }

  async function thumbnail(id: string) {
    const state = await read();
    const item = state.items.find((value) => value.id === id);
    if (!item) return null;
    await fs.mkdir(thumbsDir, { recursive: true });
    const thumbPath = path.join(thumbsDir, `${id}.jpg`);
    try {
      const stat = await fs.stat(thumbPath);
      const sourceStat = await fs.stat(path.join(galleryDir, path.basename(item.fileName)));
      if (stat.mtimeMs >= sourceStat.mtimeMs) return (await fs.readFile(thumbPath)).toString("base64");
    } catch {}
    return { sourcePath: path.join(galleryDir, path.basename(item.fileName)), thumbPath };
  }

  return {
    galleryDir,
    indexPath,
    backupPath,
    thumbsDir,
    read,
    write,
    addImages,
    load,
    thumbnail,
    search: async (input: GallerySearch = {}) => searchGallery(await read(), input),
    getProjects: async () => (await read()).projects,
    readState: read,
    writeState: write,
  };
}

export type GalleryStore = ReturnType<typeof createGalleryStore>;
