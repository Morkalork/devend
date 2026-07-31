/**
 * Phasing objects (issue #64): the 10s solid<->intangible cycle, the one-shot
 * phase-out shockwave that frees nearby balls, and the phased-out collision set.
 */
import { describe, it, expect } from "vitest";
import { tickPhasing, collectPhasedOut, PHASE_SHOCKWAVE_RADIUS } from "@/lib/physics/phasing";
import { Ball, PhasingObjectState } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { Polygon } from "@/lib/polygon";

function box(cx: number, cy: number, r = 40): Polygon {
  return { vertices: [
    { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r },
    { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r },
  ] };
}

function phasingObj(over: Partial<PhasingObjectState> = {}): PhasingObjectState {
  return {
    id: "p1", polygon: box(400, 400), wallIds: ["obstacle-p1-edge-0", "obstacle-p1-edge-1"],
    startedAt: 0, cycleSeconds: 10, phase: "in", alpha: 1, ...over,
  };
}

function ball(id: string, x: number, y: number): Ball {
  return {
    id, position: { x, y }, velocity: { x: 50, y: 0 }, radius: 18, speed: 50,
    baseSpeed: 200, topSpeed: 200, state: "active",
  } as unknown as Ball;
}

function game(objs: PhasingObjectState[], balls: Ball[] = []): CanvasGameState {
  return { phasingObjects: objs, balls } as unknown as CanvasGameState;
}

describe("phasing cycle", () => {
  it("is solid early in the cycle and intangible late", () => {
    const obj = phasingObj();
    const g = game([obj]);
    tickPhasing(g, 0);        // start of cycle
    expect(obj.phase).toBe("in");
    expect(obj.alpha).toBe(1);
    tickPhasing(g, 8.5);      // deep into the out window (cycle 10s, out ~0.7..0.92)
    expect(obj.phase).toBe("out");
    expect(obj.alpha).toBeLessThan(0.5);
    tickPhasing(g, 10);       // back to the next cycle start
    expect(obj.phase).toBe("in");
    expect(obj.alpha).toBeGreaterThan(0.5);
  });
});

describe("phase-out shockwave", () => {
  it("flings a nearby ball outward exactly once per cycle", () => {
    const obj = phasingObj();
    const near = ball("near", 420, 400);   // ~20px from centre (inside radius)
    const far = ball("far", 400 + PHASE_SHOCKWAVE_RADIUS + 50, 400);
    const g = game([obj], [near, far]);
    tickPhasing(g, 0);                       // in
    const farV = { ...far.velocity };
    tickPhasing(g, 8.5);                      // crosses into out -> shockwave
    expect(obj.firedOutAt).toBeDefined();
    // Near ball is boosted outward (to the right of centre => +x), far ball untouched.
    expect(near.velocity.x).toBeGreaterThan(50);
    expect(far.velocity).toEqual(farV);
    // Ticking again while still out does not re-fire (velocity magnitude stable).
    const nearSpeed = Math.hypot(near.velocity.x, near.velocity.y);
    tickPhasing(g, 8.7);
    expect(Math.hypot(near.velocity.x, near.velocity.y)).toBeCloseTo(nearSpeed, 5);
  });
});

describe("collectPhasedOut", () => {
  it("returns null when nothing is phased out, else the out polygons + walls", () => {
    expect(collectPhasedOut(game([phasingObj({ phase: "in", alpha: 1 })]))).toBeNull();
    const out = phasingObj({ phase: "out", alpha: 0 });
    const res = collectPhasedOut(game([out]));
    expect(res).not.toBeNull();
    expect(res!.polys.has(out.polygon)).toBe(true);
    expect(res!.walls.has("obstacle-p1-edge-0")).toBe(true);
  });

  it("is a no-op (null) on a map with no phasing objects", () => {
    expect(collectPhasedOut(game([]))).toBeNull();
  });
});
