/**
 * The achievements screen's sections and progress (canvas port of
 * components/game/AchievementsScreen; no DOM test covered it).
 */
import { describe, it, expect } from "vitest";
import { achievementProgress, splitAchievements } from "@/ui/screens/achievementsModel";
import type { Achievement } from "@/types/achievement";
import { DEFAULT_META_STATS } from "@/types/metaProgression";

const ach = (id: string, stat: Achievement["requirement"]["stat"], threshold: number): Achievement => ({
  id, name: id, description: "", requirement: { stat, threshold },
  bonus: { modifier: "ballSpeedMultiplier" as Achievement["bonus"]["modifier"], value: 1, description: "" },
});

const list = [
  ach("a", "totalFencesDrawn", 100),
  ach("b", "totalLivesLost", 10),
  ach("c", "highestLevelReached", 20),
  ach("d", "totalFencesDrawn", 1000),
];
const stats = { ...DEFAULT_META_STATS, totalFencesDrawn: 50, totalLivesLost: 9, highestLevelReached: 2 };

describe("splitAchievements", () => {
  it("puts completed-not-activated in available, activated in active", () => {
    const s = splitAchievements(list, ["a", "b"], ["b"], stats);
    expect(s.available.map(a => a.id)).toEqual(["a"]);
    expect(s.active.map(a => a.id)).toEqual(["b"]);
  });

  it("orders the rest closest to done first", () => {
    const s = splitAchievements(list, [], [], stats);
    // b 0.9, a 0.5, c 0.1, d 0.05
    expect(s.remaining.map(a => a.id)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("achievementProgress", () => {
  it("rounds the percentage and caps the bar at full", () => {
    expect(achievementProgress(list[0], stats)).toEqual({ current: 50, target: 100, ratio: 0.5, pct: 50 });
    const over = achievementProgress(list[1], { ...stats, totalLivesLost: 25 });
    expect(over.ratio).toBe(1);
    expect(over.pct).toBe(100);
    expect(over.current).toBe(25);
  });
});
