/**
 * Level 30, "Force Push", as two loose bosses (one slow, one fast) and two gate
 * boxes. Three engine pieces make that fight work, and each is pinned here:
 *
 * - `speedScales`: a boss pair whose balls move at different speeds;
 * - `regionCoversAnyArea`: the gate's 70% coverage rule reads each box on its
 *   own, so a pocket that takes all of one box counts with two boxes on the map;
 * - `bossTrappedOutside`: a boss locked outside the boxes ends the map on that
 *   trap, even with the other boss still bouncing.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playWallHitSound: () => {}, playBallCollideSound: () => {}, playFenceBreakSound: () => {},
  playDeathSound: () => {}, playBallLockSound: () => {}, playCutClaimedSound: () => {},
  playPickupClaimedSound: () => {}, playBossJumpSound: () => {}, playHeartbeatSound: () => {},
  playBossChargeSound: () => {}, playBossLandSound: () => {}, playLevelCompleteSound: () => {},
  setAudioMuted: () => {}, setSfxVolume: () => {}, getSfxVolume: () => 1,
  isAudioMuted: () => false, initAudio: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {}, vibrateDeath: () => {},
  vibrateBallLock: () => {}, setHapticsEnabled: () => {}, isHapticsEnabled: () => false,
}));

import { createInitialGameData } from "@/lib/initGame";
import { bossTrappedOutside, regionCoversAreas, regionCoversAnyArea } from "@/lib/coloredAreas";
import { MAP_FAIL_KINDS } from "@/lib/mapFailure";
import { createSpaceGrid, worldToGridIndex } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { ColoredArea, LevelConfig } from "@/types/level";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";
import bn from "@/i18n/locales/bn.json";

const MODS = new Proxy({}, {
  get: (_t, k) => (String(k).endsWith("Multiplier") || k === "gravityBendMultiplier" ? 1 : 0),
}) as GameModifiers;

describe("a boss pair at two speeds", () => {
  const level = (speedScales?: number[]): LevelConfig => ({
    id: "speeds", level: 30, sizeThreshold: 12, expectedCuts: 8, points: 5,
    maxBalls: 1, variety: 0, randomShapes: 0,
    coloredAreas: [{ kind: "light", x: 45, y: 520, width: 335, height: 335 }],
    boss: {
      name: "Pair", intro: "x",
      objective: { id: "d", name: "d", description: "d", kind: "defeatBoss", reward: 10 },
      bossBall: { hp: 1, count: 2, speedScale: 1.2, speedScales },
    },
  }) as unknown as LevelConfig;

  it("gives each boss its own speed, in spawn order", () => {
    const [slow, fast] = createInitialGameData(level([0.5, 2]), 30, MODS).balls.filter(b => b.isBoss);
    expect(fast.baseSpeed / slow.baseSpeed).toBeCloseTo(4, 5);
  });

  it("falls back to speedScale where no per-ball speed is given", () => {
    const even = createInitialGameData(level(), 30, MODS).balls.filter(b => b.isBoss);
    const partial = createInitialGameData(level([0.6]), 30, MODS).balls.filter(b => b.isBoss);
    expect(even[0].baseSpeed).toBeCloseTo(even[1].baseSpeed, 5);
    expect(partial[1].baseSpeed).toBeCloseTo(even[1].baseSpeed, 5);
    expect(partial[0].baseSpeed / partial[1].baseSpeed).toBeCloseTo(0.5, 5);
  });
});

describe("the coverage rule with two gate boxes", () => {
  const grid = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15);
  const box = (x: number, y: number): ColoredArea => ({ kind: "light", x, y, width: 60, height: 60 });
  const a = box(0, 0);
  const b = box(600, 600);
  const cellsOf = (x0: number, y0: number) => {
    const out: number[] = [];
    for (const dy of [7.5, 22.5, 37.5, 52.5]) {
      for (const dx of [7.5, 22.5, 37.5, 52.5]) {
        out.push(worldToGridIndex(grid, x0 + dx, y0 + dy));
      }
    }
    return out;
  };

  it("counts a pocket that takes one whole box, which the pooled rule did not", () => {
    const region = [...cellsOf(0, 0), worldToGridIndex(grid, 300, 300)];
    expect(regionCoversAreas(grid, region, [a, b], 0.7)).toBe(false);
    expect(regionCoversAnyArea(grid, region, [a, b], 0.7)).toBe(true);
  });

  it("still refuses a pocket that takes too little of either box", () => {
    const region = [...cellsOf(0, 0).slice(0, 8), ...cellsOf(600, 600).slice(0, 8)];
    expect(regionCoversAnyArea(grid, region, [a, b], 0.7)).toBe(false);
  });
});

describe("a boss trapped outside the boxes", () => {
  it("is caught while the other boss is still loose", () => {
    expect(bossTrappedOutside([
      { state: "won", isBoss: true, bossShipped: false },
      { state: "active", isBoss: true },
    ])).toBe(true);
  });

  it("is not a shipped boss, a loose one, or an ordinary locked ball", () => {
    expect(bossTrappedOutside([
      { state: "won", isBoss: true, bossShipped: true },
      { state: "active", isBoss: true },
      { state: "won" },
    ])).toBe(false);
  });

  it("has a headline in every locale", () => {
    expect(MAP_FAIL_KINDS).toContain("bossOutside");
    for (const [name, locale] of Object.entries({ en, es, sv, bn })) {
      const line = (locale as { mapFailure?: Record<string, string> }).mapFailure?.bossOutside;
      expect(line, name).toBeTruthy();
      expect(line, name).not.toContain("—");
    }
  });
});
