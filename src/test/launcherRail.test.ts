/**
 * The rail: a launcher's shot really does follow a bend.
 *
 * ── Why a rail is two walls and not one ─────────────────────────────────────
 *
 * A ball in this engine REFLECTS. There is no friction, no gravity and no drag
 * anywhere in src/lib/physics, and every solid mirrors the velocity about its
 * normal while preserving magnitude. So nothing ever slides along a wall: a
 * ball only appears to follow a curve by striking it again and again, and that
 * only happens where the wall is CONCAVE towards it and it arrives shallow.
 * Against a convex face every hit throws it further away, which is what a bend
 * bowed the wrong way gives you and what it looks like on screen: a bounce.
 *
 * On top of that the launcher deliberately FANS its shots across half its aim
 * cone (fanDirections, LAUNCH_SPREAD * 0.5, so +/-17.5 degrees), because a
 * barrel that fired its whole roster along one line would send a column of
 * balls that never separates. Two balls therefore never take the same line,
 * and a single curved face that carries one of them throws the other off.
 *
 * A channel does not have that problem. With walls on both sides, a ball that
 * enters the mouth is committed whatever angle it entered on, and the arc it
 * traces out is the arc the designer drew. That is what this file guards,
 * measured as "how much of its flight did the ball spend beside the guide".
 *
 * ── Why a fixture and not a shipped map ─────────────────────────────────────
 *
 * It used to read level 6 off map.yml, on the reasoning that the thing which
 * breaks a rail is somebody editing the map. That was true and it was also a
 * dependency on one map keeping one launcher forever: act I was reauthored to
 * the mechanic ledger, which puts the launcher's Meet on level 16, and this
 * file failed for a reason that had nothing to do with rails.
 *
 * The geometry below is level 6's, lifted verbatim on the day it was retired,
 * so the numbers are the ones it actually delivered. What is being guarded is
 * the ENGINE: that a channel of two concave arcs carries a fanned shot. When a
 * map is built on a rail again, it is that map's own test that should assert
 * the map still has one - which is the split MAP_DESIGN_GUIDELINES.md section 8
 * draws between a structural guard and a map-specific pin.
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
import { updateBall } from "@/lib/physics/updateBall";
import { fireLauncher, pendingLauncher } from "@/lib/physics/launcher";
import { setRunSeedText } from "@/lib/runRng";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

type V = { x: number; y: number };

/**
 * The rail, as level 6 shipped it. Kept whole rather than minimised: the
 * nub, the soft wall and the loose obstacles are what the shot actually flew
 * past, and the hug numbers below were measured against all of it.
 */
const railMap = (): LevelConfig => ({
  // The id stays "level-6" even though the shipped level 6 is now something
  // else entirely, and it is load-bearing: the deal is picked by
  // getRunRng(`rotation:${levelId}`), so the id is an INPUT to which of the four
  // rotations `ride` gets. Renaming it to "rail-fixture" dealt a different board
  // and every hug number fell to zero.
  id: "level-6",
  level: 6,
  sizeThreshold: 24,
  expectedCuts: 5,
  points: 20,
  variety: 10,
  randomShapes: 8,
  maxBalls: 2,
  entities: [
    { id: "guide", kind: "wall", shape: "rect", x: 380, y: 110, width: 26, height: 620,
      bend: -0.7, breakable: true, hitsToBreak: 14 },
    { id: "lane", kind: "wall", shape: "rect", x: 280, y: 220, width: 22, height: 460,
      bend: -0.8, breakable: true, hitsToBreak: 14 },
    { id: "soft-wall", kind: "wall", shape: "rect", x: 640, y: 250, width: 26, height: 400,
      breakable: true, hitsToBreak: 3 },
    { id: "nub", kind: "wall", shape: "circle", cx: 225, cy: 525, radius: 45, bend: 0.95 },
    { id: "nub-upper", kind: "wall", shape: "circle", cx: 225, cy: 375, radius: 45, bend: -0.95 },
    { id: "plunger", kind: "launcher", shape: "rect", x: 160, y: 700, width: 190, height: 96,
      facing: "right", angle: -45 },
  ],
  balls: [],
} as unknown as LevelConfig);

/**
 * Fire the plunger and measure how much of the flight each ball spent on the
 * rail. The seed pins the DEAL: maps are dealt in one of four rotations, and a
 * test that let it roll would be measuring a different board every run.
 */
function ride(aimDegrees: number, steps = 300) {
  setRunSeedText("deal-d");
  const d = createInitialGameData(railMap(), 6, DEFAULT_MODIFIERS);
  const game = {
    ...d, objectDebris: [], pendingDestroys: [], bouncerFlashes: [], assimilations: new Map(),
  } as unknown as CanvasGameState;

  // The guide BY ID, read off its own edge walls. Picking it by shape (the
  // tallest polygon, say) quietly latches onto a different wall the moment the
  // map is edited, and then the measurement passes while measuring nothing -
  // which it did, until flipping the guide's bend failed to move the number.
  const rail: V[] = [];
  for (const w of game.walls) {
    if (!w.id.startsWith("obstacle-guide-")) continue;
    rail.push({ ...w.start }, { ...w.end });
  }

  const launcher = pendingLauncher(game);
  if (!launcher || rail.length === 0) { setRunSeedText(null); return { fired: false, hug: [] as number[] }; }

  const rad = (aimDegrees * Math.PI) / 180;
  const fired = fireLauncher(
    game, launcher,
    { direction: { x: Math.cos(rad), y: Math.sin(rad) }, power: 2, clamped: false },
  );

  const beside = game.balls.map(() => 0);
  for (let i = 0; i < steps; i++) {
    game.balls.forEach((b, bi) => {
      if (b.state !== "active") return;
      updateBall(b, 1 / 120, game);
      const near = Math.min(...rail.map(v => Math.hypot(v.x - b.position.x, v.y - b.position.y)));
      if (near < 48) beside[bi]++;
    });
  }
  setRunSeedText(null);
  return { fired: fired !== null, count: game.balls.length, hug: beside.map(c => c / steps) };
}

describe("the fixture is a rail and not one wall", () => {
  it("is a CHANNEL: a plunger and two arcs, not a plunger and a face", () => {
    const ids = (railMap().entities ?? []).map(e => e.id);
    expect(ids, "the plunger is gone").toContain("plunger");
    expect(ids, "the outer arc is gone").toContain("guide");
    expect(ids, "the inner arc is gone, so the rail is one wall again").toContain("lane");
  });

  it("bows its arcs towards the plunger, not away", () => {
    // The sign IS the mechanic. Positive bows the other way, which turns the
    // rail's inside face into a hump and scatters every shot off it.
    const byId = new Map((railMap().entities ?? []).map(e => [e.id, e as unknown as { bend?: number }]));
    expect(byId.get("guide")?.bend, "the outer arc is bowed the wrong way").toBeLessThan(0);
    expect(byId.get("lane")?.bend, "the inner arc is bowed the wrong way").toBeLessThan(0);
  });

  it("gives the rail a bank deep enough to survive being ridden", () => {
    // The rail is breakable on purpose, and that is load-bearing twice over.
    // launcherRunway skips breakables (firing into one is a legitimate
    // opening), which is the only reason a rail may sit in front of a muzzle at
    // all - the guard wants a quarter of the board clear otherwise. And a
    // breakable rail is this level's own lesson: ride it, or spend the time to
    // smash through it.
    //
    // What it must NOT be is the ordinary 3. Riding a wall damages it - about
    // 2.5 of 3 hits inside thirty seconds - so at 3 the rail disappears partway
    // through the map, which is worse than never having worked.
    const byId = new Map((railMap().entities ?? []).map(e => [e.id, e as unknown as { breakable?: boolean; hitsToBreak?: number }]));
    for (const id of ["guide", "lane"]) {
      expect(byId.get(id)?.breakable, `${id} must stay breakable, or the muzzle guard rejects the map`).toBe(true);
      expect(byId.get(id)?.hitsToBreak ?? 0, `${id} breaks too easily to be ridden`).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("the shot rides the bend instead of bouncing off it", () => {
  it("carries BOTH fanned balls, which one curved face cannot", () => {
    const r = ride(-45);
    expect(r.fired, "the plunger did not fire").toBe(true);
    expect(r.count).toBe(2);
    // A straight pull is the shot the barrel's own angle aims, so it is the
    // one the rail is tuned for and the one that should read best.
    expect(Math.max(...r.hug), "not even the good line rode the rail")
      .toBeGreaterThan(0.35);
    // Numbers, not aspirations: this layout measures about 0.43 for the good
    // line and 0.24 for the wide one, and the thresholds sit just under what it
    // actually delivers, so a regression moves them rather than a good day.
    //
    // Time spent within a ball's width of the guide. On its own this does not
    // separate riding from rattling about beside it - a rail bowed the wrong
    // way still scores ~0.33 while the balls thrash in the corner - which is
    // why the bend's sign has an assertion of its own above. What it does catch
    // is the failure this map was built to fix: a shot that meets the curve
    // once, reflects, and spends the rest of its flight somewhere else.
    for (const [i, h] of r.hug.entries()) {
      expect(h, `ball ${i} bounced off the rail instead of riding it`).toBeGreaterThan(0.2);
    }
  });

  it("holds across the aim a hand can actually manage", () => {
    // The whole reason for the channel. A single face is a knife edge - it
    // carries the shot at one angle and throws it away five degrees off - so a
    // rail that only works on a perfect pull is not a rail.
    for (const aim of [-58, -52, -45, -38, -32]) {
      const worst = Math.min(...ride(aim).hug);
      expect(worst, `aim ${aim} lost the rail`).toBeGreaterThan(0.12);
    }
  });
});
