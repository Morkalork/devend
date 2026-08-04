/**
 * "Deploy Charge" (charge.ts): a fuse armed by routing a fence over it that,
 * after a telegraphed delay, detonates its target obstacle slab (queued through
 * the shared destroy pipeline), flings nearby balls, and shreds the player's
 * own fences in the blast radius. This pins the arm rule, the delayed
 * detonation, and the blast's two side effects.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBossChargeSound: () => {}, playBossLandSound: () => {}, playFenceBreakSound: () => {},
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { tickChargeOnCut, tickCharges } from "@/lib/physics/charge";
import { rotateCharge } from "@/lib/mapRotation";
import { createRectPolygon } from "@/lib/polygon";
import { FENCE_FRACTURE_HITS } from "@/lib/wallGeometry";
import type { CanvasGameState, ChargeRuntime } from "@/types/gameState";
import type { GrowingWall, Vector2, Ball } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import type { DestructibleState } from "@/types/game";
import type { LevelData } from "@/types/level";

// A fence whose ONE grown half is the polyline `pts` (the other half is empty).
function fence(...pts: Vector2[]): GrowingWall {
  return { startWaypoints: pts, endWaypoints: [pts[pts.length - 1]] } as unknown as GrowingWall;
}

function makeCharge(over: Partial<ChargeRuntime> = {}): ChargeRuntime {
  return {
    fuse: { x: 200, y: 200 }, radius: 25, targetId: "slab",
    blastRadius: 220, delaySeconds: 1.2, armedAt: null, blown: false, ...over,
  };
}

// A breakable target slab (centred near the fuse) so findObstacleDestructibleById
// resolves it and the blast has a centre to fling balls away from.
function slabDestructible(): DestructibleState {
  return {
    id: "slab", kind: "breakable", destroyed: false, hits: 0, maxHits: 40, lastHitAt: 0,
    obstaclePolygon: createRectPolygon(180, 180, 260, 260),
  } as unknown as DestructibleState;
}

function playerFence(id: string, a: Vector2, b: Vector2): Wall {
  return { id, start: a, end: b, thickness: 6 } as unknown as Wall;
}

function makeBall(x: number, y: number): Ball {
  return { id: "b", position: { x, y }, velocity: { x: 10, y: 0 }, radius: 12, speed: 10, baseSpeed: 100, state: "active" } as unknown as Ball;
}

function makeGame(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    charges: [], balls: [], walls: [], destructibles: [],
    pendingDestroys: [], pendingWallBreaks: [], activePlaySeconds: 0,
    ...over,
  } as unknown as CanvasGameState;
}

describe("arming", () => {
  it("a fence routed within radius arms the fuse; a miss does not", () => {
    const c = makeCharge();
    const game = makeGame({ charges: [c], activePlaySeconds: 3 });
    // Miss: far from the fuse.
    tickChargeOnCut(game, fence({ x: 800, y: 0 }, { x: 800, y: 900 }), {});
    expect(c.armedAt).toBeNull();
    // Hit: a segment passes through the fuse point.
    tickChargeOnCut(game, fence({ x: 200, y: 0 }, { x: 200, y: 400 }), {});
    expect(c.armedAt).toBe(3);
  });

  it("does not re-arm an already-armed or spent fuse", () => {
    const armed = makeCharge({ armedAt: 1 });
    const blown = makeCharge({ blown: true });
    const game = makeGame({ charges: [armed, blown], activePlaySeconds: 9 });
    tickChargeOnCut(game, fence({ x: 200, y: 0 }, { x: 200, y: 400 }), {});
    expect(armed.armedAt).toBe(1);      // unchanged
    expect(blown.armedAt).toBeNull();   // spent, never arms
  });
});

describe("detonation", () => {
  it("does nothing until the telegraph delay elapses, then detonates", () => {
    const c = makeCharge({ armedAt: 0, delaySeconds: 1.2 });
    const game = makeGame({ charges: [c], destructibles: [slabDestructible()], activePlaySeconds: 1.0 });
    tickCharges(game, {});
    expect(c.blown).toBe(false);          // 1.0s < 1.2s delay
    game.activePlaySeconds = 1.3;
    tickCharges(game, {});
    expect(c.blown).toBe(true);           // delay elapsed
  });

  it("queues the target slab for destruction and fires the payoff callback", () => {
    const c = makeCharge({ armedAt: 0 });
    const slab = slabDestructible();
    const game = makeGame({ charges: [c], destructibles: [slab], activePlaySeconds: 2 });
    const onChargeBlown = vi.fn();
    tickCharges(game, { onChargeBlown });
    expect(game.pendingDestroys).toContain(slab);
    expect(onChargeBlown).toHaveBeenCalledOnce();
  });

  it("flings a ball caught inside the blast radius outward from the slab", () => {
    const c = makeCharge({ armedAt: 0, blastRadius: 220 });
    const ball = makeBall(300, 220);       // right of the slab centre (~220,220)
    const game = makeGame({ charges: [c], destructibles: [slabDestructible()], balls: [ball], activePlaySeconds: 2 });
    tickCharges(game, {});
    expect(ball.velocity.x).toBeGreaterThan(0); // pushed further right (away from centre)
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeGreaterThan(10); // boosted
  });

  it("shreds the player's own fences inside the blast, but leaves far ones", () => {
    const c = makeCharge({ armedAt: 0, blastRadius: 120 });
    const near = playerFence("fence-near", { x: 200, y: 250 }, { x: 260, y: 250 }); // near the slab
    const far = playerFence("fence-far", { x: 900, y: 900 }, { x: 950, y: 950 });
    const game = makeGame({ charges: [c], destructibles: [slabDestructible()], walls: [near, far], activePlaySeconds: 2 });
    tickCharges(game, {});
    expect(game.pendingWallBreaks).toContain(near);
    expect(game.pendingWallBreaks).not.toContain(far);
    expect(near.blackHits).toBe(FENCE_FRACTURE_HITS);
  });

  it("detonates harmlessly when its target was already destroyed (a ball beat the fuse)", () => {
    const c = makeCharge({ armedAt: 0 });
    const game = makeGame({ charges: [c], destructibles: [], activePlaySeconds: 2 });
    expect(() => tickCharges(game, {})).not.toThrow();
    expect(c.blown).toBe(true);
    expect(game.pendingDestroys).toHaveLength(0);
  });
});

describe("config + rotation", () => {
  it("the pilot map ships a well-formed charge referencing a breakable slab", () => {
    const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
    const withCharge = doc.levels.find(l => Array.isArray(l.charges) && l.charges.length > 0);
    expect(withCharge, "a map should author a charge").toBeDefined();
    const charge = withCharge!.charges![0];
    expect(charge.radius).toBeGreaterThan(0);
    expect(charge.targetId).toBeTruthy();
    // The target must be an authored breakable obstacle (it needs a destructible).
    const target = (withCharge!.entities ?? []).find(e => e.id === charge.targetId);
    expect(target, `target ${charge.targetId} must exist as an entity`).toBeDefined();
    expect((target as { breakable?: boolean }).breakable).toBe(true);
  });

  it("rotateCharge turns the fuse point into the orientation", () => {
    const base = { fuse: { x: 100, y: 0 }, radius: 20, targetId: "slab" };
    expect(rotateCharge(base, 0)).toBe(base); // no-op at 0
    const r = rotateCharge(base, 1);          // 90 left
    expect(r.fuse).not.toEqual(base.fuse);
    expect(r.targetId).toBe("slab");          // reference unchanged
  });
});
