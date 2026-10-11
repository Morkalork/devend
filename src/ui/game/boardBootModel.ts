/**
 * The board's boot sequence (BoardBoot), as pure functions of time.
 *
 * Every map opens the same way, in one piece: the board's own frame and grid
 * stand in its place, opaque, for as long as the renderer takes; then a scan
 * line sweeps down the arena and leaves the real board behind it, and the
 * frame flashes as the map starts. It replaced three separate things that
 * never lined up (a translucent "Loading" outline, a shard assemble captured
 * from a different renderer, and the board popping in between them).
 *
 * The cover is opaque, so whatever the board draws before the line reaches it
 * (a warming renderer, a ball's spawn) is never seen; the map itself is held
 * still until the reveal ends (GameCanvas's bootHold), so nothing moves under
 * the cover either.
 */
import type { BoardFrameCss } from "./overlayModel";

/** When each part of a reveal runs, in seconds from its start. */
export interface BootTimeline {
  total: number;
  /** The frame outline traced clockwise from the top middle. */
  trace: readonly [number, number];
  /** The scan line's sweep from the arena's top to its bottom. */
  sweep: readonly [number, number];
  /** The caption fading out. */
  textOut: readonly [number, number];
  /** The frame's closing flash, rising then falling. */
  flash: readonly [number, number];
  /** The run-start version's flickering grid cells, before the sweep. */
  cells: readonly [number, number] | null;
}

/** An ordinary map: quick, so the next map never feels slow to start. */
export const BOOT_SHORT: BootTimeline = {
  total: 1.0, trace: [0, 0.3], sweep: [0.12, 0.72], textOut: [0, 0.18], flash: [0.6, 1.0], cells: null,
};

/** The first map of a run: longer, with the grid compiling cell by cell before the sweep. */
export const BOOT_LONG: BootTimeline = {
  total: 1.75, trace: [0, 0.55], sweep: [0.5, 1.25], textOut: [0.3, 0.55], flash: [1.1, 1.75], cells: [0, 0.6],
};

/** Reduced motion: no sweep or flash, the cover simply fades. */
export const BOOT_REDUCED: BootTimeline = {
  total: 0.25, trace: [0, 0], sweep: [0, 0], textOut: [0, 0.25], flash: [0, 0], cells: null,
};

export function bootTimeline(runStart: boolean, reduceMotion: boolean): BootTimeline {
  return reduceMotion ? BOOT_REDUCED : runStart ? BOOT_LONG : BOOT_SHORT;
}

/** 0..1 through [a, b] at `t`: 0 before, 1 after. */
export function span(t: number, [a, b]: readonly [number, number]): number {
  if (b <= a) return t >= b ? 1 : 0;
  return Math.max(0, Math.min(1, (t - a) / (b - a)));
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k: number) => 1 - (1 - k) ** 3;

/** Grid spacing as a share of the arena, the same 12 cells the outline always drew. */
export const BOOT_GRID_CELLS = 12;

export interface BootGeometry {
  /** The arena inside the frame band, relative to the frame's outer edge. */
  inner: { x: number; y: number; width: number; height: number };
  /** Grid spacing. */
  cell: number;
}

export function bootGeometry(frame: BoardFrameCss): BootGeometry {
  const width = frame.width - frame.frame * 2;
  return {
    inner: { x: frame.frame, y: frame.frame, width, height: frame.height - frame.frame * 2 },
    cell: width / BOOT_GRID_CELLS,
  };
}

/** Everything a reveal draws at time `t`, for an arena `height` tall. */
export interface BootFrame {
  /** Share of the frame outline traced so far, 0..1. */
  trace: number;
  /** Where the cover starts, in the arena's own y: above it the board shows. */
  coverTop: number;
  /** The cover's opacity (only below 1 when reduced motion fades it). */
  coverAlpha: number;
  /** The scan line's y in the arena, and how bright it is (0 when not sweeping). */
  scanY: number;
  scanAlpha: number;
  /** The caption's opacity. */
  textAlpha: number;
  /** The closing flash, 0..1..0, and how far its ring has spread (0..1). */
  flash: number;
  ring: number;
  /** The run-start cell flicker's strength, 0..1 (0 on an ordinary map). */
  cells: number;
  /** The reveal is over: the board is the board. */
  done: boolean;
}

export function bootFrame(t: number, tl: BootTimeline, height: number): BootFrame {
  const sweep = span(t, tl.sweep);
  const reduced = tl.sweep[1] <= tl.sweep[0];
  const eased = easeInOut(sweep);
  const flashK = span(t, tl.flash);
  const cellsK = tl.cells ? span(t, tl.cells) : 1;
  return {
    trace: easeOut(span(t, tl.trace)),
    coverTop: reduced ? 0 : eased * height,
    coverAlpha: reduced ? 1 - span(t, tl.textOut) : 1,
    scanY: eased * height,
    scanAlpha: !reduced && sweep > 0 && sweep < 1 ? 1 : 0,
    textAlpha: 1 - span(t, tl.textOut),
    // Up fast, down slow: a hit of light as the map goes live.
    flash: flashK <= 0 || flashK >= 1 ? 0 : flashK < 0.25 ? flashK / 0.25 : 1 - (flashK - 0.25) / 0.75,
    ring: easeOut(flashK),
    cells: tl.cells && cellsK > 0 && cellsK < 1 ? Math.sin(cellsK * Math.PI) : 0,
    done: t >= tl.total,
  };
}

/** A small deterministic hash in [0, 1): the same "random" layout every frame. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** One spark thrown off the scan line. */
export interface Spark {
  x: number;
  y: number;
  alpha: number;
  size: number;
}

/** How many sparks a sweep throws, and how long each lives (seconds). */
export const SPARK_COUNT = 36;
export const SPARK_LIFE = 0.45;

/**
 * The sparks alive at `t`: each is born where the line is at its own moment
 * of the sweep, then drifts up (behind the line) and sideways, fading out.
 */
export function bootSparks(t: number, tl: BootTimeline, width: number, height: number): Spark[] {
  const [a, b] = tl.sweep;
  if (b <= a) return [];
  const out: Spark[] = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const born = a + ((i + hash01(i)) / SPARK_COUNT) * (b - a);
    const age = t - born;
    if (age < 0 || age > SPARK_LIFE) continue;
    const k = age / SPARK_LIFE;
    const y0 = easeInOut(span(born, tl.sweep)) * height;
    const drift = (hash01(i + 50) - 0.5) * 40;
    out.push({
      x: hash01(i + 100) * width + drift * k,
      y: y0 - (18 + hash01(i + 200) * 46) * easeOut(k),
      alpha: (1 - k) * (0.55 + 0.45 * hash01(i + 300)),
      size: 1.5 + hash01(i + 400) * 2,
    });
  }
  return out;
}

/** The run-start flicker: which grid cells are lit at `t`, and how brightly. */
export function bootCells(t: number, strength: number, cols: number, rows: number): { col: number; row: number; alpha: number }[] {
  if (strength <= 0) return [];
  const out: { col: number; row: number; alpha: number }[] = [];
  // A new pattern every 70ms, so it reads as work rather than noise.
  const step = Math.floor(t / 0.07);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = hash01(step * 997 + r * 31 + c);
      if (h < 0.18 * strength) out.push({ col: c, row: r, alpha: (0.25 + 0.5 * hash01(h * 1000)) * strength });
    }
  }
  return out;
}
