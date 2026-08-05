import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInitialState, createGalleryStore, migrateGallery, searchGallery } from "../electron/gallery-store";
import { embedRecipeInPng } from "../electron/png-metadata";

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
    const directory = await mkdtemp(path.join(os.tmpdir(), "pinaic-gallery-recovery-"));
    try {
      const recipe = { version: 1 as const, prompt: "恢复海报", negativePrompt: "", model: "gpt-image-2", size: "1024x1024", n: 1, mode: "generate" as const, projectId: "inbox", tags: [], createdAt: "2025-01-01T00:00:00.000Z" };
      await writeFile(path.join(directory, "recovered.png"), embedRecipeInPng(onePixelPng, recipe));
      await writeFile(path.join(directory, "index.json"), "{ broken json");
      const state = await createGalleryStore(directory).read();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].recipe.prompt).toBe("恢复海报");
      const files = await import("node:fs/promises").then((fs) => fs.readdir(directory));
      expect(files.some((name) => name.startsWith("index.corrupt-") && name.endsWith(".json"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
