/**
 * The rotor: the first object in the game that turns.
 *
 * Every moving object until now shuttles along one axis, and moverState's own
 * note said so as a licence to optimise: "a mover only ever translates, never
 * rotates, so the bent shape is computed once at build and the step just adds
 * the offset to it". A rotor breaks that sentence, so it carries its own
 * pre-built outline and the step rotates it in place - the same one pass over
 * existing vertex objects, two multiplies instead of one add, and no
 * allocation at 120Hz per rotor.
 *
 * What makes it a different threat rather than a faster patrol is the arc. A
 * shuttle crosses the pocket you are sealing on a fixed line; a rotor sweeps
 * THROUGH it at an angle that keeps changing, and its tip travels much faster
 * than its hub - so which part of it you cut across is a decision, and that is
 * the thing being pinned below.
 */
import { describe, it, expect } from "vitest";
import { buildMoverPolygon, buildRotorOutline, updateMoverPolygon, type MoverState } from "@/lib/physics/moverState";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import type { CanvasGameState } from "@/types/gameState";

/** A bar 200 long and 24 thick, pivoting about its own middle at (450,450). */
const rotor = (over: Partial<MoverState> = {}): MoverState => {
  const m: MoverState = {
    id: "r1", shape: "rect", homeX: 450, homeY: 450, width: 200, height: 24,
    axis: "horizontal", range: 0, speed: 90, offset: 0, direction: 1,
    motion: "rotate", angle: 0, polygon: { vertices: [] },
    ...over,
  } as MoverState;
  m.rotorOutline ??= buildRotorOutline(m);
  m.polygon = buildMoverPolygon(m);
  return m;
};

const scene = (movers: MoverState[]): CanvasGameState => ({
  movers, walls: [], mapMutator: null, lockedBallsCount: 0,
} as unknown as CanvasGameState);

const extent = (m: MoverState) => {
  const xs = m.polygon.vertices.map(v => v.x), ys = m.polygon.vertices.map(v => v.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

describe("a rotor turns rather than slides", () => {
  it("starts as the bar it was authored as", () => {
    const m = rotor();
    const e = extent(m);
    expect(e.w).toBeCloseTo(200, 6);
    expect(e.h).toBeCloseTo(24, 6);
  });

  it("is a different shape a quarter turn later, which a shuttle never is", () => {
    // THE distinguishing property. A shuttle's outline is identical at every
    // point of its travel; a rotor's is not, which is why it can close a gap
    // that was open a second ago without going anywhere.
    const m = rotor({ angle: Math.PI / 2 });
    m.polygon = buildMoverPolygon(m);
    const e = extent(m);
    expect(e.w).toBeCloseTo(24, 6);
    expect(e.h).toBeCloseTo(200, 6);
  });

  it("keeps its pivot fixed while it turns", () => {
    const centreOf = (mm: MoverState) => {
      const xs = mm.polygon.vertices.map(v => v.x), ys = mm.polygon.vertices.map(v => v.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    };
    for (const a of [0, 0.3, 1.1, 2.5, 4.9]) {
      const m = rotor({ angle: a });
      m.polygon = buildMoverPolygon(m);
      const c = centreOf(m);
      expect(c.x, `angle ${a}`).toBeCloseTo(450, 6);
      expect(c.y, `angle ${a}`).toBeCloseTo(450, 6);
    }
  });

  it("swings a much larger circle when the pivot is off the bar", () => {
    // A windmill and an arm are the same object with the pivot moved, which is
    // the whole reason the outline is taken relative to the pivot.
    const armAt = (angle: number) => {
      const arm = rotor({ rotorOutline: buildRotorOutline(rotor()).map(p => ({ x: p.x + 200, y: p.y })) });
      arm.angle = angle;
      arm.polygon = buildMoverPolygon(arm);
      const xs = arm.polygon.vertices.map(v => v.x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    };
    // Hung 200 to the right of the pivot, the bar's middle starts right of it
    // and is left of it half a turn later - it orbits rather than spinning in
    // place, which is the whole difference between an arm and a windmill.
    expect(armAt(0)).toBeCloseTo(650, 6);
    expect(armAt(Math.PI)).toBeCloseTo(250, 6);
  });

  it("updates in place without reallocating its vertices", () => {
    // The optimisation moverState exists to protect: 120Hz per rotor.
    const m = rotor();
    const before = m.polygon.vertices;
    const first = before[0];
    m.angle = 1.2;
    updateMoverPolygon(m);
    expect(m.polygon.vertices).toBe(before);
    expect(m.polygon.vertices[0]).toBe(first);
  });

  it("agrees exactly with the builder at every angle", () => {
    // The per-step path and the build path are two implementations of one fact,
    // and the step one is the hot path nothing else here exercises. Left
    // unchecked, a rotor that renders correctly on the frame it is built and
    // slides instead of turning on every frame after would pass everything
    // above - which is precisely what happened before this test existed.
    for (const angle of [0, 0.4, 1.57, 2.9, 4.2, 6.1]) {
      const stepped = rotor({ angle });
      updateMoverPolygon(stepped);
      const built = buildMoverPolygon(rotor({ angle }));
      for (let i = 0; i < built.vertices.length; i++) {
        expect(stepped.polygon.vertices[i].x, `angle ${angle} vertex ${i} x`)
          .toBeCloseTo(built.vertices[i].x, 9);
        expect(stepped.polygon.vertices[i].y, `angle ${angle} vertex ${i} y`)
          .toBeCloseTo(built.vertices[i].y, 9);
      }
    }
  });

  it("actually moves its vertices when the angle changes", () => {
    // Belt and braces on the same hot path: identical vertices at two different
    // angles is a rotor that is not turning at all.
    const m = rotor({ angle: 0 });
    const at0 = m.polygon.vertices.map(v => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(" ");
    m.angle = 0.9;
    updateMoverPolygon(m);
    const at09 = m.polygon.vertices.map(v => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(" ");
    expect(at09, "the step path does not rotate").not.toEqual(at0);
  });
});

describe("how it is driven", () => {
  const STEP = 1 / 60;

  it("advances by its speed in DEGREES per second", () => {
    const m = rotor({ speed: 90, angle: 0 });
    const game = scene([m]);
    updateMoversFn(STEP, game);
    expect((m.angle ?? 0) * 180 / Math.PI).toBeCloseTo(90 * STEP, 6);
  });

  it("spins all the way round when no sweep is set", () => {
    const m = rotor({ speed: 360, angle: 0 });
    const game = scene([m]);
    for (let i = 0; i < 240; i++) updateMoversFn(STEP, game);
    // Four full turns later it is still turning the same way, not reversing.
    expect(m.direction).toBe(1);
  });

  it("keeps a full-circle angle bounded, however long the map runs", () => {
    // Left to grow, the angle loses precision over a long map and the rotor
    // starts to stutter - a bug that only appears after several minutes.
    const m = rotor({ speed: 720, angle: 0 });
    const game = scene([m]);
    for (let i = 0; i < 3000; i++) updateMoversFn(STEP, game);
    expect(Math.abs(m.angle ?? 0)).toBeLessThanOrEqual(Math.PI * 2 + 1e-9);
  });

  it("reverses at both ends of a limited sweep, like a wiper", () => {
    const m = rotor({ speed: 180, angle: 0, halfSweep: Math.PI / 4 });
    const game = scene([m]);
    let sawForward = false, sawBack = false;
    for (let i = 0; i < 200; i++) {
      updateMoversFn(STEP, game);
      expect(Math.abs(m.angle ?? 0)).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
      if (m.direction === 1) sawForward = true; else sawBack = true;
    }
    expect(sawForward && sawBack, "a limited sweep never turned back").toBe(true);
  });

  it("leaves ordinary shuttles alone", () => {
    // The regression that matters: eleven shipped maps time their necks against
    // linear patrols, and none of them may have changed.
    const shuttle: MoverState = {
      id: "s1", shape: "rect", homeX: 300, homeY: 300, width: 90, height: 26,
      axis: "horizontal", range: 200, speed: 60, offset: 0, direction: 1,
      polygon: { vertices: [] },
    } as MoverState;
    shuttle.polygon = buildMoverPolygon(shuttle);
    const game = scene([shuttle]);
    updateMoversFn(STEP, game);
    expect(shuttle.offset).toBeGreaterThan(0);
    expect(shuttle.angle).toBeUndefined();
  });
});
