/**
 * The device check (DEVICE_LAB.md): what it plays, what it measures, and what
 * counts as a pass. Pure, so the tests and the lab's report read the same
 * rules the phone applied.
 *
 * Asked for as "I need to know that it works on phones as old as four years":
 * the game boots to a menu a player can see, every map drawn here shows its
 * board, a fence can be drawn, nothing throws, and the frame rate a map settles
 * at is one a player can play at. The visibility checks are the ones a phone's
 * own graphics stack can break without a single error (Opera on PowerVR drew
 * the whole menu and showed none of it), so they read pixels back rather than
 * trusting that a draw call means a picture.
 */

/**
 * The maps it plays, light to heavy: one ball; 22 obstacles; 17 obstacles and
 * three balls; four balls. Each plays from its first frame: a launcher map
 * (17, Demolition) waits for the player's pull, takes no fence until then, and
 * barely redraws, so it would measure the wait rather than the device.
 */
export const DEVICE_CHECK_LEVELS = [1, 6, 9, 27] as const;
/** Settling time per map before measuring: the board loads, the quality governor gets its look. */
export const WARMUP_MS = 3000;
/** Frames measured per map. */
export const MEASURE_MS = 12000;
/** When, into the measuring, it draws a fence across the board. */
export const FENCE_AT_MS = 2000;

/** Where a frame stops being smooth: two 60 Hz refreshes. */
export const SLOW_FRAME_MS = 1000 / 30;
/** A median frame slower than this (20 fps) is not playable. */
export const PLAYABLE_MEDIAN_MS = 50;
/** The menu has to be on screen within this long of the page starting. */
export const BOOT_LIMIT_MS = 20000;

export interface FrameStats {
  frames: number;
  medianMs: number;
  p95Ms: number;
  /** Frames per second at the median frame. */
  fps: number;
  /** Share of frames slower than SLOW_FRAME_MS, 0 to 1. */
  slowShare: number;
}

/** Statistics over frame intervals (ms). Empty in, zeros out. */
export function frameStats(intervals: readonly number[]): FrameStats {
  if (intervals.length === 0) {
    return { frames: 0, medianMs: 0, p95Ms: 0, fps: 0, slowShare: 0 };
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const medianMs = at(0.5);
  const slow = sorted.filter(ms => ms > SLOW_FRAME_MS).length;
  return {
    frames: sorted.length,
    medianMs: round1(medianMs),
    p95Ms: round1(at(0.95)),
    fps: medianMs > 0 ? round1(1000 / medianMs) : 0,
    slowShare: Math.round((slow / sorted.length) * 1000) / 1000,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Pixels sampled on a canvas: how many had anything drawn in them. */
export interface LitSample {
  lit: number;
  total: number;
}

export interface MapCheck {
  level: number;
  id: string;
  /** Whether the map's board mounted at all. */
  loaded: boolean;
  frames: FrameStats;
  /** The board's own pixels, read back the frame they were drawn; null when they could not be read. */
  board: LitSample | null;
  /** Whether the injected fence was taken by the board (a fence or a cut appeared). */
  fenceTaken: boolean;
  /** What the board did with that touch (touchTrace.ts), when it was not taken. */
  fenceTrace?: string[];
  /** The 3D renderer's quality tier when the map ended, or "2d". */
  tier: string;
  /** perfStats: average render and peak physics time per frame, ms. */
  renderAvgMs: number;
  physicsPeakMs: number;
}

export interface DeviceCheckResult {
  version: 1;
  startedAt: string;
  device: {
    userAgent: string;
    gpu: string | null;
    screen: string;
    dpr: number;
    cores: number | null;
    memoryGb: number | null;
  };
  /** Page start to the menu being ready and the splash gone, ms. Null when it never was. */
  bootMs: number | null;
  /** The interface canvas's pixels on the menu. */
  menu: LitSample | null;
  maps: MapCheck[];
  /** Renderer starts that failed, shader errors and quality steps (rendererDiag.ts). */
  renderer: string[];
  /** Errors caught on the page while it ran (index.html's record). */
  errors: string[];
  /** Whether frame rate counted towards the verdict (VerdictOptions). */
  framesJudged: boolean;
  pass: boolean;
  failures: string[];
  /** Reported, not failed on: slow but playable. */
  warnings: string[];
}

/** Anything at all drawn: a canvas with no lit sample shows nothing. */
function shows(s: LitSample | null): boolean {
  return !!s && s.lit > 0;
}

export interface VerdictOptions {
  /**
   * Fail on frame rate. Off for the emulated CI tiers: a software GPU draws a
   * board at two frames a second on any CPU, so there the rate is reported and
   * only a real device's is judged.
   */
  judgeFrames: boolean;
}

/** What failed and what only warns, from the measurements. */
export function verdict(
  r: Pick<DeviceCheckResult, "bootMs" | "menu" | "maps" | "errors">,
  opts: VerdictOptions = { judgeFrames: true },
): {
  pass: boolean; failures: string[]; warnings: string[];
} {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (r.bootMs === null) {
    failures.push("the menu never finished loading");
  } else if (r.bootMs > BOOT_LIMIT_MS) {
    failures.push(`the menu took ${Math.round(r.bootMs / 1000)}s to load (limit ${BOOT_LIMIT_MS / 1000}s)`);
  }
  if (r.menu === null) {
    warnings.push("the menu's pixels could not be read");
  } else if (!shows(r.menu)) {
    failures.push("the menu drew nothing visible");
  }
  for (const m of r.maps) {
    const name = `level ${m.level}`;
    if (!m.loaded) {
      failures.push(`${name} did not load`);
      continue;
    }
    if (m.board === null) {
      warnings.push(`${name}: the board's pixels could not be read`);
    } else if (!shows(m.board)) {
      failures.push(`${name}: the board drew nothing visible`);
    }
    if (!m.fenceTaken) {
      failures.push(`${name}: a fence drawn across the board was not taken`);
    }
    if (m.frames.frames === 0) {
      failures.push(`${name}: no frames were drawn`);
    } else if (!opts.judgeFrames) {
      // Reported in the result, judged only on a real device.
    } else if (m.frames.medianMs > PLAYABLE_MEDIAN_MS) {
      failures.push(`${name}: ${m.frames.fps} fps at the median frame (playable is ${Math.round(1000 / PLAYABLE_MEDIAN_MS)}+)`);
    } else if (m.frames.slowShare > 0.25) {
      warnings.push(`${name}: ${Math.round(m.frames.slowShare * 100)}% of frames under 30 fps`);
    }
  }
  if (r.errors.length > 0) {
    failures.push(`${r.errors.length} error(s) on the page`);
  }
  return { pass: failures.length === 0, failures, warnings };
}
