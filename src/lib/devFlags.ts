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

/** Test seam: drop the memoised values so a test can flip the flag. */
export function resetDevFlagCache(): void {
  infiniteLives = null;
}
