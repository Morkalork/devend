/**
 * The dent reaches the ball, from both collision systems, once.
 *
 * deformable.test.ts proves the arithmetic. This proves it is connected, which
 * is the half that can be quietly correct and never called - and there are two
 * places it has to be called from, not one.
 *
 * An obstacle lives in BOTH collision systems: as a polygon (the outward
 * resolver) and as a set of `obstacle-<id>-edge-` walls. updateBall's own
 * comment on the pass rules says what happens when a property is honoured in
 * only one of them: "a wall that lets balls through its middle and bounces them
 * off its edges, which is worse than not having the mechanic". A deformable
 * wired to one path would dent at its face and stay pristine at its rim.
 *
 * Both are wired, and unlike bouncerWired.test.ts - which records that removing
 * either of its two paths leaves it green - each is separately exercised here.
 * The wall path catches every ordinary bounce; the polygon path is what handles
 * a ball that is already INSIDE the solid, so it is measured on a pad big
 * enough that its middle is out of reach of every edge wall. Unwiring either
 * one alone fails a test in this file.
 *
 * Also pinned: the property that makes wiring both safe at all, which is that a
 * single contact is still exactly ONE dent and ONE 3%. Without the cooldown the
 * two paths would compound on the same step and every pad would quietly tax at
 * 0.97 squared, which no screen would report.
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { DEFORM_SLOW, MAX_DENT, DENT_RESOLUTION } from "@/lib/physics/deformable";
import { boardEntityAt } from "@/lib/boardEntityInfo";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

/**
 * Level 3, deliberately: ROTATION_MIN_LEVEL is 4, so from there up a map is
 * dealt in one of four rotations and the pad is not where it was authored.
 * Every assertion below aims a ball at a face by its coordinates, and a fixture
 * that quietly rotated would have the ball sail past a wall that was never
 * there - which is exactly what the first draft of this file did.
 */
const level = (deformable: boolean): LevelConfig => ({
  id: "deform-test", level: 3, name: "D", sizeThreshold: 30, expectedCuts: 4,
  points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
  entities: [{
    id: "pad", kind: "wall", shape: "rect", x: 500, y: 300, width: 24, height: 300,
    ...(deformable ? { deformable: true } : {}),
  }],
} as unknown as LevelConfig);

const build = (d: boolean) => createInitialGameData(level(d), 3, DEFAULT_MODIFIERS);

describe("a deformable is registered on both collision paths", () => {
  it("puts the state on the polygon map", () => {
    const d = build(true);
    expect(d.deformables.size, "no deformable was registered at all").toBe(1);
    expect([...d.deformables.values()][0].id).toBe("pad");
  });

  it("puts the SAME object on every edge wall of that obstacle", () => {
    // Same object, not a copy: two copies is one edit away from a pad whose
    // dents depend on which system happened to catch the hit.
    const d = build(true);
    const state = [...d.deformables.values()][0];
    const edges = d.walls.filter(w => w.id.startsWith("obstacle-pad-"));
    expect(edges.length, "the obstacle has no edge walls").toBeGreaterThan(0);
    for (const w of edges) expect(w.deformable, w.id).toBe(state);
  });

  it("resamples the outline before either system is built from it", () => {
    // Both are made from ONE shape, or the polygon and the walls describe
    // different surfaces from the very first frame.
    const d = build(true);
    const state = [...d.deformables.values()][0];
    const poly = [...d.deformables.keys()][0];
    expect(poly.vertices.length, "the authored rectangle was used as-is")
      .toBeGreaterThan(4);
    expect(state.walls.length).toBe(poly.vertices.length);
    for (let i = 0; i < poly.vertices.length; i++) {
      expect(state.walls[i].start.x).toBeCloseTo(poly.vertices[i].x, 6);
      expect(state.walls[i].start.y).toBeCloseTo(poly.vertices[i].y, 6);
    }
    for (let i = 0; i < poly.vertices.length; i++) {
      const a = poly.vertices[i], b = poly.vertices[(i + 1) % poly.vertices.length];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(DENT_RESOLUTION + 1e-6);
    }
  });

  it("leaves an ordinary wall completely alone", () => {
    const d = build(false);
    expect(d.deformables.size).toBe(0);
    expect(d.walls.some(w => w.deformable)).toBe(false);
    // ...including its outline, which stays the four authored corners.
    expect(d.obstaclePolygons[0].vertices.length).toBe(4);
  });
});

describe("hitting one costs speed and leaves a mark", () => {
  /** Drive a ball head-on into the pad's left face and watch both effects. */
  const run = (deformable: boolean) => {
    const d = build(deformable);
    const game = { ...d } as unknown as CanvasGameState;
    const ball = game.balls[0];
    ball.position = { x: 500 - ball.radius - 2, y: 450 };
    ball.velocity = { x: 300, y: 0 };
    ball.speed = 300;
    ball.baseSpeed = 250;
    ball.minimumSpeed = 0;

    let slowest = 300;
    for (let i = 0; i < 40; i++) {
      updateBall(ball, 1 / 120, game);
      slowest = Math.min(slowest, Math.hypot(ball.velocity.x, ball.velocity.y));
    }
    return { slowest, game, ball };
  };

  it("slows the ball where a plain wall would not", () => {
    const plain = run(false);
    const padded = run(true);
    expect(plain.slowest, "a plain wall changed the ball's speed").toBeCloseTo(300, 0);
    expect(padded.slowest, "the deformable never fired").toBeLessThan(300);
  });

  it("dents from the POLYGON path too, where no edge wall is in reach", () => {
    // The wall path catches every ordinary contact, so unwiring the polygon
    // path alone leaves the rest of this file green - measured, not assumed.
    // The polygon resolver is what handles a ball that is already INSIDE the
    // solid (a spawn, a phase-in, a portal arrival), and on a big enough pad
    // the middle is further from every edge than the wall band reaches, so this
    // is the one contact only that path can see.
    const big: LevelConfig = {
      id: "deform-big", level: 3, name: "D", sizeThreshold: 30, expectedCuts: 4,
      points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
      entities: [{
        id: "pad", kind: "wall", shape: "rect",
        x: 300, y: 300, width: 240, height: 240, deformable: true,
      }],
    } as unknown as LevelConfig;
    const game = { ...createInitialGameData(big, 3, DEFAULT_MODIFIERS) } as unknown as CanvasGameState;
    const state = [...game.deformables!.values()][0];
    const ball = game.balls[0];
    // Inside the pad, 30 units past its left face - clear of the 23-unit band
    // every edge wall is tested in - and moving deeper. The resolver pushes it
    // back out the way it came and reverses it, which is a real impact.
    ball.position = { x: 330, y: 420 };
    ball.velocity = { x: 300, y: 0 };
    ball.speed = 300;
    ball.baseSpeed = 250;
    updateBall(ball, 1 / 120, game);
    expect(state.dents.length, "the polygon path never dented").toBeGreaterThan(0);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y))
      .toBeCloseTo(300 * DEFORM_SLOW, 0);
  });

  it("does not tax a contact that reflected nothing", () => {
    // The resolver reports `collided` for a ball it merely depenetrated, and
    // ballImpactDamage floors at 0.15 - so without the guard a ball drifting
    // OUT of a solid would be charged 3% and leave a mark for an impact that
    // never happened. Same pad, same spot, moving the other way.
    const big: LevelConfig = {
      id: "deform-big", level: 3, name: "D", sizeThreshold: 30, expectedCuts: 4,
      points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
      entities: [{
        id: "pad", kind: "wall", shape: "rect",
        x: 300, y: 300, width: 240, height: 240, deformable: true,
      }],
    } as unknown as LevelConfig;
    const game = { ...createInitialGameData(big, 3, DEFAULT_MODIFIERS) } as unknown as CanvasGameState;
    const state = [...game.deformables!.values()][0];
    const ball = game.balls[0];
    ball.position = { x: 330, y: 420 };
    ball.velocity = { x: -300, y: 0 };     // on its way out, not into the face
    ball.speed = 300;
    ball.baseSpeed = 250;
    updateBall(ball, 1 / 120, game);
    expect(state.dents.length, "a ball leaving the solid was charged").toBe(0);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeCloseTo(300, 0);
  });

  it("acts exactly once per contact, though two systems both saw it", () => {
    // The invariant that lets both paths be wired. Applied twice the tax would
    // read as 0.97 squared, and nothing on screen would say so.
    const padded = run(true);
    expect(padded.slowest).toBeCloseTo(300 * DEFORM_SLOW, 0);
  });

  it("moves the surface where the ball actually struck it", () => {
    const { game } = run(true);
    const state = [...game.deformables!.values()][0];
    expect(state.dents.length, "no dent was recorded").toBeGreaterThan(0);
    // The ball came in at y=450 against the left face at x=500, so that is
    // where the material went. A dent centred on the ball's MIDDLE would sit a
    // radius clear of the surface and dimple nothing.
    for (const dent of state.dents) {
      expect(Math.abs(dent.at.x - 500)).toBeLessThan(4);
      expect(Math.abs(dent.at.y - 450)).toBeLessThan(20);
    }
    const moved = state.polygon.vertices.filter((v, i) =>
      Math.hypot(v.x - state.original[i].x, v.y - state.original[i].y) > 0.01);
    expect(moved.length, "the face never moved").toBeGreaterThan(0);
  });

  it("keeps the two collision systems on one surface as it sinks", () => {
    const { game } = run(true);
    const state = [...game.deformables!.values()][0];
    for (let i = 0; i < state.walls.length; i++) {
      expect(state.walls[i].start.x).toBeCloseTo(state.polygon.vertices[i].x, 6);
      expect(state.walls[i].start.y).toBeCloseTo(state.polygon.vertices[i].y, 6);
    }
  });

  it("never breaks, and is still solid once it is fully dented", () => {
    // The whole premise: this is the solid that does not come apart. It must
    // never enter the destructible list, it must never leave obstaclePolygons,
    // and - the failure that would show up minutes later somewhere else - a
    // face that has receded must still STOP a ball. updateBall caches a wall's
    // AABB on the stated assumption that walls never move, and uses it as a
    // reject; a dented edge outside its stale box is a wall balls sail through.
    const d = build(true);
    const game = { ...d } as unknown as CanvasGameState;
    expect(game.destructibles.some(x => x.id === "pad")).toBe(false);
    const state = [...game.deformables!.values()][0];
    const ball = game.balls[0];
    ball.baseSpeed = 250;

    // Many separate contacts, the way a map produces them over minutes. The
    // ball is re-seated against the face each time and its cooldown cleared:
    // the cooldown is real and proven in deformable.test.ts, and holding it
    // here would only mean simulating several real minutes to make one point.
    for (let cycle = 0; cycle < 40; cycle++) {
      ball.position = { x: 500 - ball.radius - 2, y: 450 };
      ball.velocity = { x: 400, y: 0 };
      ball.speed = 400;
      ball.lastDeformId = undefined;
      for (let i = 0; i < 6; i++) updateBall(ball, 1 / 120, game);
    }
    expect(state.dents.length, "the pad stopped taking dents").toBeGreaterThan(20);
    for (let i = 0; i < state.original.length; i++) {
      const sink = Math.hypot(
        state.polygon.vertices[i].x - state.original[i].x,
        state.polygon.vertices[i].y - state.original[i].y);
      expect(sink, `vertex ${i} sank past the cap`).toBeLessThanOrEqual(MAX_DENT + 1e-6);
    }
    const deepest = Math.max(...state.original.map((o, i) => Math.hypot(
      state.polygon.vertices[i].x - o.x, state.polygon.vertices[i].y - o.y)));
    expect(deepest, "nothing ever actually dented").toBeGreaterThan(MAX_DENT / 2);
    expect(game.obstaclePolygons).toContain(state.polygon);

    // Still a wall. Fired at the dented face, the ball comes back.
    ball.position = { x: 500 - ball.radius - 2, y: 450 };
    ball.velocity = { x: 400, y: 0 };
    ball.speed = 400;
    for (let i = 0; i < 6; i++) updateBall(ball, 1 / 120, game);
    expect(ball.velocity.x, "the ball went through a wall it had dented")
      .toBeLessThan(0);
  });
});

describe("a player can find out what it is", () => {
  it("answers 'padded block' rather than 'obstacle' when held", () => {
    // A deformable IS in obstaclePolygons, so the plain sweep would swallow it
    // and tell the player "solid, balls bounce off it" about the one wall on
    // the board that quietly takes 3% off every ball.
    const game = { ...build(true) } as unknown as CanvasGameState;
    expect(boardEntityAt(game, 512, 450)?.kind).toBe("deformable");
  });

  it("still answers 'obstacle' for the plain version of the same wall", () => {
    const game = { ...build(false) } as unknown as CanvasGameState;
    expect(boardEntityAt(game, 512, 450)?.kind).toBe("obstacle");
  });
});

describe("the built game carries it to the renderer", () => {
  it("copies deformables onto the live game state", () => {
    // The failure this whole family of tests exists for: a mechanic that is
    // built, wired and tested, and then never assigned to the object the
    // canvas actually reads. Source-read, because the assignment is inside a
    // React effect no unit test mounts.
    const src = readFileSync(
      resolve(__dirname, "../components/game/GameCanvas.tsx"), "utf8");
    expect(src, "GameCanvas never reads the built deformables")
      .toMatch(/game\.deformables\s*=\s*data\.deformables/);
  });

  it("draws the padding from deformPlies rather than a hard-coded contour", () => {
    const src = readFileSync(
      resolve(__dirname, "../lib/rendering/sleek/entityLayer.ts"), "utf8");
    expect(src).toMatch(/deformPlies\(/);
    expect(src, "the renderer never asks whether a polygon is deformable")
      .toMatch(/game\.deformables\?\.get\(/);
  });
});
