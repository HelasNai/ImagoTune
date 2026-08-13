import { describe, expect, it } from "vitest";
import {
  advanceTutorial,
  completeTutorial,
  createTutorialState,
  dismissTutorial,
  parseTutorialState,
  postponeTutorial,
  shouldShowTutorialWelcome,
  shouldInitializeAsExistingUser,
  startTutorial,
  TUTORIAL_CONTENT_VERSION,
  TUTORIAL_REMIND_DELAY_MS,
  TUTORIAL_STEPS,
  tutorialProgress,
} from "../src/lib/tutorial";

describe("tutorial state", () => {
  const now = Date.UTC(2026, 7, 13, 0, 0, 0);

  it("creates a new versioned state and resets incompatible data", () => {
    expect(createTutorialState(now)).toMatchObject({ version: TUTORIAL_CONTENT_VERSION, status: "new", currentStep: 0 });
    expect(parseTutorialState(JSON.stringify({ version: 0, status: "completed", currentStep: 7 }), now)).toMatchObject({
      version: TUTORIAL_CONTENT_VERSION,
      status: "new",
      currentStep: 0,
    });
    expect(parseTutorialState("not json", now).status).toBe("new");
  });

  it("postpones for 24 hours and supports permanent dismissal", () => {
    const initial = createTutorialState(now);
    const later = postponeTutorial(initial, now);
    expect(later.remindAt).toBe(now + TUTORIAL_REMIND_DELAY_MS);
    expect(shouldShowTutorialWelcome(later, now + TUTORIAL_REMIND_DELAY_MS - 1)).toBe(false);
    expect(shouldShowTutorialWelcome(later, now + TUTORIAL_REMIND_DELAY_MS)).toBe(true);
    expect(shouldShowTutorialWelcome(dismissTutorial(initial, now), now + TUTORIAL_REMIND_DELAY_MS * 2)).toBe(false);
  });

  it("starts, advances, resumes and completes without leaving the valid range", () => {
    const initial = startTutorial(createTutorialState(now), now);
    const advanced = advanceTutorial(initial, 4, now + 1);
    expect(advanced).toMatchObject({ status: "in_progress", currentStep: 4 });
    expect(startTutorial(advanced, now + 2).currentStep).toBe(4);
    expect(advanceTutorial(advanced, 999, now + 3).currentStep).toBe(TUTORIAL_STEPS.length - 1);
    expect(completeTutorial(advanced, now + 4)).toMatchObject({ status: "completed", currentStep: TUTORIAL_STEPS.length - 1 });
  });

  it("reports stable progress", () => {
    expect(tutorialProgress(createTutorialState(now))).toBe(0);
    expect(tutorialProgress(advanceTutorial(createTutorialState(now), 3, now))).toBe(43);
    expect(tutorialProgress(completeTutorial(createTutorialState(now), now))).toBe(100);
  });

  it("recognizes upgraded users without suppressing a fresh installation", () => {
    expect(shouldInitializeAsExistingUser({ configured: true, galleryCount: 0, queueCount: 0 }, now)).toBe(true);
    expect(shouldInitializeAsExistingUser({ configured: false, galleryCount: 2, queueCount: 0 }, now)).toBe(true);
    expect(shouldInitializeAsExistingUser({ configured: false, galleryCount: 0, queueCount: 0, localDataSince: now - 30 * 60 * 1000 }, now)).toBe(true);
    expect(shouldInitializeAsExistingUser({ configured: false, galleryCount: 0, queueCount: 0, localDataSince: now }, now)).toBe(false);
  });
});
