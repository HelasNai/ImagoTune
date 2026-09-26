import { describe, expect, it } from "vitest";
import {
  clamp,
  compositeFileKey,
  formatBytes,
  formatDateTime,
  formatDurationSeconds,
  formatPixelSize,
  formatTags,
  modeLabel,
  nowISO,
  parsePixelSize,
  roundUp16,
  uniqueBy,
} from "../src/lib/format";

describe("format helpers", () => {
  describe("clamp", () => {
    it("区间内数值保持不变", () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it("低于下界钳到 min", () => {
      expect(clamp(-3, 0, 10)).toBe(0);
    });

    it("高于上界钳到 max", () => {
      expect(clamp(42, 0, 10)).toBe(10);
    });

    it("点落在边界时返回边界值", () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });

  describe("roundUp16", () => {
    it("向上取整到 16 的倍数", () => {
      expect(roundUp16(1)).toBe(16);
      expect(roundUp16(16)).toBe(16);
      expect(roundUp16(17)).toBe(32);
    });

    it("负数归零", () => {
      expect(roundUp16(-5)).toBe(0);
    });

    it("小数向上取整", () => {
      expect(roundUp16(15.1)).toBe(16);
    });
  });

  describe("parsePixelSize", () => {
    it("解析 x 分隔的尺寸", () => {
      expect(parsePixelSize("1024x768")).toEqual({ width: 1024, height: 768 });
    });

    it("解析 × 分隔的尺寸", () => {
      expect(parsePixelSize("1024×768")).toEqual({ width: 1024, height: 768 });
    });

    it("容忍前后空白与分隔符周围空白", () => {
      expect(parsePixelSize("  1024 x 768  ")).toEqual({ width: 1024, height: 768 });
      expect(parsePixelSize("\t1920×1080\n")).toEqual({ width: 1920, height: 1080 });
    });

    it("大写 X 也可解析", () => {
      expect(parsePixelSize("800X600")).toEqual({ width: 800, height: 600 });
    });

    it("没有 NxN 形状时返回 null", () => {
      expect(parsePixelSize("1024")).toBeNull();
      expect(parsePixelSize("1024x")).toBeNull();
      expect(parsePixelSize("abc")).toBeNull();
      expect(parsePixelSize("")).toBeNull();
    });
  });

  describe("formatPixelSize", () => {
    it("拼接为 宽x高", () => {
      expect(formatPixelSize(1024, 768)).toBe("1024x768");
    });

    it("与 parsePixelSize 往返一致", () => {
      expect(parsePixelSize(formatPixelSize(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe("formatBytes", () => {
    it("小于 1MiB 时以 KB 取整", () => {
      expect(formatBytes(2048)).toBe("2 KB");
    });

    it("1MiB 以二进制 1024 语义输出 1.0 MB", () => {
      expect(formatBytes(1048576)).toBe("1.0 MB");
    });

    it("多 MiB 保留一位小数", () => {
      expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    });

    it("0 字节输出 0 KB", () => {
      expect(formatBytes(0)).toBe("0 KB");
    });
  });

  describe("formatDurationSeconds", () => {
    it("毫秒转一位小数秒", () => {
      expect(formatDurationSeconds(12345)).toBe("12.3 秒");
    });

    it("整秒补齐一位小数", () => {
      expect(formatDurationSeconds(1000)).toBe("1.0 秒");
    });

    it("0 毫秒输出 0.0 秒", () => {
      expect(formatDurationSeconds(0)).toBe("0.0 秒");
    });
  });

  describe("formatDateTime", () => {
    it("与原生 toLocaleString 保持一致的本地化输出", () => {
      const iso = "2024-01-02T03:04:05";
      expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
    });

    it("接受时间戳并产出含年份的文本", () => {
      const ms = Date.UTC(2024, 0, 2, 3, 4, 5);
      expect(formatDateTime(ms)).toBe(new Date(ms).toLocaleString());
      expect(formatDateTime(ms)).toContain("2024");
    });
  });

  describe("modeLabel", () => {
    it("默认按 mode 输出三种文案", () => {
      expect(modeLabel({ mode: "generate" })).toBe("文生图");
      expect(modeLabel({ mode: "edit" })).toBe("图片编辑");
      expect(modeLabel({ mode: "outpaint" })).toBe("智能扩图");
    });

    it("referenceAware 且 referenceCount>0 时输出参考图生成", () => {
      expect(modeLabel({ mode: "generate", referenceCount: 2 }, { referenceAware: true })).toBe("参考图生成");
      expect(modeLabel({ mode: "edit", referenceCount: 1 }, { referenceAware: true })).toBe("参考图生成");
    });

    it("referenceAware 但 referenceCount 为 0 或缺失时回退模式默认", () => {
      expect(modeLabel({ mode: "generate", referenceCount: 0 }, { referenceAware: true })).toBe("文生图");
      expect(modeLabel({ mode: "edit" }, { referenceAware: true })).toBe("图片编辑");
    });

    it("fallback 覆盖 generate 与 edit", () => {
      expect(modeLabel({ mode: "generate" }, { fallback: "新生成图片" })).toBe("新生成图片");
      expect(modeLabel({ mode: "edit" }, { fallback: "新生成图片" })).toBe("新生成图片");
    });

    it("优先级 outpaint 高于参考图高于 fallback 高于默认", () => {
      expect(modeLabel({ mode: "outpaint", referenceCount: 3 }, { referenceAware: true, fallback: "新生成图片" })).toBe("智能扩图");
      expect(modeLabel({ mode: "edit", referenceCount: 3 }, { referenceAware: true, fallback: "新生成图片" })).toBe("参考图生成");
    });
  });

  describe("formatTags", () => {
    it("使用中文逗号拼接", () => {
      expect(formatTags(["风景", "夜景"])).toBe("风景，夜景");
    });

    it("空数组输出空串", () => {
      expect(formatTags([])).toBe("");
    });
  });

  describe("uniqueBy", () => {
    it("按 key 去重并保留首次出现顺序", () => {
      const input = [{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }];
      expect(uniqueBy(input, (item) => String(item.id))).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it("原数组不被修改", () => {
      const input = [1, 1, 2];
      uniqueBy(input, (item) => String(item));
      expect(input).toEqual([1, 1, 2]);
    });
  });

  describe("compositeFileKey", () => {
    it("拼接 name-size-lastModified", () => {
      expect(compositeFileKey({ name: "a.png", size: 2048, lastModified: 1700000000000 })).toBe("a.png-2048-1700000000000");
    });

    it("同名同大小不同修改时间得到不同 key", () => {
      expect(compositeFileKey({ name: "a.png", size: 1, lastModified: 1 })).not.toBe(
        compositeFileKey({ name: "a.png", size: 1, lastModified: 2 }),
      );
    });
  });

  describe("nowISO", () => {
    it("返回可被 Date 解析且自洽的 ISO 字符串", () => {
      const value = nowISO();
      expect(Number.isNaN(Date.parse(value))).toBe(false);
      expect(value).toBe(new Date(value).toISOString());
    });
  });
});
