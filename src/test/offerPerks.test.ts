/**
 * The Specialisations' signature rules (offerPerks.ts): the numbers, and that
 * each rule is wired where it has to act.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ball } from "@/types/game";
import {
  desperationMultiplier, headStartTime, MAX_FENCE_HEAD_START, nearestFreeBall, openingSlowFactor, OPENING_SLOW_FACTOR,
  START_FROZEN_SECONDS, startFrozenPicks, storeInterest, STORE_INTEREST_CAP,
} from "@/lib/offerPerks";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const ball = (id: string, x: number, y: number, over: Partial<Ball> = {}): Ball =>
  ({ id, state: "active", position: { x, y }, speed: 100, baseSpeed: 100, ...over } as Ball);

describe("Reliability: the opening slow", () => {
  it("slows balls only inside the window", () => {
    expect(openingSlowFactor(0, 8)).toBe(OPENING_SLOW_FACTOR);
    expect(openingSlowFactor(7.9, 8)).toBe(OPENING_SLOW_FACTOR);
    expect(openingSlowFactor(8, 8)).toBe(1);
    expect(openingSlowFactor(0, 0)).toBe(1);
  });

  it("scales displacement in updateBall, never the velocity the rescalers rewrite", () => {
    const src = read("src/lib/physics/updateBall.ts");
    expect(src).toMatch(/openingSlowFactor\(game\.activePlaySeconds, game\.openingSlowSeconds \?\? 0\)/);
    expect(src).toMatch(/const moveDt = dt \* .* \* opening;/);
    expect(read("src/components/game/GameCanvas.tsx")).toMatch(/game\.openingSlowSeconds = activeModifiers\.openingSlowSeconds;/);
  });
});

describe("Platform: the fence head start", () => {
  it("starts the build where the ease curve reaches the head start", () => {
    for (const h of [0.05, 0.12, 0.3, 0.5, 0.7]) expect(ease(headStartTime(h))).toBeCloseTo(h, 6);
  });

  it("never builds the whole fence", () => {
    expect(ease(headStartTime(5))).toBeCloseTo(MAX_FENCE_HEAD_START, 6);
    expect(headStartTime(0)).toBe(0);
  });

  it("is applied once, on the fence's first update, and leaves the grace window alone", () => {
    const src = read("src/lib/physics/updateFenceWall.ts");
    expect(src).toMatch(/if \(wall\.headStart && wall\.headStartOffset === undefined\)/);
    expect(src).toMatch(/simNow\(\) - wall\.startTime < activeModifiers\.fenceGraceMs/);
    expect(read("src/lib/net/commands.ts")).toMatch(/headStart: +isInstant \|\| !\(deps\.modifiers\.fenceHeadStart > 0\)/);
  });
});

describe("Procurement: store interest", () => {
  it("pays a floored percent of the bank, up to the cap", () => {
    expect(storeInterest(100, 5)).toBe(5);
    expect(storeInterest(39, 5)).toBe(1);
    expect(storeInterest(19, 5)).toBe(0);
    expect(storeInterest(10_000, 5)).toBe(STORE_INTEREST_CAP);
    expect(storeInterest(100, 0)).toBe(0);
    expect(storeInterest(-50, 5)).toBe(0);
  });

  it("is paid on arrival at the store", () => {
    expect(read("src/hooks/useGameSession.ts")).toMatch(/const interest = storeInterest\(totalScore, activeModifiers\.shopInterestPercent\);/);
  });
});

describe("Containment: the lock stun", () => {
  it("holds the nearest free ball, skipping locked and already-held ones", () => {
    const now = 1000;
    const balls = [
      ball("locked", 1, 1, { state: "won" } as Partial<Ball>),
      ball("held", 2, 2, { frozenUntil: now + 500 }),
      ball("near", 10, 10),
      ball("far", 90, 90),
    ];
    expect(nearestFreeBall(balls, { x: 0, y: 0 }, now)?.id).toBe("near");
    expect(nearestFreeBall([], { x: 0, y: 0 }, now)).toBeNull();
  });

  it("fires on every lock", () => {
    expect(read("src/lib/physics/checkBallWonState.ts")).toMatch(/if \(activeModifiers\.lockStunSeconds > 0\)/);
  });
});

describe("Cold Storage: frozen at the start", () => {
  it("picks the fastest balls first", () => {
    const balls = [ball("slow", 0, 0, { speed: 50 }), ball("fast", 0, 0, { speed: 200 }), ball("mid", 0, 0, { speed: 120 })];
    expect(startFrozenPicks(balls, 1).map(b => b.id)).toEqual(["fast"]);
    expect(startFrozenPicks(balls, 2).map(b => b.id)).toEqual(["fast", "mid"]);
    expect(startFrozenPicks(balls, 0)).toEqual([]);
  });

  it("holds for a stated time, never shortening a Cold Boot", () => {
    expect(START_FROZEN_SECONDS).toBeGreaterThan(0);
    expect(read("src/components/game/GameCanvas.tsx")).toMatch(/ball\.frozenUntil = Math\.max\(ball\.frozenUntil \?\? 0, thaw\);/);
  });
});

describe("Growth: desperation pays", () => {
  it("pays per life below three, and nothing at or above it", () => {
    expect(desperationMultiplier(3, 0.15)).toBe(1);
    expect(desperationMultiplier(5, 0.15)).toBe(1);
    expect(desperationMultiplier(2, 0.15)).toBeCloseTo(1.15);
    expect(desperationMultiplier(1, 0.15)).toBeCloseTo(1.3);
    expect(desperationMultiplier(1, 0)).toBe(1);
  });

  it("reads the lives the map started on, so the rate holds for the whole map", () => {
    expect(read("src/hooks/useGameSession.ts")).toMatch(/desperationMultiplier\(livesAtLevelStart, baseModifiers\.scoreBonusPerMissingLife\)/);
  });
});
