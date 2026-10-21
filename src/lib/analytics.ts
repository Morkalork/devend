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
type PostHog = typeof import('posthog-js').default;

/**
 * The client, once loaded. posthog-js is fetched only when a key is set: it
 * was imported at the top of this file, so every build shipped it in the main
 * bundle, the keyless ones included. Events raised before it arrives (the
 * first moments after boot, before any run has started) are dropped.
 */
let client: PostHog | null = null;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const devOptIn = import.meta.env.VITE_POSTHOG_DEV === '1';
  if (!key || (import.meta.env.DEV && !devOptIn)) return;
  import('posthog-js').then(({ default: posthog }) => start(posthog, key)).catch(() => {
    // Offline, or blocked: analytics must never break the game.
  });
}

function start(posthog: PostHog, key: string): void {
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
    client = posthog;
  } catch {
    // Analytics must never break the game.
  }
}

function track(event: string, props?: Record<string, unknown>): void {
  if (!client) return;
  try {
    client.capture(event, props);
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
    daily: boolean;
  }) => track('run_ended', p),

  /** Player took (or skipped) a Sprint Planning offer at the run start. */
  offerSelected: (p: { offerId: string | null; pool: string | null; grantedIds: string[] }) =>
    track('offer_selected', p),
};
