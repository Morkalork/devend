/** The boss nameplate's state (canvas BossBanner). The DOM banner had no test of its own. */
import { describe, it, expect } from "vitest";
import { bossBannerState } from "@/ui/game/bossBannerModel";

describe("the boss nameplate", () => {
  it("counts the deadline down in whole seconds, never below zero", () => {
    expect(bossBannerState(60, 12.2, 3, 3, false).remaining).toBe(48);
    expect(bossBannerState(60, 75, 3, 3, false).remaining).toBe(0);
  });

  it("has no countdown on a boss without a deadline", () => {
    const s = bossBannerState(null, 12, 3, 3, false);
    expect(s.remaining).toBeNull();
    expect(s.urgent).toBe(false);
  });

  it("turns urgent in the final ten seconds", () => {
    expect(bossBannerState(60, 49.5, 3, 3, false).urgent).toBe(false);
    expect(bossBannerState(60, 50, 3, 3, false).urgent).toBe(true);
  });

  it("empties a pip per hit", () => {
    expect(bossBannerState(null, 0, 2, 4, false).pips).toEqual([true, true, false, false]);
  });

  it("shows no health bar for a single-life boss, or once defeated", () => {
    expect(bossBannerState(null, 0, 1, 1, false).pips).toBeNull();
    expect(bossBannerState(null, 0, 0, 4, true).pips).toBeNull();
  });
});
