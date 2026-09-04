/**
 * Map 6's rail: the launcher's shot really does follow the bend.
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
 * traces out is the arc the designer drew. This is what map 6 is built from,
 * and it is what this file guards - measured as "how much of its flight did
 * the ball spend beside the guide", against the map on disk rather than a
 * fixture, because the thing that breaks a rail is somebody editing the map.
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
import { fireLauncher, pendingLauncher } from "@/lib/physics/launcher";
import { setRunSeedText } from "@/lib/runRng";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig, LevelData } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

type V = { x: number; y: number };

const level6 = (): LevelConfig => {
  const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
  const lvl = doc.levels.find(l => l.level === 6);
  if (!lvl) throw new Error("map.yml has no level 6");
  return lvl as unknown as LevelConfig;
};

/**
 * Fire the plunger and measure how much of the flight each ball spent on the
 * rail. The seed pins the DEAL: maps are dealt in one of four rotations, and a
 * test that let it roll would be measuring a different board every run.
 */
function ride(aimDegrees: number, steps = 300) {
  setRunSeedText("deal-d");
  const d = createInitialGameData(level6(), 6, DEFAULT_MODIFIERS);
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

describe("map 6 has a launcher and a rail to fire it down", () => {
  it("still has a plunger, two arcs and the breakable it teaches", () => {
    const ids = (level6().entities ?? []).map(e => e.id);
    expect(ids, "the plunger is gone").toContain("launcher-1788422810361");
    expect(ids, "the outer arc is gone").toContain("guide");
    expect(ids, "the inner arc is gone, so the rail is one wall again").toContain("lane");
    // Level 6 is where the game introduces the breakable (see map.yml's note).
    const breakables = (level6().entities ?? []).filter(e => (e as { breakable?: boolean }).breakable);
    expect(breakables.length, "map 6 no longer teaches the breakable").toBeGreaterThan(0);
  });

  it("bows its arcs towards the plunger, not away", () => {
    // The sign IS the mechanic. Positive bows the other way, which turns the
    // rail's inside face into a hump and scatters every shot off it.
    const byId = new Map((level6().entities ?? []).map(e => [e.id, e as unknown as { bend?: number }]));
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
    const byId = new Map((level6().entities ?? []).map(e => [e.id, e as unknown as { breakable?: boolean; hitsToBreak?: number }]));
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
