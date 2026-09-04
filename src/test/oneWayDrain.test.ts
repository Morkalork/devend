/**
 * Level 31's drain: a pocket that fills itself.
 *
 * The membrane on the shelf above lets balls DOWN and not back, so the lower
 * half of the map fills and never empties. The drain is that rule turned into a
 * place rather than a floor: a pipe whose lid is one-way too, open at the
 * bottom, so a ball that falls in stays in until the player either seals the
 * mouth or lets it wander out the ordinary way.
 *
 * Three things have to hold, and every one of them fails silently:
 *
 *   The lid must face DOWN. Bearings are authored as words and rotated with
 *   the deal, and a lid facing up is a pipe balls fall out of the top of - it
 *   looks like a pipe, and nothing on screen says otherwise.
 *
 *   The bottom must stay OPEN. A pipe closed at both ends is a pocket the
 *   player did not make: the ball is trapped whatever they do, so the cut this
 *   whole object exists to ask for is never asked.
 *
 *   And it has to hold in EVERY deal. A map is dealt in one of four rotations,
 *   so a drain that only works upright is one that works a quarter of the time.
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

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { setRunSeedText } from "@/lib/runRng";
import { rotatePoint, type MapRotation } from "@/lib/mapRotation";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig, LevelData } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const level31 = (): LevelConfig => {
  const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
  const l = doc.levels.find(x => x.level === 31);
  if (!l) throw new Error("map.yml has no level 31");
  return l as unknown as LevelConfig;
};

const entity = (id: string) =>
  (level31().entities ?? []).find(e => e.id === id) as unknown as Record<string, unknown> | undefined;

/**
 * One seed per rotation, so the deal is chosen rather than rolled.
 *
 * Keyed to THIS level: pickMapRotation salts the run seed with the level id, so
 * a seed that deals level 6 upright says nothing about level 31. Each entry is
 * checked against the rotation it claims in the test below, so a change to the
 * RNG fails loudly instead of quietly running one orientation four times.
 */
const SEED_FOR: Record<MapRotation, string> = { 0: "deal-b", 1: "deal-a", 2: "deal-e", 3: "deal-f" };
const ROTATIONS = [0, 1, 2, 3] as const;

/**
 * Stand a ball in the pipe, throw it at the lid, and report where it ends up.
 *
 * Authored coordinates mean nothing until they are carried through the deal, so
 * the drop point and the "up" it is thrown along are both rotated first.
 */
function throwAtLid(r: MapRotation, steps = 240) {
  setRunSeedText(SEED_FOR[r]);
  const d = createInitialGameData(level31(), 31, DEFAULT_MODIFIERS);
  const game = {
    ...d, objectDebris: [], pendingDestroys: [], bouncerFlashes: [], assimilations: new Map(),
  } as unknown as CanvasGameState;

  // Mid-pipe, authored, then dealt. Interior runs x 404..496, y 496..760.
  const inside = rotatePoint(450, 620, d.mapRotation);
  const lidSide = rotatePoint(450, 500, d.mapRotation);   // just under the lid
  const ux = lidSide.x - inside.x, uy = lidSide.y - inside.y;
  const len = Math.hypot(ux, uy) || 1;

  const ball = game.balls[0];
  ball.state = "active";
  ball.position = { x: inside.x, y: inside.y };
  ball.velocity = { x: (ux / len) * 260, y: (uy / len) * 260 };
  ball.speed = 260;

  // How far past the lid, along "up", the ball ever gets. Positive means it
  // climbed out through a membrane that should have stopped it.
  let escaped = -Infinity;
  for (let i = 0; i < steps; i++) {
    updateBall(ball, 1 / 120, game);
    const along = ((ball.position.x - inside.x) * ux + (ball.position.y - inside.y) * uy) / len;
    escaped = Math.max(escaped, along);
  }
  setRunSeedText(null);
  return { escaped, rotation: d.mapRotation };
}

describe("the drain is authored as a pipe, not a box", () => {
  it("has a lid, two sides, and no floor", () => {
    expect(entity("drain-lid"), "the drain has no lid, so nothing traps").toBeTruthy();
    expect(entity("drain-left"), "the drain has no left wall").toBeTruthy();
    expect(entity("drain-right"), "the drain has no right wall").toBeTruthy();
    // A floor would make the pocket without the player. The cut across the
    // bottom is the entire point of the object.
    expect(entity("drain-floor"), "a floor traps the ball for free").toBeFalsy();
  });

  it("only lets balls in downwards", () => {
    expect(entity("drain-lid")?.oneWay, "the lid is solid, so nothing can fall in").toBe("down");
  });

  it("leaves a mouth wide enough to be worth sealing", () => {
    const left = entity("drain-left") as { x: number; width: number };
    const right = entity("drain-right") as { x: number };
    const mouth = right.x - (left.x + left.width);
    // Wider than the enlarged ball, so the seal is a real cut and not a seam.
    expect(mouth).toBeGreaterThanOrEqual(60);
  });
});

describe("a ball that falls in cannot climb back out", () => {
  it.each(ROTATIONS)("holds it in, in every deal (rotation %i)", r => {
    const { escaped, rotation } = throwAtLid(r);
    expect(rotation, "the seed no longer deals this rotation").toBe(r);
    // Derived, not guessed. The drop point is 620 and the lid's underside is
    // 496, so a contained ball's CENTRE stops 124 - 18 = 106 up, resting
    // against the lid. Through it and the centre keeps going: the counter-test
    // below clears 150. 115 sits in the gap between the two.
    expect(escaped, "the ball climbed out through the lid").toBeLessThan(115);
  });

  it("would let it out if the lid faced the other way", () => {
    // The counter-test, because "the ball stayed put" is also what a ball
    // wedged in a corner does. Thrown at a lid facing UP it must escape, which
    // is what proves the throw was real and the bearing is what stopped it.
    const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
    const lvl = JSON.parse(JSON.stringify(doc.levels.find(x => x.level === 31))) as LevelConfig;
    const lid = (lvl.entities ?? []).find(e => e.id === "drain-lid") as unknown as { oneWay: string };
    lid.oneWay = "up";

    setRunSeedText(SEED_FOR[0]);
    const d = createInitialGameData(lvl, 31, DEFAULT_MODIFIERS);
    const game = {
      ...d, objectDebris: [], pendingDestroys: [], bouncerFlashes: [], assimilations: new Map(),
    } as unknown as CanvasGameState;
    const ball = game.balls[0];
    ball.state = "active";
    ball.position = { x: 450, y: 620 };
    ball.velocity = { x: 0, y: -260 };
    ball.speed = 260;
    let highest = 620;
    for (let i = 0; i < 240; i++) {
      updateBall(ball, 1 / 120, game);
      highest = Math.min(highest, ball.position.y);
    }
    setRunSeedText(null);
    expect(highest, "an up-facing lid still held the ball, so the bearing is not doing the work")
      .toBeLessThan(470);
  });
});
