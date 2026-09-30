import { describe, expect, it } from "vitest";
import { historyQueueCount, isActiveQueueStatus, orderQueueForDisplay, waitingAheadCount } from "../src/lib/queue";
import type { QueueJob, QueueStatus } from "../shared/types";

function makeJob(id: string, status: QueueStatus): QueueJob {
  return {
    id,
    requestId: `req-${id}`,
    kind: "generate",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attempts: 0,
    input: {},
  };
}

describe("queue display ordering", () => {
  it("keeps active jobs in enqueue order and shows the newest history first", () => {
    const items = [
      makeJob("h1", "completed"),
      makeJob("a1", "running"),
      makeJob("h2", "failed"),
      makeJob("a2", "queued"),
      makeJob("h3", "completed"),
    ];
    expect(orderQueueForDisplay(items).map((item) => item.id)).toEqual(["a1", "a2", "h3", "h2", "h1"]);
  });

  it("does not mutate the input array", () => {
    const items = [makeJob("h1", "completed"), makeJob("h2", "failed"), makeJob("h3", "cancelled")];
    const before = items.map((item) => item.id);
    orderQueueForDisplay(items);
    expect(items.map((item) => item.id)).toEqual(before);
  });

  it("counts active jobs ahead in FIFO order, independent of display order", () => {
    const items = [makeJob("a1", "running"), makeJob("a2", "queued"), makeJob("a3", "queued"), makeJob("h1", "completed")];
    expect(waitingAheadCount(items, items[0])).toBe(0);
    expect(waitingAheadCount(items, items[1])).toBe(1);
    expect(waitingAheadCount(items, items[2])).toBe(2);
    expect(waitingAheadCount(items, items[3])).toBe(0);
  });

  it("classifies active statuses and counts only history jobs", () => {
    expect(isActiveQueueStatus("queued")).toBe(true);
    expect(isActiveQueueStatus("running")).toBe(true);
    expect(isActiveQueueStatus("completed")).toBe(false);
    expect(isActiveQueueStatus("interrupted")).toBe(false);
    const items = [makeJob("a1", "queued"), makeJob("h1", "completed"), makeJob("h2", "failed")];
    expect(historyQueueCount(items)).toBe(2);
  });
});
