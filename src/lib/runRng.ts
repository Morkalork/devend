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

/** mulberry32 — tiny fast deterministic PRNG over a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic generator for an arbitrary seed text. */
export function createRng(seedText: string): Rng {
  return mulberry32(hashString(seedText));
}

// ── The active run's seed context ───────────────────────────────────────────

let runSeedText: string | null = null;

/** Arm (or clear, with null) the seeded-run context. Set on run start/resume. */
export function setRunSeedText(seed: string | null): void {
  runSeedText = seed;
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
