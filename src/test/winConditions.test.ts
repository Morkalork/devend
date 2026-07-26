import { describe, it, expect } from "vitest";
import { winConditionsBody } from "@/lib/winConditions";
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
