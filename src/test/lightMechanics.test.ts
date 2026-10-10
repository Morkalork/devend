/**
 * Light as a mechanic (rendering/three/lightMechanics.ts, cutPreview3d.ts,
 * lib/cutPreview.ts): the 3D board's light carrying information.
 *
 * Each of these is only worth having if it tells the truth about the game, so
 * the tests are mostly about agreement: the dark side of a cut preview is the
 * ground the real capture takes, the pillar's warning lands just before the
 * pillar does, the charge's red ends where its blast ends, the glow is graded
 * against the thresholds the lock check uses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CircuitSparks, DRAIN_DEPTH, PHASE_LEAD_SECONDS, SPARK_MS, chargeLights, chargePulse,
  phaseCasters, pocketHeat, pocketTightness, powerLevel,
} from "@/lib/rendering/three/lightMechanics";
import { predictCapture, previewCutPaths, previewKey } from "@/lib/cutPreview";
import { secondsUntilSolid, tickPhasing } from "@/lib/physics/phasing";
import { createSpaceGrid, findGridRegions, gridIndexToWorld } from "@/lib/spaceGrid";
import { createWallsFromPolygon } from "@/lib/wallGeometry";
import { shadowOnlyMaterial } from "@/lib/rendering/three/cutPreview3d";
import { DEFAULT_LIGHT_LOOK } from "@/lib/lightLook";
import type { CanvasGameState } from "@/types/gameState";
import type { PhasingObjectState } from "@/types/game";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const BOARD = { vertices: [{ x: 45, y: 45 }, { x: 855, y: 45 }, { x: 855, y: 855 }, { x: 45, y: 855 }] };

/** A real grid and real board walls, with balls where asked. */
function board(balls: Array<{ id: string; x: number; y: number }>, over: Partial<CanvasGameState> = {}): CanvasGameState {
  const grid = createSpaceGrid(BOARD, []);
  const regions = findGridRegions(grid);
  for (const r of regions) for (const i of r.cellIndices) grid.cellRegionIds[i] = r.id;
  return {
    spaceGrid: grid,
    gridRegions: regions,
    walls: createWallsFromPolygon(BOARD, "board"),
    obstaclePolygons: [],
    destructibles: [],
    balls: balls.map(b => ({
      id: b.id, position: { x: b.x, y: b.y }, velocity: { x: 100, y: 0 }, speed: 100,
      radius: 18, state: "active",
    })),
    activePlaySeconds: 0,
    ...over,
  } as unknown as CanvasGameState;
}

describe("the cut preview's dark side is the ground the cut takes", () => {
  it("darkens the empty side of a cut and nothing on the ball's side", () => {
    // A vertical cut down the middle with the only ball on the left.
    const game = board([{ id: "a", x: 200, y: 450 }], {
      swipeStart: { x: 450, y: 300 }, currentSwipePos: { x: 450, y: 600 }, swipeRegionId: "r", swipePath: [],
    } as unknown as Partial<CanvasGameState>);
    const preview = previewCutPaths(game)!;
    expect(preview).not.toBeNull();
    expect(preview.dud).toBe(false);
    const mask = predictCapture(game, preview)!;
    const grid = game.spaceGrid!;
    let left = 0, right = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (gridIndexToWorld(grid, i).x < 450) left++; else right++;
    }
    expect(left, "nothing on the ball's side goes dark").toBe(0);
    expect(right, "the empty side does").toBeGreaterThan(500);
  });

  it("darkens nothing when both sides keep a ball", () => {
    const game = board([{ id: "a", x: 200, y: 450 }, { id: "b", x: 700, y: 450 }], {
      swipeStart: { x: 450, y: 300 }, currentSwipePos: { x: 450, y: 600 }, swipeRegionId: "r", swipePath: [],
    } as unknown as Partial<CanvasGameState>);
    const mask = predictCapture(game, previewCutPaths(game)!)!;
    expect(mask.reduce((n, v) => n + v, 0)).toBe(0);
  });

  it("does not run on a drag still too short to have a direction", () => {
    const game = board([{ id: "a", x: 200, y: 450 }], {
      swipeStart: { x: 450, y: 300 }, currentSwipePos: { x: 452, y: 301 }, swipeRegionId: "r", swipePath: [],
    } as unknown as Partial<CanvasGameState>);
    expect(previewCutPaths(game)).toBeNull();
  });

  it("re-simulates only when the drag has moved", () => {
    const at = (y: number) => board([{ id: "a", x: 200, y: 450 }], {
      swipeStart: { x: 450, y: 300 }, currentSwipePos: { x: 450, y }, swipeRegionId: "r", swipePath: [],
    } as unknown as Partial<CanvasGameState>);
    expect(previewKey(previewCutPaths(at(600))!)).toBe(previewKey(previewCutPaths(at(600.1))!));
  });

  it("is the same preview the 2D layer draws", () => {
    expect(read("src/lib/rendering/sleek/fxLayer.ts")).toMatch(/const preview = previewCutPaths\(game\);/);
    expect(read("src/lib/rendering/three/cutPreview3d.ts")).toMatch(/previewCutPaths\(game\)/);
  });

  it("stands up a wall only light can see", () => {
    const m = shadowOnlyMaterial();
    expect(m.colorWrite).toBe(false);
    expect(m.depthWrite).toBe(false);
  });
});

describe("the pocket glow is graded against the lock check's thresholds", () => {
  it("heats toward the lock threshold and goes gold within one halving of superior", () => {
    expect(pocketTightness(50, 10, 4)).toEqual({ heat: 0, gold: 0 });
    expect(pocketTightness(10, 10, 4).heat).toBe(1);
    const mid = pocketTightness(25, 10, 4);
    expect(mid.heat).toBeGreaterThan(0);
    expect(mid.heat).toBeLessThan(1);
    expect(pocketTightness(12, 10, 4).gold).toBe(0);   // 3x the bar
    expect(pocketTightness(8, 10, 4).gold).toBe(1);    // 2x the bar
  });

  it("measures a ball's region the way checkBallWonState does", () => {
    const game = board([{ id: "a", x: 200, y: 450 }], { lockWinThresholdPercent: 10 } as Partial<CanvasGameState>);
    // One ball, the whole board: nowhere near a pocket.
    expect(pocketHeat(game).get("a")).toEqual({ heat: 0, gold: 0 });
  });
});

describe("the charge tell", () => {
  const charge = (over: object = {}) => ({
    fuse: { x: 100, y: 200 }, radius: 20, targetId: "slab", blastRadius: 150, delaySeconds: 3,
    armedAt: null as number | null, blown: false, ...over,
  });

  it("is a small amber fuse until armed, then a red disc of exactly the blast", () => {
    const idle = chargeLights({ charges: [charge()], activePlaySeconds: 5, destructibles: [] } as unknown as CanvasGameState, 1);
    expect(idle).toHaveLength(1);
    expect(idle[0].cutoff).toBeFalsy();
    expect(idle[0].reach).toBeLessThan(60);

    const slab = { vertices: [{ x: 400, y: 400 }, { x: 440, y: 400 }, { x: 440, y: 440 }, { x: 400, y: 440 }] };
    const armed = chargeLights({
      charges: [charge({ armedAt: 4 })], activePlaySeconds: 5,
      destructibles: [{ id: "slab", obstaclePolygon: slab, destroyed: false }],
    } as unknown as CanvasGameState, 1);
    expect(armed[0].cutoff).toBe(true);
    expect(armed[0].reach).toBe(150);
    // Centred on the blast, which physics centres on the target slab.
    expect([armed[0].x, armed[0].y]).toEqual([420, 420]);
  });

  it("goes out once blown, and with its dial", () => {
    expect(chargeLights({ charges: [charge({ blown: true })], destructibles: [] } as unknown as CanvasGameState, 1)).toHaveLength(0);
    expect(chargeLights({ charges: [charge()], destructibles: [] } as unknown as CanvasGameState, 0)).toHaveLength(0);
  });

  it("pulses faster as it nears", () => {
    const peaks = (from: number, to: number) => {
      let n = 0, prev = chargePulse(from, 3), rising = false;
      for (let t = from + 0.005; t < to; t += 0.005) {
        const v = chargePulse(t, 3);
        if (rising && v < prev) n++;
        rising = v > prev; prev = v;
      }
      return n;
    };
    expect(peaks(2, 3)).toBeGreaterThan(peaks(0, 1) * 2);
  });
});

describe("the pillar's shadow comes before the pillar", () => {
  const pillar = (): PhasingObjectState => ({
    id: "p", polygon: { vertices: [{ x: 300, y: 300 }, { x: 340, y: 300 }, { x: 340, y: 340 }, { x: 300, y: 340 }] },
    wallIds: [], startedAt: 0, cycleSeconds: 10, phase: "out", alpha: 0,
  });

  it("knows when the pillar turns solid, by the same cycle tickPhasing runs", () => {
    const obj = pillar();
    const game = { phasingObjects: [obj], balls: [] } as unknown as CanvasGameState;
    // Out from 5.5s; find where the physics turns it back in.
    let solidAt = -1;
    for (let t = 6; t < 10.5; t += 0.01) {
      tickPhasing(game, t);
      if (obj.phase === "in") { solidAt = t; break; }
      const until = secondsUntilSolid(obj, t)!;
      expect(until).toBeGreaterThan(0);
    }
    expect(solidAt).toBeCloseTo(9.5, 1);
    expect(secondsUntilSolid({ ...pillar(), phase: "out" }, 9)).toBeCloseTo(0.5, 6);
  });

  it("raises a caster over the lead, and none for latches, cages or a far-off return", () => {
    const at = (t: number, over: Partial<PhasingObjectState> = {}) => phaseCasters(
      { phasingObjects: [{ ...pillar(), ...over }], activePlaySeconds: t } as unknown as CanvasGameState, 1, 1,
    );
    expect(at(7)).toHaveLength(0);
    const early = at(9.5 - PHASE_LEAD_SECONDS + 0.1)[0].height;
    const late = at(9.45)[0].height;
    expect(late).toBeGreaterThan(early);
    expect(at(9.45, { latchAfter: 1 })).toHaveLength(0);
    expect(at(9.45, { cageOf: "c" })).toHaveLength(0);
  });
});

describe("the room loses power, the balls do not", () => {
  it("is full until the last stretch and no darker than the drain allows", () => {
    expect(powerLevel(60, 90, 1)).toBe(1);
    expect(powerLevel(31, 90, 1)).toBe(1);
    expect(powerLevel(0, 90, 1)).toBeCloseTo(1 - DRAIN_DEPTH, 6);
    expect(powerLevel(0, 90, 0)).toBe(1);
  });

  it("stutters just after 30s and 20s, and only on a map longer than the mark", () => {
    // Against the moment just before each mark, which is steady.
    expect(powerLevel(29.96, 90, 1)).toBeLessThan(powerLevel(30.2, 90, 1) * 0.8);
    expect(powerLevel(19.96, 90, 1)).toBeLessThan(powerLevel(20.2, 90, 1) * 0.8);
    // Over within the stutter's 0.6s.
    expect(powerLevel(29.3, 90, 1)).toBeCloseTo(powerLevel(30.2, 90, 1), 2);
    // A 25s map does not stutter at 30 (it is in its drain, but evenly).
    expect(powerLevel(29.96, 25, 1)).toBe(1);
  });

  it("dims the room's lights, never the balls'", () => {
    const src = read("src/lib/rendering/three/ThreeRenderer.ts");
    expect(src).toMatch(/rig\.lights\.sync\(wanted, frame\.monitorLevel, frame\.lampLevel, roomLevel\(game\.mapLight\) \* power\)/);
    expect(read("src/components/game/GameCanvas.tsx")).toMatch(/rctx\.deadlineLimit = deadlineSecondsLeftRef\.current != null \? deadlineLimitRef\.current : null;/);
  });
});

describe("the circuit spark", () => {
  it("runs from a newly lit terminal to the ball it wakes, then is gone", () => {
    const terminal = { x: 100, y: 100, radius: 20, lit: false, ballId: "sleeper" };
    const game = {
      circuit: { terminals: [terminal] },
      balls: [{ id: "sleeper", position: { x: 500, y: 100 } }],
    } as unknown as CanvasGameState;
    const sparks = new CircuitSparks();
    expect(sparks.sync(game, 1000, 1)).toHaveLength(0);
    terminal.lit = true;
    const start = sparks.sync(game, 1016, 1);
    expect(start).toHaveLength(1);
    const mid = sparks.sync(game, 1016 + SPARK_MS / 2, 1);
    expect(mid[0].x).toBeGreaterThan(200);
    expect(mid[0].x).toBeLessThan(400);
    expect(sparks.sync(game, 1016 + SPARK_MS + 300, 1)).toHaveLength(0);
  });

  it("does not fire for terminals already lit when the map starts", () => {
    const game = {
      circuit: { terminals: [{ x: 1, y: 1, radius: 20, lit: true, ballId: "b" }] }, balls: [],
    } as unknown as CanvasGameState;
    expect(new CircuitSparks().sync(game, 0, 1)).toHaveLength(0);
  });
});

describe("every light mechanic has a dial", () => {
  it("defaults on, and is read by the renderer", () => {
    const src = read("src/lib/rendering/three/ThreeRenderer.ts");
    for (const k of ["cutPreview", "pocketGlow", "chargeTell", "phaseTell", "powerDrain", "circuitSpark"] as const) {
      expect(DEFAULT_LIGHT_LOOK[k], k).toBe(1);
      expect(src, k).toMatch(new RegExp(`look\\.${k}\\b`));
    }
  });
});
