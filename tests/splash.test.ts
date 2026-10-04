import { describe, expect, it } from "vitest";
import { SPLASH_MAX_VISIBLE_MS, SPLASH_MIN_VISIBLE_MS, shouldDismissSplash } from "../src/lib/splash";

describe("shouldDismissSplash", () => {
  it("就绪但未达最短展示时长时不退场", () => {
    expect(shouldDismissSplash({ ready: true, elapsedMs: SPLASH_MIN_VISIBLE_MS - 1 })).toBe(false);
  });

  it("就绪且达到最短展示时长后退场", () => {
    expect(shouldDismissSplash({ ready: true, elapsedMs: SPLASH_MIN_VISIBLE_MS })).toBe(true);
  });

  it("未就绪且未到上限时不退场（继续等待）", () => {
    expect(shouldDismissSplash({ ready: false, elapsedMs: SPLASH_MAX_VISIBLE_MS - 1 })).toBe(false);
  });

  it("未就绪但达到上限时兜底退场（绝不无限遮挡）", () => {
    expect(shouldDismissSplash({ ready: false, elapsedMs: SPLASH_MAX_VISIBLE_MS })).toBe(true);
  });

  it("reduced-motion 下最短展示归零：就绪即退场", () => {
    expect(shouldDismissSplash({ ready: true, elapsedMs: 0, reducedMotion: true })).toBe(true);
  });

  it("reduced-motion 下未就绪仍不退场（未到上限）", () => {
    expect(shouldDismissSplash({ ready: false, elapsedMs: 500, reducedMotion: true })).toBe(false);
  });

  it("上限优先于一切：超过上限时无论状态都退场", () => {
    expect(shouldDismissSplash({ ready: false, elapsedMs: SPLASH_MAX_VISIBLE_MS + 100, reducedMotion: false })).toBe(true);
    expect(shouldDismissSplash({ ready: false, elapsedMs: SPLASH_MAX_VISIBLE_MS + 100, reducedMotion: true })).toBe(true);
  });
});
