/**
 * Playtesting a map from inside the editor.
 *
 * The bot has existed for a while and could only ever be reached from
 * `npm run test`. That is the wrong place for it: the person who needs to know
 * whether a map is winnable is the person who is editing it, at the moment they
 * are editing it. Until now their only feedback was to play the map themselves
 * - once, in one of the four orientations, on one roll of the random obstacles.
 *
 * This wraps runBot into something an editor can call and a human can read:
 * play the map many times across all four orientations and answer three
 * questions. Can it be won? How many cuts does it really take? Does anything
 * break?
 *
 * ── On forcing an orientation ──────────────────────────────────────────────
 *
 * A map's orientation is not a parameter; initGame rolls it from
 * getRunRng(`rotation:${id}`), so it is a function of the run seed. Rather than
 * add an override to a core signature purely for the editor's benefit, this
 * asks pickMapRotation what each candidate seed WOULD produce and picks a set
 * of seeds that covers all four. Same engine, no special case in it, and the
 * seeds reported back are real ones a player could get.
 */
import { runBot, type BotRunResult } from "@/lib/bot/runBot";
import { isHardViolation } from "@/lib/bot/invariants";
import { pickMapRotation, type MapRotation } from "@/lib/mapRotation";
import { getRunSeedText, setRunSeedText } from "@/lib/runRng";
import type { LevelConfig } from "@/types/level";

export interface PlaytestRun {
  seed: number;
  rotation: MapRotation;
  won: boolean;
  lost: boolean;
  cuts: number;
  locks: number;
  remainingPercent: number;
  stalled: boolean;
  hard: { rule: string; detail: string }[];
}

export interface RotationSummary {
  rotation: MapRotation;
  runs: number;
  won: number;
}

export interface PlaytestVerdict {
  levelId: string;
  runs: PlaytestRun[];
  total: number;
  won: number;
  lost: number;
  /** Neither won nor lost inside the frame budget. */
  timedOut: number;
  stalled: number;
  /** Median cuts across the runs that were WON - the honest "what does it cost". */
  medianWinningCuts: number | null;
  expectedCuts: number;
  byRotation: RotationSummary[];
  hard: { seed: number; rotation: MapRotation; rule: string; detail: string }[];
  /** Orientations this map can actually be dealt in (L1-3 never rotate). */
  possibleRotations: MapRotation[];
}

/**
 * What orientation seed `n` would deal. runBot seeds its run as `bot-<n>`, and
 * the orientation follows from that text.
 *
 * Puts back whatever seed was armed rather than clearing it. Nothing in the
 * editor currently has one armed, but this is exactly the kind of borrowed
 * global that ruins an unrelated caller months later: a Daily Stand-up run
 * silently losing its seed because a panel asked a question about rotations.
 */
export function rotationForSeed(level: LevelConfig, levelNumber: number, seed: number): MapRotation {
  const previous = getRunSeedText();
  setRunSeedText(`bot-${seed}`);
  try {
    return pickMapRotation(level.id, levelNumber);
  } finally {
    setRunSeedText(previous);
  }
}

/**
 * Seeds that between them deal every orientation this map can take.
 *
 * Walks candidate seeds until each reachable rotation has `perRotation` of
 * them, or the search budget runs out - which it will for levels below
 * ROTATION_MIN_LEVEL, where only orientation 0 exists and looking for the other
 * three would spin forever.
 */
export function seedsCoveringRotations(
  level: LevelConfig, levelNumber: number, perRotation = 2, budget = 200,
): { seed: number; rotation: MapRotation }[] {
  const found = new Map<MapRotation, number[]>();
  const out: { seed: number; rotation: MapRotation }[] = [];
  for (let seed = 1; seed <= budget; seed++) {
    const rotation = rotationForSeed(level, levelNumber, seed);
    const have = found.get(rotation) ?? [];
    if (have.length >= perRotation) continue;
    have.push(seed);
    found.set(rotation, have);
    out.push({ seed, rotation });
    // Every reachable orientation is full. On a rotating level that is four;
    // on L1-3 it is one, and this is what stops the loop running to budget.
    if (out.length >= perRotation * 4) break;
  }
  return out;
}

export interface PlaytestOptions {
  /** Runs per orientation. Four orientations, so 3 here is 12 games. */
  perRotation?: number;
  /** Frames per run. 5400 is 45 seconds of game time. */
  maxFrames?: number;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * One game.
 *
 * Split out from playtestMap so the editor can run the plan a game at a time
 * and keep painting between them. Each run takes over performance.now for its
 * duration, so a chunked caller must let one finish before starting the next -
 * which stepping one per tick does naturally.
 */
export function playtestOne(
  level: LevelConfig, levelNumber: number, seed: number, rotation: MapRotation,
  maxFrames = 5400,
): PlaytestRun {
  let r: BotRunResult;
  try {
    r = runBot(level, levelNumber, seed, { maxFrames });
  } catch (e) {
    // A map that CRASHES is the most important finding of all, and must not
    // take the editor down with it.
    return {
      seed, rotation, won: false, lost: false, cuts: 0, locks: 0,
      remainingPercent: 100, stalled: false,
      hard: [{ rule: "threw", detail: e instanceof Error ? e.message : String(e) }],
    };
  }
  return {
    seed, rotation,
    won: r.won, lost: r.lost, cuts: r.cuts, locks: r.locks,
    remainingPercent: r.remainingPercent,
    stalled: r.violations.some(v => v.rule === "progress-stalled"),
    hard: r.violations.filter(isHardViolation).map(v => ({ rule: v.rule, detail: v.detail })),
  };
}

/** Fold finished runs into the verdict. Pure, so a partial run set summarises too. */
export function summarise(level: LevelConfig, runs: PlaytestRun[]): PlaytestVerdict {
  const possibleRotations = [...new Set(runs.map(r => r.rotation))].sort() as MapRotation[];
  const byRotation: RotationSummary[] = possibleRotations.map(rotation => ({
    rotation,
    runs: runs.filter(r => r.rotation === rotation).length,
    won: runs.filter(r => r.rotation === rotation && r.won).length,
  }));

  return {
    levelId: level.id,
    runs,
    total: runs.length,
    won: runs.filter(r => r.won).length,
    lost: runs.filter(r => r.lost).length,
    timedOut: runs.filter(r => !r.won && !r.lost).length,
    stalled: runs.filter(r => r.stalled).length,
    medianWinningCuts: median(runs.filter(r => r.won).map(r => r.cuts)),
    expectedCuts: level.expectedCuts,
    byRotation,
    hard: runs.flatMap(r => r.hard.map(h => ({ seed: r.seed, rotation: r.rotation, ...h }))),
    possibleRotations,
  };
}

/** Play a map many times, all at once. Used by tests; the editor chunks instead. */
export function playtestMap(
  level: LevelConfig, levelNumber: number, opts: PlaytestOptions = {},
): PlaytestVerdict {
  const plan = seedsCoveringRotations(level, levelNumber, opts.perRotation ?? 3);
  const runs = plan.map(({ seed, rotation }) =>
    playtestOne(level, levelNumber, seed, rotation, opts.maxFrames ?? 5400));
  return summarise(level, runs);
}

/** A one-line human verdict, so the panel leads with the answer. */
export function verdictHeadline(v: PlaytestVerdict): { tone: "bad" | "warn" | "ok"; text: string } {
  if (v.total === 0) return { tone: "bad", text: "No runs completed." };
  if (v.hard.length > 0) {
    return { tone: "bad", text: `${v.hard.length} engine violation${v.hard.length > 1 ? "s" : ""} - this map breaks the game.` };
  }
  if (v.won === 0) {
    return { tone: "bad", text: `Never won in ${v.total} attempts. The map may be unwinnable.` };
  }
  const dead = v.byRotation.filter(r => r.won === 0);
  if (dead.length > 0) {
    return {
      tone: "bad",
      text: `Never won when dealt ${dead.length > 1 ? "orientations" : "orientation"} ${dead.map(d => d.rotation).join(", ")}.`,
    };
  }
  if (v.won < v.total / 2) {
    return { tone: "warn", text: `Won only ${v.won} of ${v.total}. Hard, or fragile.` };
  }
  return { tone: "ok", text: `Won ${v.won} of ${v.total}, every orientation clears.` };
}
