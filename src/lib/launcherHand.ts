/**
 * The launcher hand: the draw-hint hand (InteractiveTutorialOverlay) played
 * over the plunger the first time a RUN meets a launcher, pulling the band
 * back down the barrel and letting go.
 *
 * Per run, not once per install like the other one-time explainers: the
 * launcher's modal (game.launcherIntro) already says what the barrel is, once
 * ever, and still a player who had read it stood on level 11 not knowing what
 * to touch. A gesture is learnt by watching it, and a run is long enough to
 * forget one, so every New Game shows the hand again on its first launcher
 * map and nowhere after.
 *
 * The flag is the SEED of the run it was shown in: a new game deals a new
 * seed, so it compares unequal and the hand comes back; a reload mid-run
 * keeps the seed, so a map resumed after the hand was waved does not wave it
 * again. One key, overwritten, rather than one per run.
 *
 * Admin can hold it on for every launcher map (devFlags.launcherHandAlways),
 * because "did it fire" and "does it work" look the same from the outside.
 */
import { getRunSeedText } from "@/lib/runRng";
import { isLauncherHandAlwaysEnabled } from "@/lib/devFlags";

export const LAUNCHER_HAND_KEY = "devend:launcherHandRun";

/** The seed of the run with no seed text: a bare board in a test or the builder. */
const NO_RUN = "-";

let memory: string | null = null;

function runKey(): string {
  return getRunSeedText() ?? NO_RUN;
}

/** True when this run has already had the hand. */
export function launcherHandSeen(): boolean {
  if (isLauncherHandAlwaysEnabled()) {
    return false;
  }
  const run = runKey();
  if (memory === run) {
    return true;
  }
  try {
    return localStorage.getItem(LAUNCHER_HAND_KEY) === run;
  } catch {
    return false;
  }
}

/** This run has had its hand: the player pulled, or the barrel fired. */
export function markLauncherHandSeen(): void {
  const run = runKey();
  memory = run;
  try {
    localStorage.setItem(LAUNCHER_HAND_KEY, run);
  } catch {
    /* private mode: the in-memory flag holds for this session */
  }
}

/** "Re-enable All Tutorials": the current run gets the hand again. */
export function resetLauncherHandSeen(): void {
  memory = null;
  try {
    localStorage.removeItem(LAUNCHER_HAND_KEY);
  } catch {
    /* ignore */
  }
}
