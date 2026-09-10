/**
 * Live outer walls, and the map that needed them.
 *
 * Asked for as "gravity on the whole board, and bouncy outer walls so the balls
 * bounce back up". The premise and the physics diverge in one place and the
 * whole design follows from it: gravity here is a STEERING force, so a ball's
 * speed is never touched and it can never come to rest. Nothing is lost on a
 * bounce, so "bouncier" cannot mean "gives more back" - it can only mean
 * "faster". The axis that carries the idea is DIRECTION.
 *
 * What is pinned here is the behaviour, the clamp that stops a floor struck
 * every two seconds pinning every ball at the ceiling, and the two things about
 * level 14 that make the design hold at all: it must not rotate, and its floor
 * must not fire a pure bearing.
 */
import { describe, it, expect } from "vitest";
import {
  applyBoardEdge, sideOfEdge, BOARD_SIDES, type BoardEdgeSpec,
} from "@/lib/physics/boardEdges";
import { BOUNCER_MAX_SPEED_SCALE } from "@/lib/physics/bouncer";
import { pickMapRotation } from "@/lib/mapRotation";
import { mutatorById } from "@/lib/mapMutators";
import type { Ball } from "@/types/game";
import { LADDER } from "./fixtures/maps";

const BOUNDS = { minX: 45, minY: 45, maxX: 855, maxY: 855 };

/** A ball moving at `v`, with a base speed to measure the clamp against. */
const ball = (vx: number, vy: number, baseSpeed = 250): Ball =>
  ({ velocity: { x: vx, y: vy }, baseSpeed } as unknown as Ball);

const speed = (b: Ball) => Math.hypot(b.velocity.x, b.velocity.y);

describe("which side was struck", () => {
  it("names each of the four", () => {
    const edges: Record<string, { start: { x: number; y: number }; end: { x: number; y: number } }> = {
      top: { start: { x: 45, y: 45 }, end: { x: 855, y: 45 } },
      bottom: { start: { x: 45, y: 855 }, end: { x: 855, y: 855 } },
      left: { start: { x: 45, y: 45 }, end: { x: 45, y: 855 } },
      right: { start: { x: 855, y: 45 }, end: { x: 855, y: 855 } },
    };
    for (const side of BOARD_SIDES) {
      expect(sideOfEdge(edges[side], BOUNDS), side).toBe(side);
    }
  });

  it("tolerates the float the polygon actually carries", () => {
    // The edge comes back off the board polygon's own vertices. An equality
    // check would classify nothing and the whole feature would go quiet.
    expect(sideOfEdge(
      { start: { x: 45.0001, y: 854.9997 }, end: { x: 854.9998, y: 855.0002 } }, BOUNDS,
    )).toBe("bottom");
  });

  it("says nothing rather than guessing at an edge it does not know", () => {
    // A diagonal, and an interior wall. Returning a side for either would apply
    // the floor's kick to something that is not the floor.
    expect(sideOfEdge({ start: { x: 45, y: 45 }, end: { x: 855, y: 855 } }, BOUNDS)).toBeNull();
    expect(sideOfEdge({ start: { x: 400, y: 45 }, end: { x: 400, y: 855 } }, BOUNDS)).toBeNull();
  });
});

describe("what an edge does to a ball", () => {
  it("leaves the reflection alone when the map authors nothing", () => {
    const b = ball(100, -200);
    applyBoardEdge(b, undefined);
    expect(b.velocity).toEqual({ x: 100, y: -200 });
  });

  it("fires along a bearing at the speed the ball already had", () => {
    // The kicker's trick: a bouncer scatters, a bearing aims, and a wall that
    // aims is a wall a player can learn.
    const b = ball(-180, 60);
    const before = speed(b);
    applyBoardEdge(b, { bearing: "right" });
    expect(b.velocity.y).toBeCloseTo(0, 6);
    expect(b.velocity.x).toBeGreaterThan(0);
    expect(speed(b)).toBeCloseTo(before, 6);
  });

  it("keeps the sideways component when it only kicks", () => {
    // The reason the FLOOR takes a kick rather than a bearing: a ball has to
    // leave still travelling across the board, or it orbits in one column and
    // the rest of the board is captured out from under it.
    const b = ball(120, -160);
    applyBoardEdge(b, { kick: 1.5 });
    expect(b.velocity.x / b.velocity.y).toBeCloseTo(120 / -160, 6);
    expect(speed(b)).toBeCloseTo(200 * 1.5, 4);
  });

  it("will not let a floor struck every two seconds run away", () => {
    // The clamp that makes an outer wall different from a bumper. Kicked over
    // and over, the ball settles at the ceiling instead of climbing forever.
    const b = ball(0, -250, 250);
    for (let i = 0; i < 40; i++) applyBoardEdge(b, { kick: 1.25 });
    expect(speed(b)).toBeLessThanOrEqual(250 * BOUNCER_MAX_SPEED_SCALE + 1e-6);
    expect(speed(b), "the clamp swallowed the kick entirely").toBeGreaterThan(250);
  });

  it("still lets a damping edge take speed off past the ceiling", () => {
    // The clamp is on gain only. A ball already over the cap (a launcher shot)
    // must still be slowed by a soft edge, or the ceiling becomes a floor.
    const b = ball(0, 900, 250);
    applyBoardEdge(b, { kick: 0.85 });
    expect(speed(b)).toBeCloseTo(900 * 0.85, 4);
  });

  it("leaves a held ball held", () => {
    // Zero velocity is a ball a Breakpoint fence is holding. Giving it a
    // direction would take the hold away, from a wall it is resting against.
    const b = ball(0, 0);
    applyBoardEdge(b, { bearing: "up", kick: 2 });
    expect(b.velocity).toEqual({ x: 0, y: 0 });
  });
});

describe("level 14 holds together", () => {
  const l14 = LADDER.find(l => l.level === 14)!;

  it("authors edges at all, and the same one on every side", () => {
    expect(l14.boardEdges, "level 14 lost its live walls").toBeTruthy();
    const edges = l14.boardEdges!;
    expect(Object.keys(edges).sort()).toEqual(["bottom", "left", "right", "top"]);
    // Identical, not merely present. A falling board needs a bouncer per side
    // because gravity trades height for speed and back and the walls put back
    // the little each bounce loses; and it has to READ symmetrical, because a
    // player who sees chevrons on three sides and a bare floor on the fourth
    // has been told the floor is different when it is not. It shipped that way
    // once and was reported as "the bottom doesn't have bouncers".
    const kicks = (["top", "bottom", "left", "right"] as const).map(k => edges[k]?.kick);
    expect(new Set(kicks).size, `sides disagree: ${kicks.join(", ")}`).toBe(1);
    expect(kicks[0]).toBeGreaterThan(1);
  });

  it("never rotates, because gravity does not", () => {
    // Gravity pulls screen-down and does not turn with the board, so a map
    // dealt sideways has its floor on a wall. Three deals in four.
    expect(l14.neverRotates, "level 14 may be dealt sideways").toBe(true);
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      expect(pickMapRotation(`${l14.id}:${seed}`, 14, l14.neverRotates)).toBe(0);
    }
  });

  it("keeps the kick gentle, because the fall is what puts speed in now", () => {
    // The floor carried 1.15 while the pull only STEERED: the pull added no
    // speed, so the walls had to. Under a pull that accelerates, the fall
    // supplies it and a heavy kick is a pump - each landing adds what the fall
    // added and nothing takes any out, so balls sit at terminal moving at a
    // constant speed again, which is the thing this map was changed to stop.
    expect(l14.boardEdges!.bottom!.kick).toBeLessThanOrEqual(1.1);
  });

  it("fires no fixed heading off any wall", () => {
    // `bearing: up` on the floor is the tempting way to say "bouncy" and it
    // produces a vertical orbit in one column: the ball stops touching the
    // board, and a board the balls do not touch is captured wholesale.
    for (const side of ["top", "bottom", "left", "right"] as const) {
      expect(l14.boardEdges![side]?.bearing, `${side} aims instead of bouncing`).toBeUndefined();
    }
  });

  it("pins a gravity mutator that actually pulls one way", () => {
    // The shipped gravity_well rotates through all four directions, which is
    // the wrong partner for a map with a live floor: three quarters of the
    // cycle the trampoline is a side wall.
    const m = mutatorById(l14.mutator);
    expect(m, `level 14 pins "${l14.mutator}", which is not in the catalogue`).toBeTruthy();
    expect(m!.behavior).toBe("gravity");
    expect(m!.gravity?.sequence).toEqual(["down"]);
  });
});
