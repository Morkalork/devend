/**
 * analytics — thin PostHog wrapper for player-pattern telemetry.
 *
 * Design rules:
 * - Never throws and never blocks gameplay: every call is a silent no-op until
 *   initAnalytics() has run with a configured key, and capture errors are
 *   swallowed. Events fire from session handlers only, never from the
 *   render/physics hot paths.
 * - Anonymous by default: no autocapture, no pageviews, no session recording,
 *   no person profiles. Just the typed game events below.
 * - Daily Stand-up (seeded) runs are TAGGED via the `daily` property rather
 *   than dropped, so dashboards can filter them either way.
 *
 * Setup: set VITE_POSTHOG_KEY at build time (.env.local locally, a config var
 * on Heroku; Android builds bake it in at `npm run build`). Optionally
 * VITE_POSTHOG_HOST (defaults to the EU cloud). Dev builds stay silent even
 * with a key unless VITE_POSTHOG_DEV=1, so local play never pollutes the data.
 */
import posthog from 'posthog-js';

let enabled = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const devOptIn = import.meta.env.VITE_POSTHOG_DEV === '1';
  if (!key || (import.meta.env.DEV && !devOptIn)) return;
  try {
    posthog.init(key, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      person_profiles: 'identified_only', // anonymous events only, no profiles
      // Error tracking: uncaught exceptions/rejections surface in PostHog as
      // $exception events (crash visibility in the wild, e.g. renderer rollout).
      capture_exceptions: true,
    });
    enabled = true;
  } catch {
    // Analytics must never break the game.
  }
}

function track(event: string, props?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    posthog.capture(event, props);
  } catch {
    // ignore — see header
  }
}

/**
 * The event schema. Keep every event here (not inline posthog.capture calls)
 * so the property names stay consistent across call sites and dashboards.
 */
export const analytics = {
  /** A run began. `daily` = Daily Stand-up seeded run. */
  runStarted: (p: { mode: 'new' | 'daily' | 'resume' | 'playAgain'; daily: boolean }) =>
    track('run_started', p),

  /** A map was cleared. `perfect` = no lives lost on the map. */
  levelCompleted: (p: {
    level: number;
    overtime: number;
    perfect: boolean;
    ascensionDepth: number;
    daily: boolean;
  }) => track('level_completed', p),

  /** Ran out of lives on a map (before the Continue decision, if any). */
  levelFailed: (p: { level: number; continuesLeft: number; daily: boolean }) =>
    track('level_failed', p),

  /** Spent a Continue to retry the level. */
  continueSpent: (p: { level: number }) => track('continue_spent', p),

  /** Bought an upgrade in the shop. `level` = the map just completed. */
  upgradePurchased: (p: { upgradeId: string; price: number; level: number }) =>
    track('upgrade_purchased', p),

  /** Picked the run's Promotion capstone. */
  capstoneSelected: (p: { capstoneId: string }) => track('capstone_selected', p),

  /** The run is over (win or final death). */
  runEnded: (p: {
    isWin: boolean;
    levelsCompleted: number;
    totalScore: number;
    ascensionDepth: number;
    daily: boolean;
  }) => track('run_ended', p),

  /** Player picked a contract assignment from the 1-of-3 draft. */
  doorSelected: (p: { doorId: string; level: number }) =>
    track('door_selected', p),

  /** Player picked (or skipped) a loadout at the run-start draft. */
  loadoutSelected: (p: { loadoutId: string | null }) =>
    track('loadout_selected', p),

  /** Player chose to ascend after beating the final level. */
  ascensionStarted: (p: { depth: number; loadoutId: string }) =>
    track('ascension_started', p),
};
