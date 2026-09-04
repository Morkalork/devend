/**
 * The padded block: the first solid that keeps a record of what has hit it.
 *
 * Every failure mode here is invisible in motion, which is why it is worth a
 * file. A wall that taxes and never visibly moves looks like a wall. A wall
 * that dents and never taxes looks like a wall. A wall that dents past its cap
 * looks like a wall until, twenty seconds later on a different part of the
 * board, a ball is somewhere it should not be. So each half is measured
 * separately and against the constants rather than against pinned numbers.
 *
 * The one that took the most work to get right is DIRECTION. A dent has to push
 * the face IN, and "in" is the local edge normal, not the way to the middle. On
 * a square those agree and every test passes on the wrong implementation; on
 * the 24x300 bar that is actually on level 11 they do not agree at all, and a
 * centre-based dent would shorten the bar rather than dimple it. Hence the
 * elongated fixture below, which is the shape the mechanic ships on.
 */
import { describe, it, expect } from "vitest";
import {
  applyDent, deformReady, deformSlow, deformedOutline, deformWear, dentDepth,
  inwardMitres, subdivideOutline,
  DEFORM_COOLDOWN_MS, DEFORM_SLOW, DENT_RADIUS, DENT_RESOLUTION, MAX_DENT,
  MAX_DEFORM_VERTICES, WEAR_BUDGET, type DeformState,
} from "@/lib/physics/deformable";
import { ballImpactDamage } from "@/lib/physics/destructibles";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { createWallsFromPolygon } from "@/lib/wallGeometry";
import type { Ball } from "@/types/game";
import type { Vector2 } from "@/lib/polygon";

const ball = (vel: { x: number; y: number }, over: Partial<Ball> = {}): Ball => ({
  id: "ball", position: { x: 0, y: 0 }, velocity: { ...vel },
  speed: Math.hypot(vel.x, vel.y), baseSpeed: 250, radius: BASE_BALL_RADIUS,
  ...over,
} as unknown as Ball);

const rect = (x: number, y: number, w: number, h: number): Vector2[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

/** Build a state the way initGame does: resample, then walls, then mitres. */
const build = (outline: Vector2[], id = "pad"): DeformState => {
  const vertices = subdivideOutline(outline);
  const polygon = { vertices };
  const walls = createWallsFromPolygon(polygon, `obstacle-${id}`, false);
  return {
    id, original: vertices.map(v => ({ ...v })), polygon, walls,
    inward: inwardMitres(vertices)!, dents: [], totalDepth: 0,
  };
};

/** The shape the mechanic actually ships on: level 11's 24x300 spine. */
const spine = () => build(rect(560, 45, 24, 300), "spine");

const depthAt = (state: DeformState, i: number): number => {
  const o = state.original[i], p = state.polygon.vertices[i];
  return Math.hypot(p.x - o.x, p.y - o.y);
};

describe("the tax", () => {
  it("takes exactly 3% of the ball's speed and nothing else", () => {
    const b = ball({ x: 300, y: 0 });
    const hit = deformSlow(b);
    expect(hit.speed).toBeCloseTo(300 * DEFORM_SLOW, 6);
    // Direction untouched: a deformable is a wall you can aim off, not a
    // bumper. A redirect here would make every bank shot on the map a lottery.
    expect(Math.atan2(hit.velocity.y, hit.velocity.x)).toBeCloseTo(0, 9);
  });

  it("never taxes a ball below its own minimum speed", () => {
    // The universal floor at the end of updateBall would stop it crawling too,
    // but only honouring it here makes the returned speed true, and that is
    // what the caller writes onto the ball.
    const b = ball({ x: 100, y: 0 }, { minimumSpeed: 99 } as Partial<Ball>);
    expect(deformSlow(b).speed).toBe(99);
  });

  it("leaves a stopped ball alone rather than dividing by its speed", () => {
    const hit = deformSlow(ball({ x: 0, y: 0 }));
    expect(Number.isFinite(hit.velocity.x) && Number.isFinite(hit.velocity.y)).toBe(true);
    expect(hit.speed).toBe(0);
  });
});

describe("how deep a hit sinks", () => {
  it("is the same force model breakables use, not a second one", () => {
    // Two force models on one board eventually disagree about which hit was
    // harder, and the player is the one who has to reconcile them.
    const b = ball({ x: 250, y: 0 });
    expect(dentDepth(b, 250)).toBeCloseTo(ballImpactDamage(b, 250) * (MAX_DENT / 3), 9);
  });

  it("sinks deeper for a faster ball and for a heavier one", () => {
    const light = ball({ x: 250, y: 0 });
    const heavy = ball({ x: 250, y: 0 }, { density: 3, radius: BASE_BALL_RADIUS * 1.4 } as Partial<Ball>);
    expect(dentDepth(light, 400)).toBeGreaterThan(dentDepth(light, 150));
    expect(dentDepth(heavy, 250)).toBeGreaterThan(dentDepth(light, 250));
  });
});

describe("the dent is real geometry, in both collision systems", () => {
  it("moves the polygon AND the edge walls from one call", () => {
    const s = spine();
    const at = { x: 584, y: 195 };            // middle of the right-hand face
    const wallsBefore = s.walls.map(w => ({ ...w.start }));
    applyDent(s, at, 3);

    const moved = s.polygon.vertices.filter((v, i) =>
      Math.hypot(v.x - s.original[i].x, v.y - s.original[i].y) > 0.01);
    expect(moved.length, "the polygon did not move at all").toBeGreaterThan(0);

    const wallsMoved = s.walls.filter((w, i) =>
      Math.hypot(w.start.x - wallsBefore[i].x, w.start.y - wallsBefore[i].y) > 0.01);
    expect(wallsMoved.length, "the edge walls stayed on the old outline").toBeGreaterThan(0);

    // Every wall endpoint sits on the live polygon, not near it: two
    // descriptions of one surface that disagree is a wall that dents at its
    // face and is pristine at its rim.
    for (let i = 0; i < s.walls.length; i++) {
      expect(s.walls[i].start.x).toBeCloseTo(s.polygon.vertices[i].x, 9);
      expect(s.walls[i].start.y).toBeCloseTo(s.polygon.vertices[i].y, 9);
    }
  });

  it("drops the walls' cached AABBs, which are built assuming walls never move", () => {
    // updateBall caches a segment AABB on first use, saying in its own comment
    // that it may because walls never move once created - and uses it as a
    // REJECT. This is the one wall for which that is false, so the contract is
    // asserted directly: on today's convex slabs a stale box happens to still
    // cover the ball's side of a dented face, so no integration test can catch
    // this, and it stops being true the first time somebody bows a pad.
    const s = spine();
    for (const w of s.walls) {
      w.aabbMinX = w.start.x; w.aabbMaxX = w.end.x;
      w.aabbMinY = w.start.y; w.aabbMaxY = w.end.y;
    }
    applyDent(s, { x: 584, y: 195 }, 3);
    expect(s.walls.every(w => w.aabbMinX === undefined), "a stale AABB survived").toBe(true);
  });
});

describe("which way is IN", () => {
  it("pushes an elongated bar's face inward, not along its length", () => {
    // The failure a square fixture cannot see. Level 11's spine is 24 wide and
    // 300 long, so the direction of its middle from a mid-face vertex is almost
    // entirely ALONG the bar: a centre-based dent shortens it instead of
    // denting it, and the player watches a wall they hit head-on shrink.
    const s = spine();
    applyDent(s, { x: 584, y: 195 }, MAX_DENT);
    let worst = -1, worstIdx = -1;
    for (let i = 0; i < s.original.length; i++) {
      const d = depthAt(s, i);
      if (d > worst) { worst = d; worstIdx = i; }
    }
    const o = s.original[worstIdx], p = s.polygon.vertices[worstIdx];
    // It came off the right-hand face and moved LEFT (into the bar), by
    // essentially all of its displacement.
    expect(o.x).toBeCloseTo(584, 6);
    expect(o.x - p.x).toBeGreaterThan(worst * 0.9);
    expect(Math.abs(p.y - o.y)).toBeLessThan(worst * 0.2);
  });

  it("refuses a degenerate outline instead of inventing a direction", () => {
    expect(inwardMitres([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(inwardMitres(rect(0, 0, 0, 0))).toBeNull();
  });
});

describe("the cap, which is what keeps the board honest", () => {
  it("never sinks a vertex past MAX_DENT however many times it is hit", () => {
    const s = spine();
    const at = { x: 584, y: 195 };
    for (let i = 0; i < 200; i++) applyDent(s, at, 2);
    for (let i = 0; i < s.original.length; i++) {
      expect(depthAt(s, i), `vertex ${i} sank past the cap`).toBeLessThanOrEqual(MAX_DENT + 1e-6);
    }
  });

  it("recomputes from the authored shape rather than nudging what is there", () => {
    // The difference between a dent and a drift. Nudging applies the cap to
    // each STEP rather than to the total, so a wall hit repeatedly in one spot
    // keeps sinking; it also accumulates float error along the way.
    const a = spine(), b = spine();
    applyDent(a, { x: 584, y: 195 }, 2);
    applyDent(a, { x: 584, y: 195 }, 3);
    // One dent of the same total depth as the two, at the same place, lands in
    // the same place, because both are measured from `original`.
    applyDent(b, { x: 584, y: 195 }, 5);
    for (let i = 0; i < a.polygon.vertices.length; i++) {
      expect(a.polygon.vertices[i].x).toBeCloseTo(b.polygon.vertices[i].x, 9);
      expect(a.polygon.vertices[i].y).toBeCloseTo(b.polygon.vertices[i].y, 9);
    }
  });

  it("is local: a hit at one end leaves the far end untouched", () => {
    const s = spine();
    applyDent(s, { x: 584, y: 60 }, MAX_DENT);
    const far = s.original
      .map((v, i) => ({ i, d: Math.hypot(v.x - 584, v.y - 60) }))
      .filter(v => v.d > DENT_RADIUS);
    expect(far.length, "the fixture is too small to have a far end").toBeGreaterThan(0);
    for (const { i } of far) expect(depthAt(s, i), `vertex ${i} moved`).toBeCloseTo(0, 9);
  });
});

describe("resampling, without which the mechanic does not exist on a slab", () => {
  it("gives a long bar somewhere to give in the middle", () => {
    // A rectangle has four corners. A ball striking the middle of a 300-unit
    // bar is DENT_RADIUS-and-then-some from every one of them, so unresampled
    // it would pay its 3% and leave no mark at all.
    const raw = { vertices: rect(560, 45, 24, 300) };
    const bare: DeformState = {
      id: "bare", original: raw.vertices.map(v => ({ ...v })), polygon: raw,
      walls: [], inward: inwardMitres(raw.vertices)!, dents: [], totalDepth: 0,
    };
    applyDent(bare, { x: 584, y: 195 }, MAX_DENT);
    expect(bare.polygon.vertices.every((v, i) =>
      Math.hypot(v.x - bare.original[i].x, v.y - bare.original[i].y) < 1e-9),
      "the unresampled fixture dented, so this test proves nothing").toBe(true);

    const s = spine();
    applyDent(s, { x: 584, y: 195 }, MAX_DENT);
    const moved = s.polygon.vertices.filter((v, i) => depthAt(s, i) > 0.01);
    expect(moved.length, "the resampled bar still could not give").toBeGreaterThan(2);
  });

  it("keeps every authored corner and adds only interior points", () => {
    const corners = rect(560, 45, 24, 300);
    const out = subdivideOutline(corners);
    for (const c of corners) {
      expect(out.some(v => Math.abs(v.x - c.x) < 1e-9 && Math.abs(v.y - c.y) < 1e-9),
        `corner ${c.x},${c.y} was lost`).toBe(true);
    }
    // Same enclosed area: resampling changes the resolution, never the shape.
    const area = (vs: Vector2[]) => Math.abs(vs.reduce((a, p, i) => {
      const q = vs[(i + 1) % vs.length];
      return a + p.x * q.y - q.x * p.y;
    }, 0) / 2);
    expect(area(out)).toBeCloseTo(area(corners), 6);
  });

  it("cuts finely enough that one impact moves several vertices", () => {
    const out = subdivideOutline(rect(560, 45, 24, 300));
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(DENT_RESOLUTION + 1e-6);
    }
    expect(DENT_RESOLUTION, "a dent would move one lone tooth").toBeLessThan(DENT_RADIUS / 2);
  });

  it("stretches the spacing rather than turning a huge pad into hundreds of walls", () => {
    // Every vertex is also a collision wall in the broad-phase index.
    const huge = subdivideOutline(rect(0, 0, 800, 800));
    expect(huge.length).toBeLessThanOrEqual(MAX_DEFORM_VERTICES + 4);
  });
});

describe("the cooldown, so one contact is one dent", () => {
  it("lets a different ball through immediately", () => {
    const s = spine();
    expect(deformReady(ball({ x: 1, y: 0 }), s, 1000)).toBe(true);
  });

  it("holds off the same ball for the full window", () => {
    const s = spine();
    const b = ball({ x: 1, y: 0 }, { lastDeformId: "spine", lastDeformAt: 1000 } as Partial<Ball>);
    expect(deformReady(b, s, 1000 + DEFORM_COOLDOWN_MS - 1)).toBe(false);
    expect(deformReady(b, s, 1000 + DEFORM_COOLDOWN_MS)).toBe(true);
  });

  it("is short enough that a genuine second approach is never swallowed", () => {
    // A ball at the tunnelling ceiling crosses its own diameter in ~7ms; this
    // has to be longer than one physics step and far shorter than a rebound.
    expect(DEFORM_COOLDOWN_MS).toBeGreaterThan(1000 / 120);
    expect(DEFORM_COOLDOWN_MS).toBeLessThan(250);
  });
});

describe("wear, which is a look and not a countdown", () => {
  it("starts at nothing and saturates rather than ending", () => {
    const s = spine();
    expect(deformWear(s)).toBe(0);
    s.totalDepth = WEAR_BUDGET * 10;
    expect(deformWear(s)).toBe(1);
  });

  it("does not depend on how finely the outline happened to be resampled", () => {
    // Dents are counted per IMPACT. Scaling the budget by the vertex count
    // would mean a long bar (forty vertices) looked new after the same traffic
    // that visibly wore a small pad, for no reason a player could ever see.
    const small = build(rect(0, 0, 60, 60), "small");
    const long = spine();
    small.totalDepth = 12; long.totalDepth = 12;
    expect(long.original.length).toBeGreaterThan(small.original.length);
    expect(deformWear(long)).toBeCloseTo(deformWear(small), 9);
  });
});

describe("deformedOutline is pure", () => {
  it("does not touch the state it is asked about", () => {
    const s = spine();
    s.dents.push({ at: { x: 584, y: 195 }, depth: 4 });
    const before = s.polygon.vertices.map(v => ({ ...v }));
    deformedOutline(s);
    for (let i = 0; i < before.length; i++) {
      expect(s.polygon.vertices[i].x).toBe(before[i].x);
      expect(s.polygon.vertices[i].y).toBe(before[i].y);
    }
  });
});
