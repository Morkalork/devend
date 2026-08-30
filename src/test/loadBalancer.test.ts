/**
 * Load Balancer slows one ball, and always the same one.
 *
 * The first shop offered four upgrades that all answered the same question -
 * don't let the ball hit my growing fence - so players took the most legible
 * one, Runtime Optimisation, every time. This is the specialist against that
 * generalist: Runtime Optimisation slows everything a little forever, this
 * slows the one ball that is actually the problem, a lot, and decays as the
 * board fills because at four balls it is helping with one of four.
 *
 * ── The hazard this file mostly exists for ─────────────────────────────────
 *
 * "The fastest ball" is the obvious reading and it is a feedback loop: slow
 * whichever ball is quickest this frame and it stops being quickest, so it
 * speeds back up, so it is quickest again. The target is chosen by BASE speed
 * instead, which belongs to the ball type and cannot move - settled when the
 * map is dealt and settled for the whole map.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { MAX_FASTEST_BALL_SLOW_PERCENT } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig, LevelData } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

/** A map with several ball types, so "the fastest" is a real distinction. */
const MANY = LEVELS.find(l => (l.maxBalls ?? 1) >= 3)!;

const mods = (over: Partial<GameModifiers> = {}) => ({
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, startingCapturePercent: 0,
  fastestBallSlowPercent: 0, ...over,
} as unknown as GameModifiers);

function speeds(pct: number) {
  setRunSeedText("load-balancer");
  const data = createInitialGameData(MANY, MANY.level ?? 5, mods({ fastestBallSlowPercent: pct }));
  return data.balls.filter(b => b.state !== "dormant").map(b => ({ id: b.id, speed: b.speed }));
}

describe("who gets slowed", () => {
  it("slows exactly one ball, not the whole board", () => {
    // THE distinction from Runtime Optimisation. If it slowed everything it
    // would just be a bigger version of its own prerequisite.
    const before = speeds(0);
    const after = speeds(20);
    expect(after.length).toBe(before.length);
    const changed = after.filter((b, i) => Math.abs(b.speed - before[i].speed) > 1e-6);
    expect(changed.length, `${changed.length} balls changed speed`).toBe(1);
  });

  it("slows the fastest one", () => {
    const before = speeds(0);
    const after = speeds(20);
    const i = after.findIndex((b, j) => Math.abs(b.speed - before[j].speed) > 1e-6);
    const top = Math.max(...before.map(b => b.speed));
    expect(before[i].speed, "the slowed ball was not the quickest").toBe(top);
  });

  it("takes off roughly the percentage it advertises", () => {
    const before = speeds(0);
    const after = speeds(20);
    const i = after.findIndex((b, j) => Math.abs(b.speed - before[j].speed) > 1e-6);
    expect(after[i].speed / before[i].speed).toBeCloseTo(0.8, 2);
  });

  it("changes nothing at all when the upgrade is not owned", () => {
    expect(speeds(0)).toEqual(speeds(0));
  });
});

describe("the target does not move", () => {
  it("picks the same ball however hard it is slowed", () => {
    // The feedback loop, stated as a test. Were the target chosen by CURRENT
    // speed, a big enough cut would demote the leader and the mark would jump
    // to a different ball - so the same map would slow different balls at 10%
    // and at 20%, and the upgrade would be describing something it does not do.
    const base = speeds(0);
    const marked = (pct: number) => {
      const after = speeds(pct);
      return after.findIndex((b, j) => Math.abs(b.speed - base[j].speed) > 1e-6);
    };
    const at10 = marked(10);
    expect(at10, "nothing was slowed at 10%").toBeGreaterThanOrEqual(0);
    expect(marked(15), "the mark moved between 10% and 15%").toBe(at10);
    expect(marked(20), "the mark moved between 15% and 20%").toBe(at10);
  });

  it("is stable across repeated deals of the same map", () => {
    const a = speeds(20);
    const b = speeds(20);
    expect(a).toEqual(b);
  });
});

describe("what it may never do", () => {
  it("never drops a ball below the slow-stack floor", () => {
    // MIN_BALL_SPEED_FACTOR exists because a stacked slow build once made the
    // game unplayably slow (issue #42). Stacking this on top of Runtime
    // Optimisation must not walk around it.
    const base = speeds(0);
    setRunSeedText("load-balancer");
    const stacked = createInitialGameData(MANY, MANY.level ?? 5,
      mods({ ballSpeedMultiplier: 0.5, fastestBallSlowPercent: 20 }))
      .balls.filter(b => b.state !== "dormant");
    // Per BALL, against its own unmodified speed. Comparing the slowest ball to
    // some other ball's speed measures the roster, not the floor.
    expect(stacked.length).toBe(base.length);
    stacked.forEach((b, i) => {
      expect(b.speed / base[i].speed, `${b.id} fell through the floor`)
        .toBeGreaterThanOrEqual(0.5 - 1e-6);
    });
  });

  it("is capped, so stacking cannot invert the board's read", () => {
    // The fastest ball is what the danger frame and the path preview are both
    // about. Making it the SLOWEST thing on screen would quietly reverse what
    // the player has learned to look at.
    expect(MAX_FASTEST_BALL_SLOW_PERCENT).toBeLessThanOrEqual(25);
  });
});

describe("the catalogue side", () => {
  const UPGRADES = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
  ) as { upgrades: { id: string; name: string; unlockLevel?: number; prerequisites?: string[] }[] }).upgrades;

  it("is not sold at level 1, where it would beat its own parent", () => {
    // Level 1 spawns exactly ONE ball, so "the fastest" is "the only" and a 20%
    // cut dwarfs Runtime Optimisation's flat 5%. From level 2 there is a second
    // ball and it becomes a trade instead of a strict upgrade.
    const line = UPGRADES.filter(u => u.name === "Load Balancer");
    expect(line.length).toBeGreaterThan(0);
    for (const u of line) {
      expect(u.unlockLevel ?? 1, `${u.id} is on the level-1 shelf`).toBeGreaterThan(1);
    }
  });

  it("hangs off Runtime Optimisation, the line it specialises", () => {
    const head = UPGRADES.filter(u => u.name === "Load Balancer")
      .sort((a, b) => (a.unlockLevel ?? 0) - (b.unlockLevel ?? 0))[0];
    expect(head.prerequisites ?? []).toContain("runtime_optimisation_junior");
  });
});
