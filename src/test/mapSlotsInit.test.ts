/**
 * initGame x mapSlots integration (#53): slots resolve only from
 * PROCEDURAL_MIN_LEVEL up, and are deterministic under an armed run seed.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

const MODS = {
  startingCapturePercent: 0,
  ballSpeedMultiplier: 1,
  ballSizeMultiplier: 1,
  slowOneBallFactor: 0,
} as unknown as GameModifiers;

function slottedLevel(): LevelConfig {
  return {
    id: "level-proc",
    level: 12,
    sizeThreshold: 10,
    expectedCuts: 10,
    points: 20,
    variety: 0,
    randomShapes: 0, // isolate: obstacles come only from slots
    maxBalls: 2,
    slots: [
      { id: "pillar-tl", candidates: [{ shape: "circle", cx: [200, 320], cy: [200, 320], radius: [62, 92] }] },
      { id: "pillar-tr", candidates: [{ shape: "circle", cx: [580, 700], cy: [200, 320], radius: [62, 92] }] },
      { id: "pillar-b", candidates: [{ shape: "circle", cx: [380, 520], cy: [560, 700], radius: [62, 92] }] },
    ],
  };
}

afterEach(() => setRunSeedText(null));

describe("initGame procedural slots (#53)", () => {
  it("ignores slots for levels below PROCEDURAL_MIN_LEVEL", () => {
    setRunSeedText(null);
    const level = slottedLevel();
    // Same config, but rendered as an early (teaching-band) level number.
    const data = createInitialGameData(level, 5, MODS);
    expect(data.obstaclePolygons.length).toBe(0);
  });

  it("resolves slots for levels >= PROCEDURAL_MIN_LEVEL", () => {
    setRunSeedText(null);
    const data = createInitialGameData(slottedLevel(), 12, MODS);
    expect(data.obstaclePolygons.length).toBe(3);
  });

  it("is deterministic under an armed run seed (shared Daily board)", () => {
    setRunSeedText("daily:2026-07-19");
    const a = createInitialGameData(slottedLevel(), 12, MODS);
    setRunSeedText("daily:2026-07-19");
    const b = createInitialGameData(slottedLevel(), 12, MODS);
    // Obstacle geometry (slot-resolved) must match exactly for everyone on the
    // seed. Ball spawn positions use unseeded Math.random and are not compared.
    expect(a.obstaclePolygons).toEqual(b.obstaclePolygons);
  });

  it("produces different boards for different seeds", () => {
    setRunSeedText("daily:2026-07-19");
    const a = createInitialGameData(slottedLevel(), 12, MODS);
    setRunSeedText("daily:2026-07-20");
    const b = createInitialGameData(slottedLevel(), 12, MODS);
    expect(a.obstaclePolygons).not.toEqual(b.obstaclePolygons);
  });
});
