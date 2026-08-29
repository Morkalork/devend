/**
 * The four bosses ask four different questions.
 *
 * Reported as "the bosses aren't very well written after the first lvl 10 boss",
 * about the fight design rather than the prose. It was accurate, and the cause
 * was in the engine rather than in the content: `bossTrapIsDamage(ball) &&
 * !areaGate` skipped the whole multi-HP fight whenever a colored-area gate was
 * present, and every boss map in the game has one. So `hp` was inert on all four
 * maps, the break-out / escalate / REVERTED system was unreachable content, and
 * every boss authored itself as hp: 1 because nothing else did anything.
 *
 * What was left was one question asked four times - seal it in the box on the
 * first try or lose a life - with an added annoyance to tell the maps apart.
 *
 * HP now composes with the gate instead of being cancelled by it: while a boss
 * has HP to spare, a trap ANYWHERE wears it down and costs no life, and only the
 * final hit is judged by location. That is what makes a long boss fight fair,
 * and it leaves the level 10 teaching boss (hp: 1) byte-for-byte as it was.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { bossTrapIsDamage, escalateBoss } from "@/lib/physics/checkBallWonState";
import type { Ball } from "@/types/game";
import type { BossBall, LevelConfig } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as { levels: LevelConfig[] }).levels;

const BOSSES = LEVELS.filter(l => l.boss);
const at = (level: number) => BOSSES.find(l => l.level === level)!;
const ball = (level: number): BossBall => at(level).boss!.bossBall ?? {};

describe("each boss fight is shaped differently from the others", () => {
  it("still ships exactly four", () => {
    expect(BOSSES.map(l => l.level)).toEqual([10, 20, 30, 35]);
  });

  /**
   * The actual complaint, as a check.
   *
   * A fight's SHAPE is the set of mechanics it turns on: how many targets, how
   * many traps each, whether it wipes your fences, whether it spits minions. Two
   * maps with the same shape are the same fight wearing different colours, which
   * is what 10 / 20 / 30 / 35 were: all (1 target-ish, 1 trap, gate), separated
   * only by which annoyance was switched on.
   */
  const shape = (level: number) => {
    const b = ball(level);
    return [
      `targets:${b.count ?? 1}`,
      `traps:${b.hp ?? 1}`,
      `wipe:${(b.fenceWipeSeconds ?? 0) > 0}`,
      `minions:${(b.spitIntervalSeconds ?? 0) > 0}`,
    ].join(" ");
  };

  it("gives no two bosses the same shape", () => {
    const shapes = BOSSES.map(l => `${l.level}: ${shape(l.level)}`);
    const bare = BOSSES.map(l => shape(l.level));
    expect(new Set(bare).size, `two fights are identical\n${shapes.join("\n")}`).toBe(bare.length);
  });

  it("keeps level 10 the single precise seal it always was", () => {
    // The one the report said was fine. One target, one trap, in the box.
    const b = ball(10);
    expect(b.hp ?? 1).toBe(1);
    expect(b.count ?? 1).toBe(1);
    expect(b.fenceWipeSeconds ?? 0).toBe(0);
  });

  it("makes level 20 a war of attrition rather than a second level 10", () => {
    expect(ball(20).hp).toBeGreaterThan(1);
  });

  it("makes level 30 about the clock on your build, not on the boss", () => {
    // One trap, but nothing you build survives two wipes, so the whole job has
    // to fit in one window. A slower boss than before: the pressure is the wipe.
    const b = ball(30);
    expect(b.hp ?? 1).toBe(1);
    expect(b.fenceWipeSeconds ?? 0).toBeLessThanOrEqual(20);
    expect(b.speedScale ?? 1).toBeLessThan(1.45);
  });

  it("makes level 35 the only fight carrying all three ideas at once", () => {
    const b = ball(35);
    expect((b.hp ?? 1) > 1, "no attrition").toBe(true);
    expect((b.count ?? 1) > 1, "not a pair").toBe(true);
    expect((b.fenceWipeSeconds ?? 0) > 0, "no wipe").toBe(true);
    expect((b.spitIntervalSeconds ?? 0) > 0, "no minions").toBe(true);
  });

  it("gives the longer fights the time to actually finish them", () => {
    // Four traps in the 75s that was sized for two is not a harder fight, it is
    // an unwinnable one, and it fails on the clock rather than on the boss.
    for (const l of BOSSES) {
      const b = ball(l.level);
      const traps = (b.hp ?? 1) * (b.count ?? 1);
      expect(l.timeLimit ?? 0, `level ${l.level}: ${traps} traps`)
        .toBeGreaterThanOrEqual(traps * 20);
    }
  });
});

describe("a multi-HP boss is a real fight, not inert config", () => {
  const boss = (hp: number, maxHp = hp): Ball => ({
    isBoss: true, bossHp: hp, bossMaxHp: maxHp,
    speed: 100, baseSpeed: 100, topSpeed: 200, minimumSpeed: 50,
    velocity: { x: 10, y: 0 }, radius: 40, bossFullRadius: 40, bossMinRadius: 12,
  } as unknown as Ball);

  it("treats a trap as damage while HP remains", () => {
    expect(bossTrapIsDamage(boss(2))).toBe(true);
    expect(bossTrapIsDamage(boss(3))).toBe(true);
  });

  it("treats the last trap as the kill", () => {
    // Only the final hit is judged by location, which is what keeps the colored
    // area gate meaningful on a fight that takes several traps.
    expect(bossTrapIsDamage(boss(1))).toBe(false);
  });

  it("never damages the level 10 boss, whose fight is unchanged", () => {
    expect(bossTrapIsDamage(boss(ball(10).hp ?? 1))).toBe(false);
  });

  it("escalates on every hit: faster, and smaller toward a normal ball", () => {
    const b = boss(2, 3);
    const wasSpeed = b.speed, wasRadius = b.radius;
    escalateBoss(b);
    expect(b.speed).toBeGreaterThan(wasSpeed);
    expect(b.radius).toBeLessThan(wasRadius);
  });

  it("shrinks to an ordinary ball's size on its last life", () => {
    // The telegraph: "one trap from defeat" is readable off the boss itself.
    const b = boss(1, 3);
    escalateBoss(b);
    expect(b.radius).toBeCloseTo(12, 5);
  });
});

describe("the damage branch is no longer cancelled by a gate", () => {
  const SRC = readFileSync(
    resolve(process.cwd(), "src/lib/physics/checkBallWonState.ts"), "utf8",
  );

  it("does not skip the wear-down when a colored area gates the map", () => {
    // THE regression. Every boss map has a gate, so re-adding this condition
    // silently returns all four fights to hp: 1 and nothing else would fail:
    // the YAML would still say hp: 2 and the game would still be winnable.
    expect(SRC, "the multi-HP fight is unreachable on gated maps again")
      .not.toMatch(/bossTrapIsDamage\([^)]*\)\s*&&\s*!areaGate/);
  });

  it("every boss map does in fact gate on an area", () => {
    // Which is what makes the line above matter rather than being trivia.
    for (const l of BOSSES) {
      const gates = (l.coloredAreas ?? []).filter(a => a.required !== false);
      expect(gates.length, `level ${l.level} has no gate area`).toBeGreaterThan(0);
    }
  });
});
