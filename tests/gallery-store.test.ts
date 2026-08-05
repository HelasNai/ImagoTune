import { describe, expect, it } from "vitest";
import { createInitialState, migrateGallery, searchGallery } from "../electron/gallery-store";

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
});
