import { describe, it, expect } from "vitest";
import { winConditionsBody, shouldAnnounceWinConditions } from "@/lib/winConditions";
import type { LevelConfig } from "@/types/level";
import type { TFunction } from "i18next";

// Mock t: echo the key plus params, so we can assert which conditions were built.
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key) as unknown as TFunction;

const base = (over: Partial<LevelConfig>): LevelConfig => ({
  id: "x", level: 1, sizeThreshold: 30, expectedCuts: 5, points: 20, ...over,
} as LevelConfig);

describe("winConditionsBody", () => {
  it("normal map: clear percent (from sizeThreshold) + time limit for L4+", () => {
    const body = winConditionsBody(t, base({ sizeThreshold: 30 }), 5);
    expect(body).toContain('winConditions.clear({"percent":70}');
    expect(body).toContain("winConditions.time");   // L5 -> default 60s
    expect(body).not.toContain("winConditions.areaWin");
  });

  it("tutorial band (L1-3) has no time limit line", () => {
    const body = winConditionsBody(t, base({}), 2);
    expect(body).toContain("winConditions.clear");
    expect(body).not.toContain("winConditions.time");
  });

  it("normal map with a lock requirement lists it", () => {
    const body = winConditionsBody(t, base({ threadLockRequired: 3 }), 6);
    expect(body).toContain('winConditions.lock({"count":3}');
  });

  it("colored-area map: area win + fail, no clear line; boss target is the boss", () => {
    const body = winConditionsBody(t, base({
      coloredAreas: [{ x: 0, y: 0, width: 100, height: 100, kind: "var" }],
      boss: {} as LevelConfig["boss"],
    }), 10);
    expect(body).toContain("winConditions.areaWin");
    expect(body).toContain('"area":"var"');
    expect(body).toContain('"mult":1.5');
    expect(body).toContain("winConditions.areaFail");
    expect(body).toContain("winConditions.targetBoss"); // t() of the target key
    expect(body).not.toContain("winConditions.clear");
  });

  it("boss map without an area: defeat the boss", () => {
    const body = winConditionsBody(t, base({ boss: {} as LevelConfig["boss"] }), 10);
    expect(body).toContain("winConditions.boss");
    expect(body).not.toContain("winConditions.clear");
  });

  it("fence budget adds its fail line", () => {
    const body = winConditionsBody(t, base({ fenceBudget: 14 }), 5);
    expect(body).toContain('winConditions.fences({"count":14}');
  });
});

/**
 * The modal fires unprompted only when the map has something to say beyond
 * "clear X%", which the top bar shows continuously. It still lists everything
 * when opened from the menu; this only governs the interruption.
 */
describe("shouldAnnounceWinConditions", () => {
  it("stays quiet on an ordinary map", () => {
    expect(shouldAnnounceWinConditions(t, base({ sizeThreshold: 30 }), 5)).toBe(false);
  });

  // The default ramp timer applies to every map past the tutorial band, so
  // counting it would mark almost the whole game noteworthy and change nothing.
  it("ignores the default ramp timer but announces an authored one", () => {
    expect(shouldAnnounceWinConditions(t, base({}), 20)).toBe(false);
    expect(shouldAnnounceWinConditions(t, base({ timeLimit: 25 }), 20)).toBe(true);
  });

  it("announces every genuinely unusual condition", () => {
    expect(shouldAnnounceWinConditions(t, base({ threadLockRequired: 1 }), 6)).toBe(true);
    expect(shouldAnnounceWinConditions(t, base({ fenceBudget: 4 }), 6)).toBe(true);
    expect(shouldAnnounceWinConditions(t, base({ boss: {} as LevelConfig["boss"] }), 10)).toBe(true);
    expect(shouldAnnounceWinConditions(t, base({
      coloredAreas: [{ x: 0, y: 0, width: 100, height: 100, kind: "var" }],
    }), 10)).toBe(true);
  });

  // A bonus pocket is upside, not a win condition, and the board already marks it.
  it("does not announce a bonus-only colored area", () => {
    expect(shouldAnnounceWinConditions(t, base({
      coloredAreas: [{ x: 0, y: 0, width: 100, height: 100, kind: "var", required: false }],
    }), 10)).toBe(false);
  });

  // The body must stay complete regardless: opening it from the menu on an
  // ordinary map should still explain the map.
  it("keeps the full body even where it stays quiet", () => {
    const level = base({ sizeThreshold: 30 });
    expect(shouldAnnounceWinConditions(t, level, 20)).toBe(false);
    const body = winConditionsBody(t, level, 20);
    expect(body).toContain("winConditions.clear");
    expect(body).toContain("winConditions.time");
  });
});
