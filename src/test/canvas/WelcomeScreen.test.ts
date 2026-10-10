/**
 * The canvas main menu's rules (src/ui/screens/welcomeModel.ts), carried over
 * from the DOM menu's tests: welcomeContinue, savedRunAscension (what the menu
 * shows), runBootFeedback (the menu shows it) and hallOfFameScreen (Records).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SECRET_GAP_MS, SECRET_TAPS, certificatesTapAction, createSecretTapCounter, dailyTapAction,
  highlightToAck, welcomeButtons, type WelcomeMenuInput,
} from "@/ui/screens/welcomeModel";

const input = (over: Partial<WelcomeMenuInput> = {}): WelcomeMenuInput => ({
  hasContinue: false, hasDaily: false, hasTwoPlayer: false, hasCertificateStore: false,
  hasLoadouts: false, hasHallOfFame: false, hasAchievements: false, hasJukebox: false, hasAdmin: false,
  ...over,
});
const labels = (over: Partial<WelcomeMenuInput> = {}) => welcomeButtons(input(over)).map(b => b.label?.key);
const byId = (over: Partial<WelcomeMenuInput>, id: string) => welcomeButtons(input(over)).find(b => b.id === id);

afterEach(() => vi.useRealTimers());

describe("Continue / New Game", () => {
  it("shows a single Start Game button when there is no saved run", () => {
    const l = labels();
    expect(l).toContain("welcome.startGame");
    expect(l).not.toContain("welcome.continueGame");
    expect(l).not.toContain("welcome.newGame");
  });

  it("shows Continue + New Game when a saved run exists, Continue first", () => {
    const b = welcomeButtons(input({ hasContinue: true }));
    expect(b.map(x => x.label?.key).slice(0, 2)).toEqual(["welcome.continueGame", "welcome.newGame"]);
    expect(b.map(x => x.label?.key)).not.toContain("welcome.startGame");
    // The two are different buttons: Continue resumes, New Game starts over.
    expect(b[0].id).toBe("continue");
    expect(b[1].id).toBe("newGame");
  });

  it("marks Continue as the recommended action, and Start Game when it is alone", () => {
    expect(byId({ hasContinue: true }, "continue")?.shimmer).toBe(true);
    expect(byId({ hasContinue: true }, "newGame")?.glow).toBe(false);
    expect(byId({}, "newGame")?.glow).toBe(true);
    expect(byId({}, "newGame")?.pulse).toBe(true);
  });
});

describe("the saved run's ascension depth", () => {
  it("says nothing about ascension on an unascended save", () => {
    expect(byId({ hasContinue: true, savedRunAscension: 0 }, "continue")?.sub).toBeUndefined();
  });

  it("names the depth waiting behind Continue", () => {
    expect(byId({ hasContinue: true, savedRunAscension: 4 }, "continue")?.sub)
      .toEqual({ key: "ascension.ladderTitle", vars: { depth: 4 } });
  });

  it("says nothing when there is no save to continue", () => {
    const all = welcomeButtons(input({ savedRunAscension: 4 }));
    expect(all.some(b => b.sub?.key === "ascension.ladderTitle")).toBe(false);
  });
});

describe("the menu while a run boots", () => {
  it("puts the play buttons in a loading state, not pressable", () => {
    const b = welcomeButtons(input({ hasContinue: true, isLoading: true }));
    expect(b.filter(x => x.disabled).length, "nothing is disabled while loading").toBeGreaterThan(0);
    expect(byId({ hasContinue: true, isLoading: true }, "continue")).toMatchObject({ loading: true, disabled: true });
    expect(byId({ isLoading: true }, "newGame")).toMatchObject({ loading: true, disabled: true });
  });

  it("leaves everything pressable when nothing is loading", () => {
    const all = welcomeButtons(input({
      hasContinue: true, hasDaily: true, hasTwoPlayer: true, hasLoadouts: true, hasHallOfFame: true,
      hasAchievements: true, hasJukebox: true, hasAdmin: true, isLoading: false,
    }));
    expect(all.filter(x => x.disabled).length, "the menu is disabled when it should be idle").toBe(0);
  });

  it("never disables Admin, and hides the NEW badge on a loading New Game", () => {
    expect(byId({ hasAdmin: true, isLoading: true }, "admin")?.disabled).toBe(false);
    expect(byId({ isLoading: true, highlights: { newGame: true } }, "newGame")?.badge).toBe(false);
  });
});

describe("which buttons appear", () => {
  it("shows Records only when a callback is provided", () => {
    expect(labels()).not.toContain("welcome.records");
    expect(labels({ hasHallOfFame: true })).toContain("welcome.records");
  });

  it("always shows Certificates, locked until the store is unlocked", () => {
    expect(byId({}, "certificates")?.locked).toBe(true);
    expect(byId({ hasCertificateStore: true }, "certificates")?.locked).toBe(false);
  });

  it("names the waiting partner on the 2-Player button", () => {
    expect(byId({ hasTwoPlayer: true }, "twoPlayer")?.label).toEqual({ key: "pair.title" });
    expect(byId({ hasTwoPlayer: true, pairPartnerName: "Ada" }, "twoPlayer")?.label)
      .toEqual({ key: "pair.resumeWith", vars: { name: "Ada" } });
  });

  it("shows the daily streak chip and today's check", () => {
    expect(byId({ hasDaily: true }, "daily")?.chip).toBeUndefined();
    expect(byId({ hasDaily: true, dailyStreak: 3, dailyDoneToday: true }, "daily"))
      .toMatchObject({ chip: { kind: "streak", value: 3 }, check: true });
  });

  it("shows certificate hours and achievement count only when above zero", () => {
    expect(byId({ totalCertificateHours: 0 }, "certificates")?.chip).toBeUndefined();
    expect(byId({ totalCertificateHours: 12 }, "certificates")?.chip).toEqual({ kind: "hours", value: 12 });
    expect(byId({ hasAchievements: true, completedAchievementCount: 0 }, "achievements")?.chip).toBeUndefined();
    expect(byId({ hasAchievements: true, completedAchievementCount: 5 }, "achievements")?.chip).toEqual({ kind: "count", value: 5 });
  });
});

describe("first-time highlights", () => {
  it("rings and badges a highlighted button, and a tap acknowledges it", () => {
    const hl = { records: true };
    const rec = byId({ hasHallOfFame: true, highlights: hl }, "records")!;
    expect(rec).toMatchObject({ ring: true, badge: true });
    expect(highlightToAck(rec, hl)).toBe("records");
  });

  it("does not acknowledge a button that is not highlighted", () => {
    const rec = byId({ hasHallOfFame: true }, "records")!;
    expect(highlightToAck(rec, {})).toBeNull();
    expect(highlightToAck(byId({}, "tutorial")!, { records: true })).toBeNull();
  });

  it("does not highlight Achievements while loading", () => {
    expect(byId({ hasAchievements: true, isLoading: true, highlights: { achievements: true } }, "achievements"))
      .toMatchObject({ ring: false, badge: false, disabled: true });
  });
});

describe("taps that open something first", () => {
  it("shows the Daily intro on the first visit and starts straight in afterwards", () => {
    expect(dailyTapAction(true)).toBe("intro");
    expect(dailyTapAction(false)).toBe("start");
  });

  it("explains locked certificates instead of a dead button", () => {
    expect(certificatesTapAction(false)).toBe("lockedInfo");
    expect(certificatesTapAction(true)).toBe("store");
  });
});

describe("the secret admin unlock on the menu ball", () => {
  it("unlocks after 10 quick taps", () => {
    vi.useFakeTimers();
    const unlock = vi.fn();
    const c = createSecretTapCounter(() => unlock);
    for (let i = 0; i < SECRET_TAPS - 1; i++) { c.tap(); vi.advanceTimersByTime(300); }
    expect(unlock).not.toHaveBeenCalled();
    c.tap();
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("starts over after a gap longer than 1.2s", () => {
    vi.useFakeTimers();
    const unlock = vi.fn();
    const c = createSecretTapCounter(() => unlock);
    for (let i = 0; i < SECRET_TAPS - 1; i++) c.tap();
    vi.advanceTimersByTime(SECRET_GAP_MS + 1);
    c.tap();
    expect(unlock).not.toHaveBeenCalled();
    for (let i = 0; i < SECRET_TAPS - 2; i++) c.tap();
    expect(unlock).not.toHaveBeenCalled();
    c.tap();
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an unlock callback", () => {
    vi.useFakeTimers();
    const holder: { unlock?: () => void } = {};
    const c = createSecretTapCounter(() => holder.unlock);
    for (let i = 0; i < SECRET_TAPS - 1; i++) c.tap();
    // Taps made with no callback did not count toward the next one.
    const unlock = vi.fn();
    holder.unlock = unlock;
    c.tap();
    expect(unlock).not.toHaveBeenCalled();
  });
});
