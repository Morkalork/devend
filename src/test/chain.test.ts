/**
 * Chain physics (issue #64): the verlet rope that tethers two balls, snags on
 * obstacles (slowing them), sweeps + fractures fences (boss chains only), and is
 * pinned when both anchors are frozen.
 */
import { describe, it, expect } from "vitest";
import { makeChain, tickChains } from "@/lib/physics/chain";
import { Ball, ChainState } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { Polygon } from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";

function ball(id: string, x: number, y: number): Ball {
  return {
    id, position: { x, y }, velocity: { x: 100, y: 0 }, radius: 18, speed: 100,
    baseSpeed: 100, topSpeed: 100, state: "active",
  } as unknown as Ball;
}

function game(over: Partial<CanvasGameState>): CanvasGameState {
  return {
    balls: [], obstaclePolygons: [], phasingObjects: [], walls: [],
    chains: [], pendingWallBreaks: [],
    ...over,
  } as unknown as CanvasGameState;
}

function dist(a: Ball, b: Ball) {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
}

describe("makeChain", () => {
  it("seeds nodes from anchor A to anchor B with a bounded rest length", () => {
    const a = ball("a", 0, 0), b = ball("b", 120, 0);
    const ch = makeChain(a, b, false);
    expect(ch.nodes.length).toBeGreaterThanOrEqual(3);
    expect(ch.nodes[0]).toEqual({ x: 0, y: 0 });
    expect(ch.nodes[ch.nodes.length - 1]).toEqual({ x: 120, y: 0 });
    expect(ch.restLength).toBeGreaterThanOrEqual(120); // slack past the initial gap
    expect(ch.breaksFences).toBe(false);
  });
});

describe("tickChains tether", () => {
  it("never lets the two balls drift past the chain's max stretch", () => {
    const a = ball("a", 0, 0), b = ball("b", 100, 0);
    const ch = makeChain(a, b, false); // restLength ~125
    // Yank B well past the rest length.
    b.position = { x: 600, y: 0 };
    const g = game({ balls: [a, b], chains: [ch] });
    tickChains(g, 1 / 120, 0);
    // The elastic tether allows some stretch but a hard clamp caps it (1.5x rest).
    expect(dist(a, b)).toBeLessThanOrEqual(ch.restLength * 1.5 + 1);
  });

  it("elastically reels an over-stretched pair back toward the rest length", () => {
    const a = ball("a", 0, 0), b = ball("b", 100, 0);
    const ch = makeChain(a, b, false);
    b.position = { x: 600, y: 0 };
    const g = game({ balls: [a, b], chains: [ch] });
    for (let i = 0; i < 60; i++) tickChains(g, 1 / 120, i * 10);
    // The spring settles the gap back down to (near) the rest length over time.
    expect(dist(a, b)).toBeLessThanOrEqual(ch.restLength + 1);
  });

  it("redirects a pair pulling apart into a swing instead of braking them static", () => {
    const a = ball("a", 0, 0), b = ball("b", 100, 0);
    const ch = makeChain(a, b, false); // restLength ~125
    // Taut, both balls driving straight apart along the chain axis.
    a.velocity = { x: -100, y: 0 }; a.speed = 100;
    b.position = { x: 200, y: 0 }; b.velocity = { x: 100, y: 0 }; b.speed = 100;
    const g = game({ balls: [a, b], chains: [ch] });
    tickChains(g, 1 / 120, 0);
    // Neither ball is braked toward zero: each keeps (essentially) its full speed,
    // just turned tangential to the chain.
    expect(Math.hypot(a.velocity.x, a.velocity.y)).toBeCloseTo(100, 5);
    expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeCloseTo(100, 5);
  });

  it("does not let the chain pump a pair's speed above their natural top", () => {
    // Two balls closing head-on repeatedly (the elastic swap + speed floor pump).
    const a = ball("a", 0, 0), b = ball("b", 60, 0);
    a.velocity = { x: 400, y: 0 }; a.speed = 400; // already over their 100 top
    b.velocity = { x: -400, y: 0 }; b.speed = 400;
    const ch = makeChain(a, b, false);
    const g = game({ balls: [a, b], chains: [ch] });
    tickChains(g, 1 / 120, 0);
    // capSpeed trims each ball back toward its topSpeed (100), with small headroom.
    expect(Math.hypot(a.velocity.x, a.velocity.y)).toBeLessThanOrEqual(100 * 1.05 + 1e-6);
    expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeLessThanOrEqual(100 * 1.05 + 1e-6);
  });

  it("drops the chain once a ball is locked away", () => {
    const a = ball("a", 0, 0), b = ball("b", 100, 0);
    const ch = makeChain(a, b, false);
    (b as unknown as { state: string }).state = "won";
    const g = game({ balls: [a, b], chains: [ch] });
    tickChains(g, 1 / 120, 0);
    expect(g.chains.length).toBe(0);
  });
});

describe("tickChains obstacle drape", () => {
  it("pushes rope nodes out of a solid obstacle it would cross", () => {
    // Anchors on either side of a box centred on the line between them.
    const a = ball("a", 0, 0), b = ball("b", 300, 0);
    const box: Polygon = { vertices: [
      { x: 120, y: -60 }, { x: 180, y: -60 }, { x: 180, y: 60 }, { x: 120, y: 60 },
    ] };
    const ch = makeChain(a, b, false);
    const g = game({ balls: [a, b], chains: [ch], obstaclePolygons: [box] });
    for (let i = 0; i < 8; i++) tickChains(g, 1 / 120, i * 300);
    // No interior node may sit inside the solid box.
    const inside = ch.nodes.some(n => n.x > 120 && n.x < 180 && n.y > -60 && n.y < 60);
    expect(inside).toBe(false);
  });
});

describe("tickChains fence sweep (boss chains only)", () => {
  function fence(id: string): Wall {
    return { id, start: { x: 150, y: -100 }, end: { x: 150, y: 100 }, thickness: 6 } as Wall;
  }
  it("a boss chain fractures a fence it sweeps, in three debounced hits", () => {
    const a = ball("a", 0, 0), b = ball("b", 300, 0);
    const ch = makeChain(a, b, true); // breaksFences
    const wall = fence("wall-1");
    const g = game({ balls: [a, b], chains: [ch], walls: [wall] });
    // Three hits, each past the 250ms debounce.
    tickChains(g, 1 / 120, 0);
    tickChains(g, 1 / 120, 300);
    tickChains(g, 1 / 120, 600);
    expect(wall.blackHits).toBe(3);
    expect(g.pendingWallBreaks).toContain(wall);
  });
  it("an ordinary (non-boss) chain never touches fences", () => {
    const a = ball("a", 0, 0), b = ball("b", 300, 0);
    const ch = makeChain(a, b, false);
    const wall = fence("wall-1");
    const g = game({ balls: [a, b], chains: [ch], walls: [wall] });
    tickChains(g, 1 / 120, 0);
    tickChains(g, 1 / 120, 300);
    tickChains(g, 1 / 120, 600);
    expect(wall.blackHits).toBeUndefined();
    expect(g.pendingWallBreaks.length).toBe(0);
  });
});

describe("tickChains freeze pins the rope", () => {
  it("does not apply snag friction while both anchors are frozen", () => {
    const box: Polygon = { vertices: [
      { x: 120, y: -60 }, { x: 180, y: -60 }, { x: 180, y: 60 }, { x: 120, y: 60 },
    ] };
    const mk = () => {
      const a = ball("a", 0, 0), b = ball("b", 300, 0);
      const ch: ChainState = makeChain(a, b, false);
      return { a, b, g: game({ balls: [a, b], chains: [ch], obstaclePolygons: [box] }) };
    };
    // Unfrozen: snagging on the box damps the balls' speed.
    const free = mk();
    for (let i = 0; i < 6; i++) tickChains(free.g, 1 / 120, i * 300);
    const freeSpeed = Math.hypot(free.a.velocity.x, free.a.velocity.y);

    // Frozen: same snag, but velocity is untouched.
    const frozen = mk();
    frozen.a.frozenUntil = 1e9; frozen.b.frozenUntil = 1e9;
    for (let i = 0; i < 6; i++) tickChains(frozen.g, 1 / 120, i * 300);
    const frozenSpeed = Math.hypot(frozen.a.velocity.x, frozen.a.velocity.y);

    expect(frozenSpeed).toBeCloseTo(100, 5);
    expect(freeSpeed).toBeLessThan(frozenSpeed);
  });
});
