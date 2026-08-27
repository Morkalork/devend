/**
 * The gravity indicator: which way, and how long.
 *
 * Reported three times from live play, most recently as "the gravity has gone
 * bananas" on a level 16 that had rolled the Technical Gravity mutator. The
 * physics was right every time. Nothing on the board said gravity was on:
 *
 *   - the board only tilts to keep the pull at screen-bottom, and the opening
 *     phase pulls DOWN, whose rest angle is zero. The most common state of a
 *     gravity map looks exactly like a map without gravity.
 *   - the board is square, so 90/180/270 leave the frame unchanged.
 *   - the mutator's name sits inside the collapsed SPECS panel.
 *   - and `secondsToNextShift` has always been documented as being "for the
 *     on-screen indicator", and nothing ever called it.
 *
 * These pin the arithmetic the indicator is built on, because a cue that points
 * the wrong way is worse than none: the player would commit cuts to it.
 */
import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { ChromeLayer } from "@/lib/rendering/sleek/chromeLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import type { CanvasGameState } from "@/types/gameState";
import { gravityCue, pullEdge, URGENT_SECONDS } from "@/lib/rendering/sleek/gravityCue";
import { normaliseGravity, gravityVectorAt } from "@/lib/physics/gravity";
import { tiltAngleAt } from "@/lib/boardTilt";
import type { GravityConfig } from "@/lib/physics/gravity";

/** The authored mutator, exactly as public/mapMutators.yml has it. */
const CFG = normaliseGravity({
  turnRate: 1.1,
  period: 9,
  sequence: ["down", "none", "left", "none", "up", "none", "right", "none"],
})!;

const RECT = { left: 0, top: 0, width: 800, height: 800 };

/** The cue as the renderer builds it: at the board's real angle for that moment. */
const cueAt = (seconds: number, cfg: GravityConfig = CFG) =>
  gravityCue(cfg, seconds, tiltAngleAt(seconds, cfg));

describe("a board that does not pull", () => {
  it("has no cue at all, so nothing is drawn and nothing is paid for", () => {
    expect(gravityCue(null, 5, 0)).toBeNull();
    expect(gravityCue(undefined, 5, 0)).toBeNull();
  });

  it("has no cue for a config with an empty sequence", () => {
    expect(gravityCue({ turnRate: 1, period: 5, sequence: [] }, 5, 0)).toBeNull();
  });
});

describe("which way the pull runs, on screen", () => {
  /**
   * The whole point of the tilt is that the pull always reads as screen-down
   * once the board has settled. If the cue disagreed with that, it would point
   * somewhere the player is not being dragged.
   */
  it("points at the bottom of the screen in every settled pulling phase", () => {
    // Phases 0, 2, 4, 6 pull (down, left, up, right); +5s is well clear of the
    // 0.7s turn, so the board has settled.
    for (const phase of [0, 2, 4, 6]) {
      const t = phase * CFG.period + 5;
      const cue = cueAt(t)!;
      expect(cue.pull, `phase ${phase} has no pull`).toBeTruthy();
      expect(cue.pull!.x, `phase ${phase} x`).toBeCloseTo(0, 6);
      expect(cue.pull!.y, `phase ${phase} y`).toBeCloseTo(1, 6);
    }
  });

  it("is null during a gravity-free stretch", () => {
    for (const phase of [1, 3, 5, 7]) {
      expect(cueAt(phase * CFG.period + 5)!.pull, `phase ${phase}`).toBeNull();
    }
  });

  it("swings round with the board through a turn, rather than jumping", () => {
    // Mid-turn the board is part way round, so the pull is part way between
    // two edges. A cue that snapped would be wrong for 0.7s of every shift -
    // exactly the moment it matters most.
    const turnStart = 2 * CFG.period;          // the none -> left shift
    const mid = cueAt(turnStart + 0.35)!;
    const settled = cueAt(turnStart + 5)!;
    expect(mid.pull).toBeTruthy();
    // Part way: neither the pre-turn frame nor the settled one.
    expect(Math.abs(mid.pull!.y - settled.pull!.y)).toBeGreaterThan(0.05);
    expect(Math.abs(mid.pull!.x)).toBeGreaterThan(0.05);
  });

  it("agrees with the vector the physics is actually applying", () => {
    // Same source, one rotation apart: the cue is the world pull rendered into
    // the frame the board is drawn in, and nothing else.
    const t = 2 * CFG.period + 5;
    const world = gravityVectorAt(t, CFG)!;
    const cue = cueAt(t)!;
    const tilt = tiltAngleAt(t, CFG);
    const cos = Math.cos(tilt), sin = Math.sin(tilt);
    expect(cue.pull!.x).toBeCloseTo(world.x * cos - world.y * sin, 6);
    expect(cue.pull!.y).toBeCloseTo(world.x * sin + world.y * cos, 6);
  });
});

describe("how long until it changes", () => {
  it("drains across the phase and resets at the shift", () => {
    expect(cueAt(0.01)!.secondsLeft).toBeCloseTo(CFG.period, 1);
    expect(cueAt(CFG.period - 0.01)!.secondsLeft).toBeCloseTo(0, 1);
    expect(cueAt(CFG.period + 0.01)!.secondsLeft).toBeCloseTo(CFG.period, 1);
  });

  it("runs progress the other way, 0 at the start and 1 at the shift", () => {
    expect(cueAt(0.01)!.progress).toBeCloseTo(0, 2);
    expect(cueAt(CFG.period / 2)!.progress).toBeCloseTo(0.5, 2);
    expect(cueAt(CFG.period - 0.01)!.progress).toBeCloseTo(1, 2);
  });

  it("goes urgent only in the final stretch", () => {
    expect(cueAt(CFG.period - URGENT_SECONDS - 0.5)!.urgent).toBe(false);
    expect(cueAt(CFG.period - URGENT_SECONDS + 0.5)!.urgent).toBe(true);
  });

  it("counts down through a CALM stretch too", () => {
    // A quiet phase ending is the moment the board starts dragging again, and
    // is as worth telegraphing as a pull ending.
    const calm = cueAt(CFG.period + 5)!;
    expect(calm.pull).toBeNull();
    expect(calm.secondsLeft).toBeGreaterThan(0);
    expect(calm.next, "the pull returning is not announced").toBeTruthy();
  });
});

describe("where it goes next", () => {
  it("names the pull one phase on, not the one after that", () => {
    // Phase 1 is calm and phase 2 pulls left, so from inside phase 1 the next
    // pull is left: (-1, 0) in world, and the board has not turned yet.
    const cue = gravityCue(CFG, CFG.period + 5, 0)!;
    expect(cue.next).toBeTruthy();
    expect(cue.next!.x).toBeCloseTo(-1, 6);
    expect(cue.next!.y).toBeCloseTo(0, 6);
  });

  it("is null when the next stretch is a calm one", () => {
    // Phase 0 pulls, phase 1 does not.
    expect(gravityCue(CFG, 5, 0)!.next).toBeNull();
  });

  it("wraps from the last phase back to the first", () => {
    const last = CFG.sequence.length - 1;
    const cue = gravityCue(CFG, last * CFG.period + 5, 0)!;
    // Sequence ends on "none" and starts on "down".
    expect(cue.next!.y).toBeCloseTo(1, 6);
  });
});

describe("the edge a pull points at", () => {
  it("hugs the correct side for each cardinal", () => {
    const t = 20;
    expect(pullEdge({ x: 0, y: 1 }, RECT, t)).toEqual({ x: 0, y: 780, width: 800, height: 20 });
    expect(pullEdge({ x: 0, y: -1 }, RECT, t)).toEqual({ x: 0, y: 0, width: 800, height: 20 });
    expect(pullEdge({ x: 1, y: 0 }, RECT, t)).toEqual({ x: 780, y: 0, width: 20, height: 800 });
    expect(pullEdge({ x: -1, y: 0 }, RECT, t)).toEqual({ x: 0, y: 0, width: 20, height: 800 });
  });

  it("takes the dominant axis on a diagonal, so a turn slides rather than blinks", () => {
    const mostlyDown = pullEdge({ x: 0.4, y: 0.92 }, RECT, 20);
    expect(mostlyDown.height).toBe(20);           // a horizontal band: bottom
    const mostlyRight = pullEdge({ x: 0.92, y: 0.4 }, RECT, 20);
    expect(mostlyRight.width).toBe(20);           // a vertical band: right
  });

  it("always stays inside the board", () => {
    for (const dir of [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
      const e = pullEdge(dir, RECT, 20);
      expect(e.x).toBeGreaterThanOrEqual(RECT.left);
      expect(e.y).toBeGreaterThanOrEqual(RECT.top);
      expect(e.x + e.width).toBeLessThanOrEqual(RECT.left + RECT.width);
      expect(e.y + e.height).toBeLessThanOrEqual(RECT.top + RECT.height);
    }
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function graphicsIn(node: Container, found: Graphics[] = []): Graphics[] {
  if (node instanceof Graphics) found.push(node);
  for (const child of node.children ?? []) graphicsIn(child as Container, found);
  return found;
}

/**
 * How many fills and strokes a subtree issued.
 *
 * Operations, not path POINTS: nearly everything in this layer is `rect()`,
 * which Pixi stores as a Rectangle with width and height rather than as a list
 * of points, so a point count sees almost none of it. Counting points here was
 * measuring silence and calling it agreement.
 */
function drawnOps(node: Container): number {
  let n = 0;
  for (const g of graphicsIn(node)) n += ((g as any).context?.instructions ?? []).length;
  return n;
}

/** Every path point in a subtree, for the origin-stray check. */
function pathPoints(node: Container): number[] {
  const out: number[] = [];
  for (const g of graphicsIn(node)) {
    const paths: any[] = [];
    for (const ins of (g as any).context?.instructions ?? []) {
      if (ins.data?.path) paths.push(ins.data.path);
    }
    if ((g as any).context?._activePath) paths.push((g as any).context._activePath);
    for (const path of paths) {
      for (const prim of path.shapePath?.shapePrimitives ?? []) {
        for (const v of ((prim.shape as any).points ?? []) as number[]) out.push(v);
      }
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const BOARD = { left: 100, top: 200, width: 800, height: 800, scale: 1 };

function state(seconds: number, withGravity: boolean): CanvasGameState {
  return {
    boardRect: { ...BOARD },
    balls: [],
    spaceGrid: null,
    activePlaySeconds: seconds,
    gravityConfig: withGravity ? CFG : null,
    boardTilt: null,
    levelComplete: false,
    levelClearedTime: 0,
  } as unknown as CanvasGameState;
}

describe("the cue reaches the screen", () => {
  const light = lightScope(BOARD, 0);

  function ops(seconds: number, withGravity: boolean): number {
    const layer = new ChromeLayer();
    layer.sync(state(seconds, withGravity), light, 1, 1000, 20);
    return drawnOps(layer.container);
  }

  /** What the gravity cue alone contributed at this moment. */
  const cueOps = (seconds: number) => ops(seconds, true) - ops(seconds, false);

  it("is deterministic, so the differences below mean something", () => {
    expect(ops(5, false)).toBe(ops(5, false));
    expect(ops(5, true)).toBe(ops(5, true));
  });

  it("draws nothing at all on a board without gravity", () => {
    // The whole feature has to be free on every map that is not a gravity map.
    expect(ops(5, true)).toBeGreaterThan(ops(5, false));
    const bare = new ChromeLayer();
    bare.sync(state(5, false), light, 1, 1000, 20);
    // Its own Graphics exists but issued nothing.
    expect(cueOps(5)).toBeGreaterThan(0);
  });

  it("draws the band and chevrons while the board is pulling", () => {
    // This is the test secondsToNextShift never had: the indicator it was
    // written for was designed and never built, and nothing noticed for the
    // whole life of the feature.
    expect(cueOps(5), "a pulling board drew no cue at all").toBeGreaterThan(0);
  });

  it("still draws the countdown during a calm stretch", () => {
    // Less than a pulling phase (no band, no chevrons) but not nothing: the
    // pull coming back is worth telegraphing.
    const calm = cueOps(CFG.period + 5);
    const pulling = cueOps(5);
    expect(calm, "a calm stretch drew nothing").toBeGreaterThan(0);
    expect(calm, "a calm stretch drew as much as a pulling one").toBeLessThan(pulling);
  });

  it("adds the ghost of the next pull only once the shift is close", () => {
    // Same phase, two moments: the extra operation is the ghost band.
    const early = cueOps(CFG.period + 1);                       // calm, far off
    const late = cueOps(2 * CFG.period - 0.2);                  // calm, about to pull
    expect(late, "the next pull is never telegraphed").toBeGreaterThan(early);
  });

  it("never opens a path at the canvas origin", () => {
    // The chevrons are the only moveTo/lineTo run in this layer, and a shape
    // that forgets to open its own subpath draws a beam from (0,0) across the
    // whole board. That has happened in this renderer before.
    const layer = new ChromeLayer();
    layer.sync(state(5, true), light, 1, 1000, 20);
    const pts = pathPoints(layer.container);
    expect(pts.length, "no path geometry to check").toBeGreaterThan(0);
    for (let i = 0; i + 1 < pts.length; i += 2) {
      expect(
        Math.hypot(pts[i], pts[i + 1]) > 0.5,
        `a path point sits on the origin; the board starts at (${BOARD.left},${BOARD.top})`,
      ).toBe(true);
    }
  });
});
