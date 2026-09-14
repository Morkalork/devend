/**
 * Control Freak: a mover driven by hand along the rail it already runs on.
 *
 * The claim this file exists to hold is the one the whole feature rests on:
 * THE REACHABLE SET UNDER THE FINGER IS THE PATROL'S OWN SWEPT SET. If that
 * stays true, "it must not go through walls and objects" needs no collision
 * code at all, because a hand-driven mover cannot occupy a cell its automatic
 * self does not pass through every few seconds anyway. If it ever stops being
 * true, every map's clearances are wrong at once and nothing else here matters.
 *
 * The other half is the fence, which is the one thing that was not there when
 * the map was authored. A patrol only ever DRAGS through a fence, on purpose.
 * A held mover stops dead at one, also on purpose: parking it is the whole
 * point of the upgrade, so the exploit that rule exists to prevent is not an
 * exploit here.
 */
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import {
  buildMoverPolygon, buildRotorOutline, updateMoverPolygon,
  moverBoundRadius, type MoverState,
} from "@/lib/physics/moverState";
import {
  DERAIL_HOLD_MS, beginSnap, derailMover, derailProgress, driveToward,
  isPlayerControlled, maxSnapRate, moverAt, moverSurfaceVelocity, nativeRailRate,
  railArm, railLimit, railParam, railPull, railReading, releaseMover,
  setRailParam, unwrapAngle, updateMoverControlFn,
} from "@/lib/physics/moverControl";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import { BAND_DEAD_PULL } from "@/lib/rubberBand";
import type { CanvasGameState } from "@/types/gameState";
import type { Wall } from "@/lib/wallGeometry";

const STEP = 1 / 120;

/** A horizontal shuttle: 90 x 26, ranging 200 about (400, 400). */
const shuttle = (over: Partial<MoverState> = {}): MoverState => {
  const m: MoverState = {
    id: "s1", shape: "rect", homeX: 400, homeY: 400, width: 90, height: 26,
    axis: "horizontal", range: 200, speed: 60, offset: 0, direction: 1,
    polygon: { vertices: [] }, ...over,
  } as MoverState;
  m.polygon = buildMoverPolygon(m);
  return m;
};

/** A wiper: a 200 x 20 bar on an arm, pivoting 110 below its own middle. */
const wiper = (over: Partial<MoverState> = {}): MoverState => {
  const bar: MoverState = {
    id: "r1", shape: "rect", homeX: 450, homeY: 310, width: 20, height: 200,
    axis: "horizontal", range: 0, speed: 55, offset: 0, direction: 1,
    motion: "rotate", angle: 0, polygon: { vertices: [] },
  } as MoverState;
  const base = buildRotorOutline(bar);
  const m: MoverState = {
    ...bar,
    rotorOutline: base.map(p => ({ x: p.x + 450 - 450, y: p.y + 310 - 420 })),
    homeX: 450, homeY: 420,
    halfSweep: (120 * Math.PI) / 360,
    ...over,
  };
  m.polygon = buildMoverPolygon(m);
  return m;
};

const scene = (movers: MoverState[], walls: Wall[] = []): CanvasGameState => ({
  movers, walls, mapMutator: null, lockedBallsCount: 0,
  moverDrag: null, moverDerailsRemaining: 0, moverBandsRemaining: 0,
  destructibles: [], pendingDestroys: [],
} as unknown as CanvasGameState);

/** A finished player fence across the given segment. */
const fence = (x1: number, y1: number, x2: number, y2: number): Wall => ({
  id: "f1", start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
  thickness: 6, isPlayerFence: true,
} as unknown as Wall);

const grab = (
  game: CanvasGameState, m: MoverState, x: number, y: number,
  over: Partial<NonNullable<CanvasGameState["moverDrag"]>> = {},
): void => {
  game.moverDrag = {
    moverId: m.id, pointerId: 1, pointer: { x, y },
    ref: railReading(m, x, y) - railParam(m),
    driveMultiplier: 1, canDerail: false, canBand: false,
    stopHoldMs: 0, derailAt: 0, ...over,
  };
};

// ── The claim everything rests on ──────────────────────────────────────────

describe("the hand can reach exactly what the patrol reaches", () => {
  it("cannot drive a shuttle past either end of its authored range", () => {
    const m = shuttle();
    const game = scene([m]);
    grab(game, m, 400, 400);
    // Ask for somewhere a very long way off the rail, for a long time.
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    for (let i = 0; i < 2000; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(railParam(m)).toBeCloseTo(100, 6);

    game.moverDrag!.pointer = { x: -5000, y: 400 };
    for (let i = 0; i < 2000; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(railParam(m)).toBeCloseTo(-100, 6);
  });

  it("cannot drive a wiper past either end of its authored sweep", () => {
    const m = wiper();
    const game = scene([m]);
    grab(game, m, 450, 210);
    game.moverDrag!.pointer = { x: 5000, y: 420 };
    for (let i = 0; i < 2000; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(railParam(m)).toBeCloseTo(railLimit(m)!, 6);

    game.moverDrag!.pointer = { x: -5000, y: 420 };
    for (let i = 0; i < 2000; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(railParam(m)).toBeCloseTo(-railLimit(m)!, 6);
  });

  it("occupies nothing the free-running patrol does not also occupy", () => {
    // The whole argument for needing no collision code, stated as a test: sweep
    // the patrol to get its envelope, then drive it by hand to a thousand
    // positions and check every vertex lands inside that envelope.
    for (const make of [shuttle, wiper]) {
      const patrol = make();
      const pGame = scene([patrol]);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < 4000; i++) {
        updateMoversFn(STEP, pGame);
        for (const v of patrol.polygon.vertices) {
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
      }

      const hand = make();
      const limit = railLimit(hand)!;
      for (let i = 0; i <= 1000; i++) {
        setRailParam(hand, -limit + (i / 1000) * 2 * limit);
        for (const v of hand.polygon.vertices) {
          expect(v.x).toBeGreaterThanOrEqual(minX - 1e-6);
          expect(v.x).toBeLessThanOrEqual(maxX + 1e-6);
          expect(v.y).toBeGreaterThanOrEqual(minY - 1e-6);
          expect(v.y).toBeLessThanOrEqual(maxY + 1e-6);
        }
      }
    }
  });
});

// ── Driving ────────────────────────────────────────────────────────────────

describe("driving a mover by hand", () => {
  it("keeps the grip under the finger instead of snapping the body to it", () => {
    const m = shuttle();
    const game = scene([m]);
    // Grab the mover's right-hand end, not its centre.
    grab(game, m, 440, 400);
    game.moverDrag!.pointer = { x: 460, y: 400 };
    for (let i = 0; i < 200; i++) updateMoverControlFn(STEP, game, i * 8);
    // The body moved by the 20 the finger moved, not to where the finger is.
    expect(railParam(m)).toBeCloseTo(20, 3);
  });

  it("is rate-capped to the mover's own speed", () => {
    const m = shuttle();
    const game = scene([m]);
    grab(game, m, 400, 400);
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    updateMoverControlFn(STEP, game, 0);
    expect(railParam(m)).toBeCloseTo(m.speed * STEP, 6);
  });

  it("drives a rotor in radians per second, from its degrees-per-second speed", () => {
    const m = wiper();
    const game = scene([m]);
    grab(game, m, 450, 210);
    game.moverDrag!.pointer = { x: 5000, y: 420 };
    updateMoverControlFn(STEP, game, 0);
    expect(railParam(m)).toBeCloseTo(nativeRailRate(m) * STEP, 9);
    expect(nativeRailRate(m)).toBeCloseTo((55 * Math.PI) / 180, 9);
  });

  it("holds a mover still with no drive tier, and the map cannot move it either", () => {
    // The brake: a crank with a rate of zero. One code path, not a special case.
    const m = shuttle();
    const game = scene([m]);
    grab(game, m, 400, 400, { driveMultiplier: 0 });
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    for (let i = 0; i < 300; i++) {
      updateMoverControlFn(STEP, game, i * 8);
      updateMoversFn(STEP, game);
    }
    expect(railParam(m)).toBe(0);
    expect(m.driveRate).toBe(0);
  });

  it("lets the map have the mover back the moment it is released", () => {
    const m = shuttle();
    const game = scene([m]);
    grab(game, m, 400, 400, { driveMultiplier: 0 });
    updateMoversFn(STEP, game);
    expect(railParam(m)).toBe(0);
    releaseMover(game, m);
    updateMoversFn(STEP, game);
    expect(railParam(m)).toBeGreaterThan(0);
  });

  it("resumes from where it was parked rather than snapping back", () => {
    const m = shuttle();
    const game = scene([m]);
    grab(game, m, 400, 400);
    game.moverDrag!.pointer = { x: 470, y: 400 };
    for (let i = 0; i < 500; i++) updateMoverControlFn(STEP, game, i * 8);
    const parked = railParam(m);
    expect(parked).toBeCloseTo(70, 3);
    releaseMover(game, m);
    updateMoversFn(STEP, game);
    expect(Math.abs(railParam(m) - parked)).toBeLessThan(1);
  });

  it("cranks a full-circle rotor past the seam instead of whipping round", () => {
    expect(unwrapAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(Math.PI + 0.1, 9);
    expect(unwrapAngle(0.2, 0.1)).toBeCloseTo(0.2, 9);
  });

  it("marks a mover as the player's while held or snapping, and not otherwise", () => {
    const m = shuttle();
    const game = scene([m]);
    expect(isPlayerControlled(game, m)).toBe(false);
    grab(game, m, 400, 400);
    expect(isPlayerControlled(game, m)).toBe(true);
    game.moverDrag = null;
    setRailParam(m, 80);
    beginSnap(m);
    expect(isPlayerControlled(game, m)).toBe(true);
  });
});

// ── The fence, which is the one thing the rail does not already cover ──────

describe("a held mover stops at the player's own fence", () => {
  it("stops short rather than grinding through it", () => {
    // A fence straight across the rail, to the right of home.
    const m = shuttle();
    const game = scene([m], [fence(460, 300, 460, 500)]);
    grab(game, m, 400, 400);
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    for (let i = 0; i < 2000; i++) updateMoverControlFn(STEP, game, i * 8);
    // Short of both the fence and the end of the rail.
    expect(railParam(m)).toBeGreaterThan(0);
    expect(railParam(m)).toBeLessThan(100);
    expect(m.polygon.vertices.every(v => v.x < 460)).toBe(true);
  });

  it("still lets a PATROL labour through it, exactly as it always did", () => {
    const m = shuttle();
    const game = scene([m], [fence(460, 300, 460, 500)]);
    game.moverFenceDragPerFence = 0.45;
    game.moverFenceDragFloor = 0.25;
    let furthest = 0;
    for (let i = 0; i < 4000; i++) {
      updateMoversFn(STEP, game);
      furthest = Math.max(furthest, railParam(m));
    }
    // It got past the fence to the far end of its range, labouring but never
    // stopped. Measured as the furthest it reached rather than where it
    // happened to be at the last step, since it goes on patrolling afterwards.
    expect(furthest).toBeGreaterThan(90);
  });

  it("does not weld a mover a fence was built on top of", () => {
    // A fence drawn across a mover while it patrolled would otherwise pin it in
    // place, which reads as a broken tool rather than as a rule.
    const m = shuttle();
    const game = scene([m], [fence(400, 300, 400, 500)]);
    grab(game, m, 400, 400);
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    for (let i = 0; i < 200; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(railParam(m)).toBeGreaterThan(0);
  });

  it("reports the block so nothing counts it as reaching the end stop", () => {
    const m = shuttle();
    const game = scene([m], [fence(460, 300, 460, 500)]);
    for (let i = 0; i < 500; i++) driveToward(m, 100, m.speed, STEP, game.walls);
    const r = driveToward(m, 100, m.speed, STEP, game.walls);
    expect(r.blocked).toBe(true);
    expect(r.atLimit).toBe(false);
  });
});

// ── The surface, which is what a bumper throws with ────────────────────────

describe("a mover's surface velocity", () => {
  it("is exactly zero for an ordinary patrol, so no shipped map moves a hair", () => {
    const m = shuttle();
    const game = scene([m]);
    for (let i = 0; i < 50; i++) updateMoversFn(STEP, game);
    expect(moverSurfaceVelocity(m, 400, 400)).toEqual({ x: 0, y: 0 });
  });

  it("runs along the axis for a driven shuttle", () => {
    const m = shuttle({ driveRate: 120 });
    expect(moverSurfaceVelocity(m, 400, 400)).toEqual({ x: 120, y: 0 });
    const v = shuttle({ axis: "vertical", driveRate: -80 });
    expect(moverSurfaceVelocity(v, 400, 400)).toEqual({ x: 0, y: -80 });
  });

  it("is omega x r for a rotor, so the tip throws far harder than the hub", () => {
    const m = wiper({ driveRate: 2 });
    const hub = moverSurfaceVelocity(m, m.homeX, m.homeY - 20);
    const tip = moverSurfaceVelocity(m, m.homeX, m.homeY - 210);
    expect(Math.hypot(hub.x, hub.y)).toBeCloseTo(40, 6);
    expect(Math.hypot(tip.x, tip.y)).toBeCloseTo(420, 6);
    expect(Math.hypot(tip.x, tip.y)).toBeGreaterThan(Math.hypot(hub.x, hub.y) * 10);
  });

  it("is perpendicular to the arm, which is the direction a bat sends things", () => {
    const m = wiper({ driveRate: 1 });
    const v = moverSurfaceVelocity(m, m.homeX, m.homeY - 210);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.x).toBeCloseTo(210, 6);
  });
});

// ── The bumper ─────────────────────────────────────────────────────────────

describe("the bumper", () => {
  it("does not fire below the band's dead zone", () => {
    const m = shuttle();
    setRailParam(m, BAND_DEAD_PULL - 1);
    expect(beginSnap(m)).toBe(false);
    expect(m.snap).toBeUndefined();
  });

  it("fires harder the further it was pulled", () => {
    const a = shuttle(); setRailParam(a, 40);  beginSnap(a);
    const b = shuttle(); setRailParam(b, 100); beginSnap(b);
    expect(b.snap!.rate).toBeGreaterThan(a.snap!.rate);
    expect(b.snap!.powerT).toBeGreaterThan(a.snap!.powerT);
  });

  it("scales off the mover's OWN speed, so how hard a bumper hits is authored", () => {
    const slow = shuttle({ speed: 30 }); setRailParam(slow, 100); beginSnap(slow);
    const fast = shuttle({ speed: 120 }); setRailParam(fast, 100); beginSnap(fast);
    expect(fast.snap!.rate).toBeCloseTo(slow.snap!.rate * 4, 6);
  });

  it("never snaps fast enough for a ball to pass through the tip untested", () => {
    // The guard that is about correctness rather than balance: a wildly fast
    // patrol must not be able to break collision by tripling its own speed.
    const m = shuttle({ speed: 100000 });
    setRailParam(m, 100);
    beginSnap(m);
    expect(m.snap!.rate).toBeLessThanOrEqual(maxSnapRate(m));
  });

  it("snaps back to rest and then hands the mover back to the map", () => {
    const m = shuttle();
    const game = scene([m]);
    setRailParam(m, 100);
    expect(beginSnap(m)).toBe(true);
    for (let i = 0; i < 4000 && m.snap; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(m.snap).toBeUndefined();
    expect(railParam(m)).toBeCloseTo(0, 6);
    expect(m.driveRate).toBe(0);
    expect(isPlayerControlled(game, m)).toBe(false);
  });

  it("carries a real surface velocity while it is snapping", () => {
    const m = shuttle();
    const game = scene([m]);
    setRailParam(m, 100);
    beginSnap(m);
    updateMoverControlFn(STEP, game, 0);
    expect(Math.abs(m.driveRate ?? 0)).toBeGreaterThan(m.speed);
    expect(moverSurfaceVelocity(m, 400, 400).x).toBeLessThan(0);   // heading home
  });

  it("is stopped by a fence on the way home, like everything else", () => {
    const m = shuttle();
    const game = scene([m], [fence(450, 300, 450, 500)]);
    setRailParam(m, 100);
    beginSnap(m);
    for (let i = 0; i < 4000 && m.snap; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(m.snap).toBeUndefined();
    expect(railParam(m)).toBeGreaterThan(0);
  });

  it("fires on release only with the tier fitted and a ration left", () => {
    const m = shuttle();
    const game = scene([m]);
    setRailParam(m, 100);

    grab(game, m, 400, 400, { canBand: false });
    expect(releaseMover(game, m)).toBe(false);
    expect(m.snap).toBeUndefined();

    grab(game, m, 400, 400, { canBand: true });
    expect(releaseMover(game, m)).toBe(false);   // no ration
    expect(m.snap).toBeUndefined();

    game.moverBandsRemaining = 2;
    grab(game, m, 400, 400, { canBand: true });
    expect(releaseMover(game, m)).toBe(true);
    expect(game.moverBandsRemaining).toBe(1);
  });

  it("spends no ration on a release that was not a pull", () => {
    const m = shuttle();
    const game = scene([m]);
    game.moverBandsRemaining = 2;
    setRailParam(m, 2);
    grab(game, m, 400, 400, { canBand: true });
    expect(releaseMover(game, m)).toBe(false);
    expect(game.moverBandsRemaining).toBe(2);
  });

  it("always clears the drag, fired or not", () => {
    const m = shuttle();
    const game = scene([m]);
    grab(game, m, 400, 400, { canBand: true });
    releaseMover(game, m);
    expect(game.moverDrag).toBeNull();
  });

  it("measures a rotor's pull through its arm, so one curve fits both rails", () => {
    const m = wiper();
    expect(railArm(m)).toBeCloseTo(moverBoundRadius(m), 6);
    setRailParam(m, 0.5);
    expect(railPull(m)).toBeCloseTo(0.5 * moverBoundRadius(m), 6);
    const s = shuttle();
    expect(railArm(s)).toBe(1);
    setRailParam(s, 37);
    expect(railPull(s)).toBe(37);
  });
});

// ── The derail ─────────────────────────────────────────────────────────────

describe("the derail", () => {
  const heldAtLimit = (game: CanvasGameState, m: MoverState, ms: number): void => {
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    const steps = Math.ceil(ms / (STEP * 1000)) + 400;
    for (let i = 0; i < steps; i++) updateMoverControlFn(STEP, game, i * 8);
  };

  it("needs the mover walked to its end stop and held there", () => {
    const m = shuttle();
    const game = scene([m]);
    game.moverDerailsRemaining = 1;
    grab(game, m, 400, 400, { canDerail: true });
    // Well short of the hold: driven to the end, but only just.
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    for (let i = 0; i < 200; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(game.pendingDestroys).toHaveLength(0);

    heldAtLimit(game, m, DERAIL_HOLD_MS);
    expect(game.pendingDestroys).toHaveLength(1);
    expect(game.moverDerailsRemaining).toBe(0);
    expect(game.moverDrag).toBeNull();
  });

  it("resets the hold the moment the mover comes off the stop", () => {
    const m = shuttle();
    const game = scene([m]);
    game.moverDerailsRemaining = 1;
    grab(game, m, 400, 400, { canDerail: true });
    // 200 steps reaches the end stop (100 units at 60/s); the next 30 are hold,
    // which is under DERAIL_HOLD_MS, so the windup is showing but has not fired.
    game.moverDrag!.pointer = { x: 5000, y: 400 };
    for (let i = 0; i < 230; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(derailProgress(game.moverDrag)).toBeGreaterThan(0);
    expect(derailProgress(game.moverDrag)).toBeLessThan(1);
    game.moverDrag!.pointer = { x: 400, y: 400 };
    updateMoverControlFn(STEP, game, 9999);
    expect(derailProgress(game.moverDrag)).toBe(0);
  });

  it("does nothing without the tier, however long it is leaned on", () => {
    const m = shuttle();
    const game = scene([m]);
    game.moverDerailsRemaining = 1;
    grab(game, m, 400, 400, { canDerail: false });
    heldAtLimit(game, m, DERAIL_HOLD_MS * 3);
    expect(game.pendingDestroys).toHaveLength(0);
  });

  it("does nothing with the tier but no ration left", () => {
    const m = shuttle();
    const game = scene([m]);
    game.moverDerailsRemaining = 0;
    grab(game, m, 400, 400, { canDerail: true });
    heldAtLimit(game, m, DERAIL_HOLD_MS * 3);
    expect(game.pendingDestroys).toHaveLength(0);
  });

  it("refuses the map's own objective, and spends nothing doing so", () => {
    const m = shuttle();
    const game = scene([m]);
    game.moverDerailsRemaining = 1;
    game.destructibles = [{
      id: m.id, moverId: m.id, kind: "mover", hits: 0, maxHits: 2, lastHitAt: 0,
      destroyed: false, objective: true, chest: false, fenceStyle: false,
      obstaclePolygon: m.polygon,
    }] as unknown as CanvasGameState["destructibles"];
    expect(derailMover(game, m)).toBe(false);
    expect(game.pendingDestroys).toHaveLength(0);
    expect(game.moverDerailsRemaining).toBe(1);
  });

  it("refuses a chest, whose reward comes from smashing it", () => {
    const m = shuttle();
    const game = scene([m]);
    game.moverDerailsRemaining = 1;
    game.destructibles = [{
      id: m.id, moverId: m.id, kind: "mover", hits: 0, maxHits: 2, lastHitAt: 0,
      destroyed: false, objective: false, chest: true, fenceStyle: false,
      obstaclePolygon: m.polygon,
    }] as unknown as CanvasGameState["destructibles"];
    expect(derailMover(game, m)).toBe(false);
    expect(game.moverDerailsRemaining).toBe(1);
  });

  it("has no end stop to hold on a rotor that spins all the way round", () => {
    const m = wiper({ halfSweep: undefined });
    expect(railLimit(m)).toBeNull();
    const game = scene([m]);
    game.moverDerailsRemaining = 1;
    grab(game, m, 450, 210, { canDerail: true });
    game.moverDrag!.pointer = { x: 5000, y: 420 };
    for (let i = 0; i < 3000; i++) updateMoverControlFn(STEP, game, i * 8);
    expect(game.pendingDestroys).toHaveLength(0);
  });
});

// ── Picking one up ─────────────────────────────────────────────────────────

describe("grabbing", () => {
  it("finds a mover under the finger, and nothing when there is none", () => {
    const m = shuttle();
    const game = scene([m]);
    expect(moverAt(game, 400, 400)?.id).toBe("s1");
    expect(moverAt(game, 400, 800)).toBeNull();
  });

  it("reaches a little past the body, and not a ring of open board", () => {
    // The slop is a finger's imprecision at the edge, not the sling's halo: a
    // mover is one of the biggest things on the board, and wrapping it in 40
    // units would take that much ordinary board out of use for starting cuts.
    const m = shuttle();
    const game = scene([m]);
    // 26 tall, so the top face is 13 above centre.
    expect(moverAt(game, 400, 400 - 13 - 8)?.id).toBe("s1");
    expect(moverAt(game, 400, 400 - 13 - 30)).toBeNull();
  });

  it("puts a mover down gently when a second finger cancels the grab", () => {
    // The escape hatch a bumper owner needs: with a band fitted every ORDINARY
    // release fires, so cancelling has to be the way to park it without a
    // throw. The input handler clears the drag directly rather than releasing
    // it, which is what makes the two endings different.
    const m = shuttle();
    const game = scene([m]);
    game.moverBandsRemaining = 2;
    setRailParam(m, 100);
    grab(game, m, 400, 400, { canBand: true });
    // What the second-finger branch does.
    game.moverDrag = null;
    m.driveRate = 0;
    expect(m.snap).toBeUndefined();
    expect(game.moverBandsRemaining).toBe(2);
    expect(isPlayerControlled(game, m)).toBe(false);
  });

  it("finds a wiper by its arm, not only near its hub", () => {
    const m = wiper();
    const game = scene([m]);
    expect(moverAt(game, 450, 230)?.id).toBe("r1");
  });
});

// ── The map this was built for ─────────────────────────────────────────────

describe("level 17's wiper", () => {
  it("sweeps clear of the brick wall, the barrel and the board", () => {
    // The envelope guard. Level 17 is the first Demolition map and the only one
    // with a rotor; an edit that slid the pivot or widened the sweep would put
    // the arm through the glass it is meant to serve balls into, and nothing
    // else in the suite would notice.
    const d = yaml.load(readFileSync("public/map.yml", "utf8")) as {
      levels: { level: number; entities: Record<string, number | string>[] }[];
    };
    const lv = d.levels.find(l => l.level === 17)!;
    const e = lv.entities.find(x => x.id === "wiper") as unknown as {
      x: number; y: number; width: number; height: number;
      pivotX: number; pivotY: number; sweepDegrees: number; speed: number;
    };
    expect(e, "level 17 has no wiper").toBeTruthy();

    const homeX = e.x + e.width / 2, homeY = e.y + e.height / 2;
    const bar: MoverState = {
      id: "wiper", shape: "rect", homeX, homeY, width: e.width, height: e.height,
      axis: "horizontal", range: 0, speed: e.speed, offset: 0, direction: 1,
      motion: "rotate", angle: 0, polygon: { vertices: [] },
    } as MoverState;
    const m: MoverState = {
      ...bar,
      rotorOutline: buildRotorOutline(bar).map(p => ({
        x: p.x + homeX - e.pivotX, y: p.y + homeY - e.pivotY,
      })),
      homeX: e.pivotX, homeY: e.pivotY,
      halfSweep: (e.sweepDegrees * Math.PI) / 360,
    };
    m.polygon = buildMoverPolygon(m);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= 400; i++) {
      m.angle = -m.halfSweep! + (i / 400) * 2 * m.halfSweep!;
      updateMoverPolygon(m);
      for (const v of m.polygon.vertices) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
    }

    expect(minY, "the wiper reaches the brick wall (rows end at y=135)").toBeGreaterThan(175);
    expect(maxY, "the wiper reaches into the barrel (it starts at y=600)").toBeLessThan(560);
    expect(minX).toBeGreaterThan(20);
    expect(maxX).toBeLessThan(880);
  });

  it("is a hazard the map does not depend on: nothing in the win mentions it", () => {
    const d = yaml.load(readFileSync("public/map.yml", "utf8")) as {
      levels: { level: number; win?: { require?: { kind: string }[] } }[];
    };
    const lv = d.levels.find(l => l.level === 17)!;
    const kinds = (lv.win?.require ?? []).map(r => r.kind);
    // The bot sweep cannot drive a mover, so a Demolition win may never need one.
    expect(kinds).not.toContain("movers");
    expect(kinds.length).toBeGreaterThan(0);
  });
});
