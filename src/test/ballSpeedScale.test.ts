/**
 * A map's own tempo.
 *
 * Reported on level 13 as "the balls are too fast here". Until this existed
 * there was no answer to that: a map's pace could only be changed by picking
 * different ball TYPES, which is blunt (it changes what the balls DO as well as
 * how fast they go) or by a mutator, which is announced to the player as an
 * event rather than being the map's own speed.
 *
 * Two properties matter and are easy to get wrong in opposite directions.
 *
 * IT MUST SCALE THE RANGE TOO. The yellow ball has a `speedRange` rather than
 * one speed, so a scale applied only to `baseSpeed` would leave that ball
 * running at full pace on a map authored slow - the one ball the player would
 * notice, since it is the only one whose speed visibly moves.
 *
 * IT MUST SIT OUTSIDE THE UPGRADE FLOOR. `effectiveBallSpeedFactor` stops a
 * stacked slow BUILD dropping a ball below half normal (issue #42). Folding the
 * map's scale inside it would make a slow map and a slow build fight over the
 * same floor, and "half normal" would silently come to mean half of some other
 * map's speed.
 */
import { describe, it, expect } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { getBallType } from "@/lib/ballTypes";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig } from "@/types/level";
import { LADDER } from "./fixtures/maps";

/** Spawn a map and report each ball's base speed, in spawn order. */
function speedsOf(level: LevelConfig, mods = DEFAULT_MODIFIERS): number[] {
  setRunSeedText("speed-probe");
  const game = createInitialGameData(level, level.level as number, mods);
  return (game.balls as Array<{ baseSpeed: number }>).map(b => b.baseSpeed);
}

const base = (id: string) => getBallType(id)!.baseSpeed;

describe("a map can set its own ball speed", () => {
  const plain: LevelConfig = {
    id: "speed-probe", level: 11, sizeThreshold: 20, expectedCuts: 5, points: 20,
    maxBalls: 2, variety: 0, randomShapes: 0,
    ballTypeIds: ["red", "yellow"], entities: [], balls: [],
  } as unknown as LevelConfig;

  it("spawns at the type's own speed when the map says nothing", () => {
    expect(speedsOf(plain)).toEqual([base("red"), base("yellow")]);
  });

  it("scales every ball by the authored factor", () => {
    const slow = { ...plain, ballSpeedScale: 0.75 };
    expect(speedsOf(slow)).toEqual([base("red") * 0.75, base("yellow") * 0.75]);
  });

  it("scales a speedRange with it, so the variable ball slows too", () => {
    // Yellow is the map's only ball with a range. Scaling `baseSpeed` alone
    // would leave its actual pace untouched, on the one ball whose speed the
    // player can see changing.
    const yellow = getBallType("yellow")!;
    expect(yellow.speedRange, "yellow lost its range: pick another ranged type")
      .toBeTruthy();

    setRunSeedText("speed-probe");
    const game = createInitialGameData(
      { ...plain, ballSpeedScale: 0.5 } as LevelConfig, 11, DEFAULT_MODIFIERS);
    const ranged = (game.balls as Array<{ typeId: string; speedRange?: [number, number] }>)
      .find(b => b.typeId === "yellow")!;
    expect(ranged.speedRange![0]).toBeCloseTo(yellow.speedRange![0] * 0.5, 5);
    expect(ranged.speedRange![1]).toBeCloseTo(yellow.speedRange![1] * 0.5, 5);
  });

  it("multiplies with a build's own slow rather than being floored by it", () => {
    // The floor is about the BUILD. A map authored at 0.5 with a build that
    // also halves must land near a quarter, not at the build's floor: the two
    // are different statements and both are meant to apply.
    const mods = { ...DEFAULT_MODIFIERS, ballSpeedMultiplier: 0.5 };
    const withBuild = speedsOf({ ...plain, ballSpeedScale: 0.5 }, mods)[0];
    const buildOnly = speedsOf(plain, mods)[0];
    expect(withBuild).toBeCloseTo(buildOnly * 0.5, 5);
  });

  it("leaves a map that never asked completely alone", () => {
    // The regression that would be invisible: a default of 0 or NaN anywhere in
    // the chain zeroes every ball on every map on the ladder.
    for (const lv of LADDER.filter(l => l.ballSpeedScale === undefined)) {
      for (const s of speedsOf(lv)) expect(s, lv.id).toBeGreaterThan(0);
    }
  });
});

describe("what the ladder actually authors", () => {
  it("keeps every authored scale inside the range the builder offers", () => {
    // The panel clamps to 25-200%. A value outside that could only arrive by
    // hand-editing the YAML, and 0 would freeze the map solid.
    for (const lv of LADDER) {
      if (lv.ballSpeedScale === undefined) continue;
      expect(lv.ballSpeedScale, `${lv.id} authors an unplayable speed`)
        .toBeGreaterThanOrEqual(0.25);
      expect(lv.ballSpeedScale, `${lv.id} authors an unplayable speed`)
        .toBeLessThanOrEqual(2);
    }
  });

  it("has level 13 at three quarters, which is what was asked for", () => {
    const l13 = LADDER.find(l => l.level === 13)!;
    expect(l13.ballSpeedScale).toBe(0.75);
  });
});
