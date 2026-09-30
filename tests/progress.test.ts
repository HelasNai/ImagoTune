import { describe, expect, it } from "vitest";
import { clampProgress, formatElapsed, mapLocalAIProgress, normalizeLegacyProgress } from "../src/lib/progress";

describe("progress helpers", () => {
  describe("normalizeLegacyProgress", () => {
    it("把云生图旧事件归一化为 generate 作用域的 running 事件", () => {
      const event = normalizeLegacyProgress(
        { requestId: "r1", progress: 42, status: "模型生成中", message: "已等待 10 秒" },
        1000
      );
      expect(event).toEqual({
        id: "r1",
        scope: "generate",
        message: "模型生成中 · 已等待 10 秒",
        progress: 42,
        startedAt: 1000,
        state: "running",
      });
    });

    it("progress 为 100 时进入 done 终态", () => {
      expect(normalizeLegacyProgress({ requestId: "r2", progress: 100, status: "完成" }).state).toBe("done");
    });

    it("无 message 时只保留 status；无 progress 时保持不确定态", () => {
      const event = normalizeLegacyProgress({ requestId: "r3", status: "已提交" });
      expect(event.message).toBe("已提交");
      expect(event.progress).toBeUndefined();
      expect(event.startedAt).toBeUndefined();
    });
  });

  describe("mapLocalAIProgress", () => {
    it("单阶段任务：全局进度等于局部进度", () => {
      expect(mapLocalAIProgress(37, 0, 1)).toBe(37);
    });

    it("多阶段按段等分：首段起点为 0，末段起点约 66.7", () => {
      expect(mapLocalAIProgress(0, 0, 3)).toBe(0);
      expect(mapLocalAIProgress(0, 2, 3)).toBeCloseTo(66.67, 1);
    });

    it("跨阶段单调不减（局部递增与阶段前移都不倒退）", () => {
      const values = [
        mapLocalAIProgress(90, 0, 3),
        mapLocalAIProgress(10, 1, 3),
        mapLocalAIProgress(95, 1, 3),
        mapLocalAIProgress(5, 2, 3),
      ];
      for (let index = 1; index < values.length; index += 1) {
        expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
      }
    });

    it("越界输入被钳制（负数 / 超 100 / 阶段越界 / 阶段数非正）", () => {
      expect(mapLocalAIProgress(-10, 0, 2)).toBe(0);
      expect(mapLocalAIProgress(150, 1, 2)).toBe(100);
      expect(mapLocalAIProgress(50, 99, 2)).toBe(mapLocalAIProgress(50, 1, 2));
      expect(mapLocalAIProgress(50, 0, 0)).toBe(50);
    });
  });

  describe("clampProgress", () => {
    it("钳制到 [0,100] 且非有限数归零", () => {
      expect(clampProgress(-1)).toBe(0);
      expect(clampProgress(101)).toBe(100);
      expect(clampProgress(Number.NaN)).toBe(0);
    });
  });

  describe("formatElapsed", () => {
    it("优先使用 elapsedMs，其次用 startedAt 与当前时刻的差", () => {
      expect(formatElapsed(1000, 5000, 2000)).toBe("2.0 秒");
      expect(formatElapsed(1000, 5000)).toBe("4.0 秒");
    });

    it("两者都缺省时返回 null（不显示耗时）", () => {
      expect(formatElapsed(undefined, 5000)).toBeNull();
    });

    it("startedAt 晚于 now 时归零，不产生负数耗时", () => {
      expect(formatElapsed(9000, 5000)).toBe("0.0 秒");
    });
  });
});
