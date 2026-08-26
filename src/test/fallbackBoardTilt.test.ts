/**
 * Wherever the emergency board draws a ball, a tap there must find that ball.
 *
 * The 2D fallback is not a second renderer in any real sense - it exists only
 * for the device where WebGL failed to start - but it shares one thing with the
 * sleek one that is not optional: the transform. `useGameInput` un-turns every
 * tap by `boardAngleFor` whichever renderer is running, so a fallback that drew
 * the board upright on a gravity map would put the fence up to ninety degrees
 * away from the finger that asked for it. A board that looks plain is the point
 * of the fallback; a board you cannot aim at is not.
 *
 * So this does not check that the fallback "applies the tilt" - it checks the
 * property that matters, and the only one the player can feel: project a ball
 * through the renderer, take the screen point it landed on, push it back
 * through the input path, and arrive at the ball.
 */
import { describe, it, expect } from "vitest";
import { renderFallbackBoard } from "@/lib/rendering/fallbackBoard";
import { screenToWorld } from "@/lib/boardConstants";
import { boardAngleFor } from "@/lib/boardTilt";
import { normaliseGravity } from "@/lib/physics/gravity";
import type { CanvasGameState } from "@/types/gameState";
import type { RenderContext } from "@/lib/rendering/types";
import type { Ball } from "@/types/game";

const BOARD_RECT = { left: 40, top: 90, width: 900, height: 900, scale: 1 };

/** The authored gravity mutator, which is what makes the board turn at all. */
const GRAVITY = normaliseGravity({
  turnRate: 1.1,
  period: 9,
  sequence: ["down", "none", "left", "none", "up", "none", "right", "none"],
})!;

/** Just enough 2D context to record where the ball was drawn. */
function recordingCtx() {
  const arcs: Array<{ x: number; y: number }> = [];
  const noop = () => {};
  const ctx = {
    arcs,
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop,
    moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop,
    arc: (x: number, y: number) => { arcs.push({ x, y }); },
    fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "butt", globalAlpha: 1,
  };
  return ctx as unknown as CanvasRenderingContext2D & { arcs: typeof arcs };
}

function stateAt(seconds: number, ballAt: { x: number; y: number }): CanvasGameState {
  const ball = {
    id: "grey-0", position: { ...ballAt }, velocity: { x: 1, y: 0 },
    radius: 18, color: "#cccccc", state: "active",
  } as unknown as Ball;
  return {
    boardRect: { ...BOARD_RECT },
    screenSize: { width: 1000, height: 1100 },
    spaceGrid: null,
    obstaclePolygons: [],
    walls: [],
    activeWalls: [],
    balls: [ball],
    gravityConfig: GRAVITY,
    boardTilt: null,
    activePlaySeconds: seconds,
  } as unknown as CanvasGameState;
}

describe("the emergency board and the finger agree", () => {
  /**
   * Mid-turn, on purpose. At a rest angle a bug here is invisible - the
   * authored sequence rests at 0 for its whole first phase - and it is
   * precisely DURING a turn that the board is at an angle nothing else would
   * catch. The first phase change (9s) is down -> none, and a "none" phase
   * INHERITS the orientation before it, so nothing turns there; the first real
   * turn is none -> left at 18s. +0.35s is halfway through the 0.7s ease. The
   * assertion below refuses to run if the board is not actually moving, which
   * is how that distinction got noticed rather than silently passed over.
   */
  const MID_TURN = 18 + 0.35;

  it("puts a tap back on the ball it was drawn on, mid-turn", () => {
    const world = { x: 300, y: 210 };
    const game = stateAt(MID_TURN, world);

    const angle = boardAngleFor(game.activePlaySeconds, game.gravityConfig, game.boardTilt);
    expect(Math.abs(angle), "the board is not actually turning here").toBeGreaterThan(0.05);

    const ctx = recordingCtx();
    renderFallbackBoard(ctx, game, {} as RenderContext);
    expect(ctx.arcs.length, "the fallback drew no ball at all").toBe(1);

    // The tap: exactly where the player sees the ball.
    const back = screenToWorld(ctx.arcs[0].x, ctx.arcs[0].y, BOARD_RECT, angle);
    expect(back.x, "tap landed off the ball in x").toBeCloseTo(world.x, 6);
    expect(back.y, "tap landed off the ball in y").toBeCloseTo(world.y, 6);
  });

  it("still agrees on a map with no gravity at all", () => {
    // The untilted path is the one every other map takes, and it must be
    // exactly the arithmetic it always was.
    const world = { x: 620, y: 480 };
    const game = stateAt(0, world);
    (game as unknown as { gravityConfig: null }).gravityConfig = null;

    const ctx = recordingCtx();
    renderFallbackBoard(ctx, game, {} as RenderContext);

    const back = screenToWorld(ctx.arcs[0].x, ctx.arcs[0].y, BOARD_RECT, 0);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });
});
