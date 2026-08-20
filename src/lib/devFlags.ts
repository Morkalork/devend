/**
 * Admin-only run flags (persisted, same shape as the perf HUD / lock-debug
 * toggles): switches that change how a NORMAL run plays so a late map can be
 * reached and poked at, rather than debug overlays drawn on top of it.
 *
 * Anything in here makes a run unrepresentative, so a run that used one is
 * marked ledger-ineligible exactly like the `?level=` debug jump: highscores,
 * Employee of the Month and the Records screen must never learn from it.
 */

const INFINITE_LIVES_KEY = "devend:infiniteLives";

/** Lives handed out when the flag is on. Not truly infinite: a real number
 *  keeps every existing lives comparison (perfect-level, continues) working. */
export const DEV_LIVES = 999;

let infiniteLives: boolean | null = null;

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false; // storage blocked (private mode, embedded webview)
  }
}

export function isInfiniteLivesEnabled(): boolean {
  if (infiniteLives === null) infiniteLives = readFlag(INFINITE_LIVES_KEY);
  return infiniteLives;
}

export function setInfiniteLivesEnabled(on: boolean): void {
  infiniteLives = on;
  try {
    if (on) localStorage.setItem(INFINITE_LIVES_KEY, "1");
    else localStorage.removeItem(INFINITE_LIVES_KEY);
  } catch {
    /* storage blocked: the in-memory flag still holds for this session */
  }
}

/**
 * The lives a run starts with, before certificate/loadout bonuses are added.
 * Reads the flag at call time (not at import) so toggling it in the Admin
 * panel takes effect on the very next run without a reload.
 */
export function baseStartingLives(normal: number): number {
  return isInfiniteLivesEnabled() ? DEV_LIVES : normal;
}

/**
 * Ascension depth requested by `?ascension=N`, or 0 for a normal run.
 *
 * Reaching depth N legitimately means clearing the whole map list N times, so
 * without this the later ladder rungs are effectively untestable. The jump
 * lands you at depth N with NO drafted loadouts, which is deliberate: an
 * ascension normally arrives carrying every curse and blessing drafted on the
 * way up, and those would muddle what a rung on its own actually does.
 *
 * Ledger-ineligible like every other flag in this file.
 */
export const MAX_DEBUG_ASCENSION = 50;

/** Pure parse, so the clamping is testable without a URL. */
export function parseAscensionParam(search: string): number {
  const raw = new URLSearchParams(search).get('ascension');
  if (raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DEBUG_ASCENSION, n);
}

/** The requested depth from the live URL. 0 when absent or malformed. */
export function debugAscensionDepth(): number {
  try {
    return parseAscensionParam(window.location.search);
  } catch {
    return 0; // no window (SSR / test env without a location)
  }
}

/** Test seam: drop the memoised values so a test can flip the flag. */
export function resetDevFlagCache(): void {
  infiniteLives = null;
}
