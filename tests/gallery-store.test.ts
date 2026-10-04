import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInitialState, createGalleryStore, migrateGallery, searchGallery } from "../electron/gallery-store";
import { embedRecipeInPng } from "../electron/png-metadata";
import { setLocale } from "../src/lib/i18n";
import { galleryItemTitle, projectDisplayName } from "../src/lib/gallery";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("gallery migration and search", () => {
  it("migrates legacy array items to the inbox project", () => {
    const state = migrateGallery([{ id: "legacy-1", prompt: "蓝色海报", size: "1024x1024" }]);
    expect(state.version).toBe(3);
    expect(state.projects[0].id).toBe("inbox");
    expect(state.items[0].recipe.projectId).toBe("inbox");
    expect(state.items[0].recipe.prompt).toBe("蓝色海报");
  });

  it("filters favorites, tags, projects and pages in a stable order", () => {
    const state = createInitialState();
    state.items = [
      { id: "a", fileName: "a.png", title: "海报 A", createdAt: "2025-01-01T00:00:00.000Z", favorite: true, recipe: { version: 1, prompt: "blue", negativePrompt: "watermark", model: "gpt-image-2", size: "1024x1024", resolution: "1k", mode: "generate", n: 1, createdAt: "2025-01-01T00:00:00.000Z", projectId: "inbox", tags: ["科技"], seed: "12345" } },
      { id: "b", fileName: "b.png", title: "产品 B", createdAt: "2025-01-02T00:00:00.000Z", favorite: false, recipe: { version: 1, prompt: "red", negativePrompt: "", model: "gpt-image-2", size: "1536x1024", resolution: "2k", mode: "generate", n: 1, createdAt: "2025-01-02T00:00:00.000Z", projectId: "inbox", tags: ["产品"] } },
    ];
    expect(searchGallery(state, { favoriteOnly: true }).items.map((item) => item.id)).toEqual(["a"]);
    expect(searchGallery(state, { query: "1536x1024" }).items.map((item) => item.id)).toEqual(["b"]);
    expect(searchGallery(state, { resolution: "1k", seed: "234" }).items.map((item) => item.id)).toEqual(["a"]);
    expect(searchGallery(state, { size: "1536x1024" }).items.map((item) => item.id)).toEqual(["b"]);
    expect(searchGallery(state, { page: 1, pageSize: 1 }).items.map((item) => item.id)).toEqual(["a"]);
  });

  it("preserves a corrupt index and rebuilds records from PNG recipes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-gallery-recovery-"));
    try {
      const recipe = { version: 1 as const, prompt: "恢复海报", negativePrompt: "", model: "gpt-image-2", size: "1024x1024", n: 1, mode: "generate" as const, projectId: "inbox", tags: [], createdAt: "2025-01-01T00:00:00.000Z" };
      await writeFile(path.join(directory, "recovered.png"), embedRecipeInPng(onePixelPng, recipe));
      await writeFile(path.join(directory, "index.json"), "{ broken json");
      const state = await createGalleryStore(directory).read();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].recipe.prompt).toBe("恢复海报");
      // T29：内嵌配方的恢复项保留真实 prompt，不置 recovered 标记（用户内容冻结、不翻译）。
      expect(state.items[0].recipe.recovered).toBeUndefined();
      const files = await import("node:fs/promises").then((fs) => fs.readdir(directory));
      expect(files.some((name) => name.startsWith("index.corrupt-") && name.endsWith(".json"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks recipe-less PNG rebuilds as recovered and keeps the marker across reads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "image-studio-gallery-recovered-"));
    try {
      // 无内嵌配方的 PNG：默认名分支 → 写 recovered 标记。
      await writeFile(path.join(directory, "plain.png"), onePixelPng);
      await writeFile(path.join(directory, "index.json"), "{ broken json");
      const rebuilt = await createGalleryStore(directory).read();
      const plain = rebuilt.items.find((item) => item.fileName === "plain.png");
      expect(plain?.recipe.recovered).toBe(true);
      expect(plain?.title).toBe("恢复的历史图片");
      // 再次读取：标记须经 migrateGallery → normalizeRecipe 往返后仍保留（否则重启即丢）。
      const again = await createGalleryStore(directory).read();
      expect(again.items.find((item) => item.fileName === "plain.png")?.recipe.recovered).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the persisted inbox project name untouched so the renderer can override by id", () => {
    const state = migrateGallery({
      version: 3,
      projects: [{ id: "inbox", name: "旧名字", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }],
      items: [],
    });
    // 存储层不迁移/不翻译：历史 name（含 "收件箱"）原样保留，显示名由渲染层按 id 决定。
    expect(state.projects.find((project) => project.id === "inbox")?.name).toBe("旧名字");
    expect(createInitialState().projects[0].name).toBe("收件箱");
  });
});

describe("gallery display helpers (T29)", () => {
  afterEach(() => setLocale("zh"));

  it("renders the inbox project by id and ignores its stored name", () => {
    const inbox = { id: "inbox", name: "收件箱" };
    expect(projectDisplayName(inbox)).toBe("收件箱");
    setLocale("en");
    expect(projectDisplayName(inbox)).toBe("Inbox");
    // 非收件箱项目保持存储 name（用户内容，不翻译）。
    expect(projectDisplayName({ id: "p1", name: "我的项目" })).toBe("我的项目");
  });

  it("translates recovered defaults and local-AI action codes, freezing user/legacy titles", () => {
    const recovered = { title: "恢复的历史图片", recipe: { recovered: true } };
    expect(galleryItemTitle(recovered)).toBe("恢复的历史图片");
    setLocale("en");
    expect(galleryItemTitle(recovered)).toBe("Recovered historical image");

    setLocale("zh");
    const localAI = { title: "源图 - matting", recipe: { variationLabel: "matting" } };
    expect(galleryItemTitle(localAI)).toBe("源图 - 智能抠图");
    setLocale("en");
    expect(galleryItemTitle(localAI)).toBe("源图 - Background removal");

    // 旧数据：variationLabel 为已本地化中文、无 recovered 标记 → 一律冻结原样。
    setLocale("zh");
    const legacy = { title: "旧图 - 高清放大", recipe: { variationLabel: "高清放大" } };
    expect(galleryItemTitle(legacy)).toBe("旧图 - 高清放大");
    setLocale("en");
    expect(galleryItemTitle(legacy)).toBe("旧图 - 高清放大");

    // 纯用户标题（无 code / 无标记）→ 冻结。
    expect(galleryItemTitle({ title: "用户自定义标题", recipe: {} })).toBe("用户自定义标题");
  });

  it("keeps user renames for recovered defaults and local-AI archives", () => {
    // recovered：用户重命名后标题不再等于恢复默认哨兵 → 冻结用户标题（zh/en 均不翻译、不覆盖）。
    const renamedRecovered = { title: "我的修复图", recipe: { recovered: true } };
    expect(galleryItemTitle(renamedRecovered)).toBe("我的修复图");
    setLocale("en");
    expect(galleryItemTitle(renamedRecovered)).toBe("我的修复图");

    // 本地 AI 归档：标题既非 ` - <code>` 后缀、也非裸 code（用户重命名）→ 冻结用户标题。
    setLocale("zh");
    const renamedLocalAI = { title: "客户海报 终稿", recipe: { variationLabel: "matting" } };
    expect(galleryItemTitle(renamedLocalAI)).toBe("客户海报 终稿");
    setLocale("en");
    expect(galleryItemTitle(renamedLocalAI)).toBe("客户海报 终稿");

    // 标题恰为 code（旧「title=code」写法）→ 仍返回当前语言标签。
    setLocale("zh");
    expect(galleryItemTitle({ title: "matting", recipe: { variationLabel: "matting" } })).toBe("智能抠图");
    setLocale("en");
    expect(galleryItemTitle({ title: "matting", recipe: { variationLabel: "matting" } })).toBe("Background removal");

    // 正常归档（标题尾部 ` - <code>`）→ 替换后缀、保留用户源标题。
    setLocale("en");
    expect(galleryItemTitle({ title: "源图 - upscale", recipe: { variationLabel: "upscale" } })).toBe("源图 - Upscale");
  });
});
