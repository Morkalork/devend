/**
 * runRng — the run-scoped seeded RNG behind Daily Stand-up (HIGHSCORES.md
 * Phase D).
 *
 * A daily run must serve every player the same CONTENT: level variants, draft
 * offers, shop shelves, obstacles, pickups. All of those roll through pure
 * helpers, so instead of threading an rng parameter down every React layer,
 * this module holds the active run's seed text (null = normal run) and hands
 * out a FRESH deterministic generator per (seed, context) pair:
 *
 *   getRunRng('shop:5')        // same sequence for everyone on today's seed
 *   getRunRng('levels')        // and StrictMode-safe: a fresh generator per
 *                              // call means double-invoked updaters agree
 *
 * With no seed set, getRunRng returns Math.random passthrough, so normal runs
 * behave exactly as before. Player CHOICES still diverge (which door you pick,
 * what you buy); only the offers are shared. Physics randomness (spawn angles,
 * fork targets) stays unseeded by design; see HIGHSCORES.md.
 */

export type Rng = () => number;

/** FNV-1a string hash — stable 32-bit seed from any seed text. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A generator whose position can be read and written.
 *
 * mulberry32 is one 32-bit word of state, so "where is this stream up to" is a
 * number. Two things need that number: a lockstep resync, which has to put a
 * guest's streams exactly where the host's are, and any test that runs two
 * simulations in one process, where the module-level stream table is shared
 * and one sim would otherwise be drawing the other's numbers.
 */
export interface StatefulRng {
  (): number;
  state(): number;
  setState(v: number): void;
}

/** mulberry32 — tiny fast deterministic PRNG over a 32-bit seed. */
export function mulberry32(seed: number): StatefulRng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a >>> 0;
  next.setState = (v: number) => { a = v >>> 0; };
  return next;
}

/** A deterministic generator for an arbitrary seed text. */
export function createRng(seedText: string): StatefulRng {
  return mulberry32(hashString(seedText));
}

// ── The active run's seed context ───────────────────────────────────────────

let runSeedText: string | null = null;

/** Arm (or clear, with null) the seeded-run context. Set on run start/resume. */
export function setRunSeedText(seed: string | null): void {
  runSeedText = seed;
  // Every persistent stream belonged to the run that just ended.
  streams.clear();
}

export function getRunSeedText(): string | null {
  return runSeedText;
}

/**
 * A generator for one named roll context of the active run. Deterministic when
 * a run seed is armed, Math.random passthrough otherwise. Always FRESH: two
 * calls with the same context yield identical sequences, which makes call
 * sites safe under React StrictMode double-invocation.
 */
export function getRunRng(context: string): Rng {
  if (runSeedText === null) return Math.random;
  return createRng(`${runSeedText}::${context}`);
}

/**
 * One PERSISTENT generator per context, for rolls made repeatedly during play.
 *
 * getRunRng is deliberately fresh every call, which is right at init: a
 * StrictMode double-invocation must not deal a different board. It is exactly
 * wrong during play. A rainbow asking `getRunRng('rainbowSpit')()` on every
 * spit gets the SAME number every time, so it would spit one colour forever -
 * which is worse than the unseeded randomness it replaced, and would look like
 * a content bug rather than a seeding one.
 *
 * This keeps the stream and advances it, so a seeded run replays the same
 * SEQUENCE of rolls. Cleared whenever the run seed changes, or run two would
 * continue run one's stream.
 */
const streams = new Map<string, StatefulRng>();
export function runStream(context: string): Rng {
  if (runSeedText === null) return Math.random;
  let stream = streams.get(context);
  if (!stream) {
    stream = createRng(`${runSeedText}::${context}`);
    streams.set(context, stream);
  }
  return stream;
}

// ── Daily Stand-up seed source ──────────────────────────────────────────────

/**
 * Today's stand-up key, UTC ("YYYY-MM-DD"): one shared run worldwide per UTC
 * day, so scores are comparable without a server.
 */
export function todayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The seed text for a given stand-up day. */
export function dailySeedText(dayKey: string): string {
  return `daily:${dayKey}`;
}

/** The previous calendar day's key (for attendance-streak checks). */
export function previousDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Stream positions, for resync and for two sims in one process ────────────

/** Where every live stream has got to. */
export type StreamCursors = Record<string, number>;

/**
 * Read the position of every advancing stream.
 *
 * Part of a lockstep resync: putting a drifted guest back on the host's board
 * means its ball positions AND its dice, or the very next roll sends the two
 * off again. Also what lets a test run two simulations against this one
 * module-level table without them drawing each other's numbers.
 */
export function exportStreamCursors(): StreamCursors {
  const out: StreamCursors = {};
  for (const [context, rng] of streams) out[context] = rng.state();
  return out;
}

/**
 * Put every stream back where the cursors say. EXACTLY where: a context in the
 * cursors is created or moved to that position, and one this side has that the
 * cursors do not is dropped.
 *
 * Exact rather than merged, because both sides run the same code and so roll
 * the same contexts; a context on one side only is already a divergence, and
 * leaving it behind would carry it through the repair that was meant to end
 * it.
 */
export function importStreamCursors(cursors: StreamCursors): void {
  if (runSeedText === null) return;
  for (const context of [...streams.keys()]) {
    if (!(context in cursors)) streams.delete(context);
  }
  for (const [context, state] of Object.entries(cursors)) {
    let stream = streams.get(context);
    if (!stream) {
      stream = createRng(`${runSeedText}::${context}`);
      streams.set(context, stream);
    }
    stream.setState(state);
  }
}
