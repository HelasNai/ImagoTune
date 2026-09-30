import { describe, expect, it } from "vitest";
import { resolveFocusLocation } from "../src/lib/gallery-focus";
import { INBOX_PROJECT_ID } from "../src/lib/constants";
import type { GalleryItem } from "../shared/types";

const PAGE_SIZE = 10;
const PROJECT_1 = "project-1";
const PROJECT_2 = "project-2";

/** 构造最小可用 GalleryItem；createdAt 由「自 2026-01-01T00:00Z 起的分钟数」决定，序号越大越新。 */
function makeItem(id: string, projectId: string, minute: number): GalleryItem {
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
  return {
    id,
    fileName: `${id}.png`,
    title: id,
    createdAt,
    favorite: false,
    recipe: {
      version: 1,
      prompt: `prompt ${id}`,
      negativePrompt: "",
      model: "test-model",
      size: "1024x1024",
      n: 1,
      mode: "generate",
      projectId,
      tags: [],
      createdAt,
    },
  };
}

/** 生成 count 张同项目图片（id 形如 `${prefix}-00`）。 */
function makeSeries(prefix: string, projectId: string, count: number, startMinute: number): GalleryItem[] {
  return Array.from({ length: count }, (_, index) =>
    makeItem(`${prefix}-${String(index).padStart(2, "0")}`, projectId, startMinute + index));
}

describe("resolveFocusLocation", () => {
  // 21 张同项目图片 → newest/oldest 下都是 10 + 10 + 1 共 3 页。
  const series = makeSeries("img", PROJECT_1, 21, 0);

  it("newest 排序下最新一张位于第 1 页", () => {
    // img-20 是最新的一张，newest 列表中位置 0。
    expect(resolveFocusLocation(series, "img-20", PAGE_SIZE, "newest")).toEqual({ projectId: PROJECT_1, page: 1 });
  });

  it("newest 排序下第 21 张（最旧）翻到第 3 页", () => {
    const location = resolveFocusLocation(series, "img-00", PAGE_SIZE, "newest");
    expect(location).toEqual({ projectId: PROJECT_1, page: 3 });
  });

  it("oldest 排序下位置反转：最旧在第 1 页、最新在第 3 页", () => {
    expect(resolveFocusLocation(series, "img-00", PAGE_SIZE, "oldest")).toEqual({ projectId: PROJECT_1, page: 1 });
    expect(resolveFocusLocation(series, "img-20", PAGE_SIZE, "oldest")).toEqual({ projectId: PROJECT_1, page: 3 });
  });

  it("页码在整除边界处按「向上取整」分页", () => {
    // newest 下 img-11 的 index = 9（第 1 页末位），img-10 的 index = 10（第 2 页首位）。
    expect(resolveFocusLocation(series, "img-11", PAGE_SIZE, "newest")).toEqual({ projectId: PROJECT_1, page: 1 });
    expect(resolveFocusLocation(series, "img-10", PAGE_SIZE, "newest")).toEqual({ projectId: PROJECT_1, page: 2 });
  });

  it("目标 id 不存在时返回 null", () => {
    expect(resolveFocusLocation(series, "missing-id", PAGE_SIZE, "newest")).toBeNull();
  });

  it("页码按目标所属项目自身列表计算，而不是全局位置", () => {
    // project-2 的 13 张全部比收件箱的 5 张新。
    // ib-00 是收件箱最旧的一张：项目内 newest 位置 index 4 → 第 1 页；
    // 若错误地按全局列表计算会得到 index 17 → 第 2 页。
    const items = [
      ...makeSeries("p2", PROJECT_2, 13, 120),
      ...makeSeries("ib", INBOX_PROJECT_ID, 5, 0),
    ];
    expect(resolveFocusLocation(items, "ib-00", PAGE_SIZE, "newest")).toEqual({ projectId: INBOX_PROJECT_ID, page: 1 });
    // 同一份数据里，另一项目的目标按该项目自身列表落页：p2-00 在项目内 newest index 12 → 第 2 页。
    expect(resolveFocusLocation(items, "p2-00", PAGE_SIZE, "newest")).toEqual({ projectId: PROJECT_2, page: 2 });
    // 同一份数据、另一种排序：oldest 下收件箱最新一张（项目内 5 张不满一页）仍在第 1 页。
    expect(resolveFocusLocation(items, "ib-04", PAGE_SIZE, "oldest")).toEqual({ projectId: INBOX_PROJECT_ID, page: 1 });
  });
});
