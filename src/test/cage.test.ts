/**
 * The cage: somewhere to PUT a ball for a while.
 *
 * Every tool in this game is permanent. A lock removes a ball for good, a fence
 * divides the board for good, a smash destroys a thing for good. There has never
 * been a way to say "not this one, not yet" - to take the ball that keeps
 * ruining a corner out of play for twenty seconds while you seal it.
 *
 * A cage is the only object whose state is driven by a BALL rather than by a
 * clock or by the player. It is also the only one whose mouth has to be solid
 * sometimes and not others, which is why the mouth is a phasing object: phase
 * and alpha are already the single source of truth for tangibility and for how
 * a thing is drawn, read by both collision systems and both renderers. A mouth
 * that decided for itself would have to be taught to all of them again, and
 * whichever one was missed would be a wall balls pass through and fences stop
 * at.
 *
 * So the tests that matter are: it shuts on a ball, it opens again on time, it
 * catches ONE, and the mouth's tangibility really does follow.
 */
import { describe, it, expect } from "vitest";
import { tickCages, ballInCage, cageProgress, type CageState } from "@/lib/physics/cage";
import { collectPhasedOut } from "@/lib/physics/phasing";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball, PhasingObjectState } from "@/types/game";
import { createRectPolygon } from "@/lib/polygon";

const MOUTH = "pen-mouth";

const cage = (over: Partial<CageState> = {}): CageState => ({
  id: "pen", inner: { x: 200, y: 200, width: 160, height: 160 },
  mouthId: MOUTH, holdSeconds: 10, ...over,
});

const mouth = (): PhasingObjectState => ({
  id: MOUTH, polygon: createRectPolygon(200, 180, 360, 200),
  wallIds: ["obstacle-pen-mouth-edge-0"], startedAt: 0, cycleSeconds: 0,
  phase: "out", alpha: 0, cageOf: "pen",
});

const ball = (x: number, y: number, state = "active"): Ball =>
  ({ id: "b", position: { x, y }, velocity: { x: 100, y: 0 }, speed: 100, radius: 18, state } as unknown as Ball);

const game = (balls: Ball[], cages: CageState[], mouths: PhasingObjectState[]): CanvasGameState =>
  ({ balls, cages, phasingObjects: mouths } as unknown as CanvasGameState);

describe("catching", () => {
  it("knows when a ball is inside", () => {
    expect(ballInCage(ball(280, 280), cage())).toBe(true);
    expect(ballInCage(ball(600, 280), cage())).toBe(false);
  });

  it("shuts the mouth behind a ball that wanders in", () => {
    const c = cage(), m = mouth();
    tickCages(game([ball(280, 280)], [c], [m]), 1000);
    expect(c.closedAt).toBe(1000);
    expect(m.phase, "the mouth stayed open with a ball inside").toBe("in");
    expect(m.alpha).toBe(1);
  });

  it("stays open with nothing in it", () => {
    const c = cage(), m = mouth();
    tickCages(game([ball(600, 600)], [c], [m]), 1000);
    expect(c.closedAt).toBeUndefined();
    expect(m.phase).toBe("out");
  });

  it("ignores a dormant ball", () => {
    // A launcher's loaded roster must not spring a cage it happens to sit in.
    const c = cage(), m = mouth();
    tickCages(game([ball(280, 280, "dormant")], [c], [m]), 1000);
    expect(c.closedAt).toBeUndefined();
  });

  it("ignores a locked ball", () => {
    const c = cage(), m = mouth();
    tickCages(game([ball(280, 280, "won")], [c], [m]), 1000);
    expect(c.closedAt).toBeUndefined();
  });

  it("holds only one, so a cage is never an unearned multi-lock", () => {
    const c = cage(), m = mouth();
    const a = ball(240, 240); a.id = "a";
    const b = ball(320, 320); b.id = "b";
    tickCages(game([a, b], [c], [m]), 1000);
    expect(c.heldBallId).toBe("a");
  });
});

describe("releasing", () => {
  it("holds for its full term", () => {
    const c = cage({ holdSeconds: 10 }), m = mouth();
    const g = game([ball(280, 280)], [c], [m]);
    tickCages(g, 1000);
    tickCages(g, 1000 + 9_999);
    expect(c.closedAt, "released early").toBe(1000);
    expect(m.phase).toBe("in");
  });

  it("opens the moment the term is up", () => {
    const c = cage({ holdSeconds: 10 }), m = mouth();
    const g = game([ball(280, 280)], [c], [m]);
    tickCages(g, 1000);
    tickCages(g, 1000 + 10_000);
    expect(c.closedAt).toBeUndefined();
    expect(c.heldBallId).toBeUndefined();
    expect(m.phase, "the mouth never reopened").toBe("out");
  });

  it("measures against the shutting time, not a countdown", () => {
    // A dropped frame or a paused map must neither shorten a sentence nor
    // extend it, which a per-frame decrement would do to both.
    const c = cage({ holdSeconds: 5 }), m = mouth();
    const g = game([ball(280, 280)], [c], [m]);
    tickCages(g, 1000);
    tickCages(g, 60_000);          // one enormous gap, as a long stall would give
    expect(c.closedAt).toBeUndefined();
  });

  it("reports how much of the wait is served", () => {
    const c = cage({ holdSeconds: 10 });
    expect(cageProgress(c, 5000)).toBe(0);
    c.closedAt = 1000;
    expect(cageProgress(c, 1000)).toBeCloseTo(0, 6);
    expect(cageProgress(c, 6000)).toBeCloseTo(0.5, 6);
    expect(cageProgress(c, 99_000)).toBe(1);
  });
});

describe("the mouth is really solid, in the set collision reads", () => {
  it("is intangible while open and solid while shut", () => {
    // The whole reason the mouth is a phasing object. If this diverges, a cage
    // is a box that LOOKS shut, which is worse than one that never shuts.
    const c = cage(), m = mouth();
    const open = game([ball(600, 600)], [c], [m]);
    tickCages(open, 1000);
    expect(collectPhasedOut(open)!.walls.has(m.wallIds[0])).toBe(true);

    const shut = game([ball(280, 280)], [c], [m]);
    tickCages(shut, 2000);
    expect(collectPhasedOut(shut), "the mouth is still intangible with a ball inside").toBeNull();
  });
});
