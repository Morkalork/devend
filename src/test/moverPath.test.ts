/**
 * Authoring a mover by its path instead of by arithmetic.
 *
 * A mover is stored as a home plus a `range` and patrols `home +/- range/2`
 * along its axis, so the two positions that actually collide with things are
 * not numbers in map.yml. Every shipped mover was placed by doing that sum in
 * your head and then running the map to find out whether the far end had walked
 * into a wall.
 *
 * These pin the two conversions the builder draws with, because getting either
 * one subtly wrong gives you a path that looks right on the canvas and is not
 * where the mover goes, which is worse than having no drawing at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  isMoverEntity, moverHome, moverCenterAt, moverStartOffset, moverPath,
  moverTraverseSeconds, rangeFromHandle, axisFromDelta, moverFootprintAt,
  moverEscapesBoard, DEFAULT_MOVER_RANGE, DEFAULT_MOVER_SPEED,
} from "@/lib/moverPath";
import type { LevelMoverEntity } from "@/types/level";

const rect = (over: Partial<LevelMoverEntity> = {}): LevelMoverEntity => ({
  id: "m", kind: "mover", shape: "rect",
  x: 400, y: 437, width: 100, height: 26,
  axis: "horizontal", range: 280, speed: 130,
  ...over,
} as LevelMoverEntity);

const circle = (over: Partial<LevelMoverEntity> = {}): LevelMoverEntity => ({
  id: "c", kind: "mover", shape: "circle",
  cx: 450, cy: 450, radius: 40,
  axis: "vertical", range: 200, speed: 100,
  ...over,
} as LevelMoverEntity);

describe("home is the middle of the patrol, not a corner", () => {
  /**
   * The trap: a rect mover is authored by its top-left like every other rect,
   * and patrols around its CENTRE. Drawing the path from `x` would put it half
   * a width off, which is exactly the size of error you do not notice.
   */
  it("reads a rect's home from its centre, not its top-left", () => {
    expect(moverHome(rect())).toEqual({ x: 450, y: 450 });
  });

  it("reads a circle's home from cx/cy", () => {
    expect(moverHome(circle())).toEqual({ x: 450, y: 450 });
  });

  it("swings evenly either side of home", () => {
    const p = moverPath(rect());
    expect(p.min).toEqual({ x: 310, y: 450 });
    expect(p.max).toEqual({ x: 590, y: 450 });
  });

  it("swings along the authored axis and no other", () => {
    const p = moverPath(circle());
    expect(p.min).toEqual({ x: 450, y: 350 });
    expect(p.max).toEqual({ x: 450, y: 550 });
  });
});

/**
 * The start marker has to agree with initGame exactly, or the builder draws a
 * starting position the game does not honour.
 */
describe("phase places the start", () => {
  const startOf = (phase: number | undefined) => moverStartOffset(rect({ phase }));

  it("matches initGame's phase * range - range / 2", () => {
    for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
      expect(startOf(phase)).toBe(phase * 280 - 140);
    }
  });

  it("defaults to the left/top extreme when phase is omitted", () => {
    expect(startOf(undefined)).toBe(-140);
    expect(moverPath(rect()).start).toEqual(moverPath(rect()).min);
  });

  it("puts phase 0.5 back on the home position", () => {
    expect(moverPath(rect({ phase: 0.5 })).start).toEqual(moverHome(rect()));
  });

  it("puts phase 1 at the far end", () => {
    expect(moverPath(rect({ phase: 1 })).start).toEqual(moverPath(rect()).max);
  });

  /**
   * The reason the phase control exists: two movers with the same travel and
   * opposite phases make an alternating gate, identical phases make them one
   * wide block, and nothing in the YAML tells you which you built.
   */
  it("separates a pair authored as an alternating gate", () => {
    const a = moverPath(rect({ phase: 0 })).start;
    const b = moverPath(rect({ phase: 1 })).start;
    expect(a).not.toEqual(b);
    expect(Math.abs(a.x - b.x)).toBe(280);
  });
});

describe("the one-way time the panel advertises", () => {
  /**
   * Exact rather than approximate despite the easing at the turns: moverEase
   * normalises its curve so a full traverse takes precisely as long as the
   * constant-speed one it replaced. Eleven shipped maps time their necks
   * against these patrols.
   */
  it("is range over speed", () => {
    expect(moverTraverseSeconds({ range: 280, speed: 130 })).toBeCloseTo(280 / 130, 6);
  });

  it("does not divide by a zero or missing speed", () => {
    expect(moverTraverseSeconds({ range: 280, speed: 0 })).toBe(0);
    expect(moverTraverseSeconds({ range: 280, speed: -5 })).toBe(0);
  });
});

describe("dragging the end handle", () => {
  const home = { x: 450, y: 450 };

  it("keeps the patrol centred on the object you placed", () => {
    // The handle sits at one extreme, so its reach is half the range.
    expect(rangeFromHandle(home, { x: 590, y: 450 }, "horizontal")).toBe(280);
    expect(rangeFromHandle(home, { x: 310, y: 450 }, "horizontal")).toBe(280);
  });

  it("reads only the axis it travels on", () => {
    expect(rangeFromHandle(home, { x: 590, y: 900 }, "horizontal")).toBe(280);
    expect(rangeFromHandle(home, { x: 900, y: 550 }, "vertical")).toBe(200);
  });

  it("never produces a negative travel", () => {
    expect(rangeFromHandle(home, { x: 450, y: 450 }, "horizontal")).toBe(0);
  });

  /** Dragging sideways or downwards flips the axis, so the path is never a
   *  thing you set in one panel and check in another. */
  it("flips the axis toward whichever way the drag mostly went", () => {
    expect(axisFromDelta(200, 30)).toBe("horizontal");
    expect(axisFromDelta(30, 200)).toBe("vertical");
    expect(axisFromDelta(-200, 30)).toBe("horizontal");
    expect(axisFromDelta(0, 0)).toBe("horizontal");
  });
});

describe("the footprint at each end", () => {
  it("reports the body, not just the centre line", () => {
    // What hits the wall is the edge of the object, half a width past the path.
    expect(moverFootprintAt(rect(), 140)).toEqual({ x: 540, y: 437, width: 100, height: 26 });
  });

  it("boxes a circle by its radius", () => {
    expect(moverFootprintAt(circle(), -100)).toEqual({ x: 410, y: 310, width: 80, height: 80 });
  });

  /**
   * The single most common way an authored mover goes wrong, and invisible
   * until the map is run: home sits comfortably inside the arena and the far
   * extreme is half a range past the wall.
   */
  it("catches a patrol whose far end leaves the board", () => {
    expect(moverEscapesBoard(rect(), 900, 45)).toBe(false);
    expect(moverEscapesBoard(rect({ range: 800 }), 900, 45)).toBe(true);
    // The body escapes while the CENTRE line is still inside the margin: at
    // range 780 the far centre sits at x 60, comfortably past 45, and the left
    // edge of the object is at 10.
    expect(moverEscapesBoard(rect({ range: 780 }), 900, 45)).toBe(true);
    expect(moverCenterAt(rect({ range: 780 }), -390).x).toBeGreaterThan(45);
  });
});

/**
 * The builder's defaults exist so a new mover behaves like the ones already in
 * the game rather than like something a tool invented.
 */
describe("the shipped maps agree with the builder's defaults", () => {
  const MAPS = yaml.load(
    readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
  ) as { levels: { level?: number; entities?: Record<string, unknown>[] }[] };

  const movers = MAPS.levels.flatMap(l =>
    (l.entities ?? []).filter(e => e.kind === "mover") as unknown as LevelMoverEntity[]);

  it("finds movers to check", () => {
    expect(movers.length).toBeGreaterThan(5);
  });

  /**
   * Seeded from the MEDIAN of the ladder, not from the debut map. Level 4's
   * pair (280 at 130) is the gentlest on the board and the values climb through
   * the acts, so seeding from it would make every placed mover feel like an
   * act-I set piece.
   */
  it("seeds a new mover from the ladder median", () => {
    const median = (key: "range" | "speed") => {
      const sorted = movers.map(m => m[key]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    expect(median("range")).toBe(DEFAULT_MOVER_RANGE);
    expect(median("speed")).toBe(DEFAULT_MOVER_SPEED);
  });

  it("sits inside the range the ladder actually spans", () => {
    const ranges = movers.map(m => m.range), speeds = movers.map(m => m.speed);
    expect(DEFAULT_MOVER_RANGE).toBeGreaterThanOrEqual(Math.min(...ranges));
    expect(DEFAULT_MOVER_RANGE).toBeLessThanOrEqual(Math.max(...ranges));
    expect(DEFAULT_MOVER_SPEED).toBeGreaterThanOrEqual(Math.min(...speeds));
    expect(DEFAULT_MOVER_SPEED).toBeLessThanOrEqual(Math.max(...speeds));
  });

  it("recognises every one of them as a mover", () => {
    for (const m of movers) expect(isMoverEntity(m)).toBe(true);
  });

  /** The guard the builder now draws. If a shipped map trips it, the check is
   *  wrong rather than the map, since these all play. */
  it("agrees that no shipped patrol leaves the board", () => {
    const offenders = movers
      .filter(m => moverEscapesBoard(m, 900, 45))
      .map(m => `${m.id} (${m.axis}, range ${m.range})`);
    expect(offenders).toEqual([]);
  });

  it("keeps every shipped mover's centre inside its own patrol", () => {
    for (const m of movers) {
      const p = moverPath(m);
      const half = m.range / 2;
      expect(moverCenterAt(m, 0)).toEqual(moverHome(m));
      expect(Math.hypot(p.max.x - p.min.x, p.max.y - p.min.y)).toBeCloseTo(half * 2, 6);
    }
  });
});
