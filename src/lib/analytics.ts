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
  if (!key || (import.meta.env.DEV && !devOptIn)) {
    return;
  }
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
    // No location, on every event (exceptions included). "Discard client IP
    // data" in the PostHog project drops the IP, but its GeoIP step still
    // reads it first and stores a city and country, which Play counts as
    // collecting approximate location. $geoip_disable tells ingestion to skip
    // that step, so the Data safety answer "location: not collected" holds
    // whatever the project's settings say (PLAY_RELEASE_PLAN.md, section 4).
    posthog.register({ $geoip_disable: true });
    client = posthog;
  } catch {
    // Analytics must never break the game.
  }
}

/** One event as this session raised it, for Admin's "Events this session" list. */
export interface SentEvent {
  /** Date.now() when it was raised. */
  at: number;
  event: string;
  props: Record<string, unknown>;
  /** Did it go to PostHog? False without a key, before the client loads, or while muted. */
  sent: boolean;
}

/** How many of this session's events Admin keeps. */
export const SESSION_LOG_MAX = 60;

const sessionLog: SentEvent[] = [];
const listeners = new Set<() => void>();

/**
 * Admin's own play (the Playground, the device check) mutes analytics, so a
 * tester's runs on staging do not count as players'. Events are still logged
 * locally, marked unsent, so Admin can see what WOULD have gone.
 */
let muted = false;

export function setAnalyticsMuted(next: boolean): void {
  muted = next;
}

export function isAnalyticsMuted(): boolean {
  return muted;
}

/** This session's events, oldest first. */
export function getSessionEvents(): readonly SentEvent[] {
  return sessionLog;
}

/** Forget this session's list (Admin's Clear; tests). */
export function clearSessionEvents(): void {
  sessionLog.length = 0;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A listener must not stop the clear.
    }
  }
}

/** Called whenever an event is raised; returns the unsubscribe. */
export function subscribeSessionEvents(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * What the game layer cannot see but its events should carry: is the current
 * run a Daily Stand-up. Set by the session when a run starts.
 */
const runContext = { daily: false, level: 0 };

export function setAnalyticsRun(p: { daily: boolean }): void {
  runContext.daily = p.daily;
}

/** The map being played (1-based), for events raised where the level is not known. */
export function setAnalyticsLevel(level: number): void {
  runContext.level = level;
}

/** Is a PostHog client live (a key was set and the library loaded)? */
export function isAnalyticsLive(): boolean {
  return client !== null;
}

function track(event: string, props?: Record<string, unknown>): void {
  const willSend = client !== null && !muted;
  sessionLog.push({ at: Date.now(), event, props: { ...(props ?? {}) }, sent: willSend });
  if (sessionLog.length > SESSION_LOG_MAX) {
    sessionLog.splice(0, sessionLog.length - SESSION_LOG_MAX);
  }
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A listener must not stop the event.
    }
  }
  if (!willSend || !client) {
    return;
  }
  try {
    client.capture(event, props);
  } catch {
    // ignore - see header
  }
}

/**
 * The event schema. Keep every event here (not inline posthog.capture calls)
 * so the property names stay consistent across call sites and dashboards.
 */
export const analytics = {
  /** A run began. `daily` = Daily Stand-up seeded run. */
  runStarted: (p: { mode: 'new' | 'daily' | 'resume' | 'playAgain' | 'restart'; daily: boolean }) =>
    track('run_started', p),

  /**
   * A map was cleared. `perfect` = no lives lost on the map. `seconds` is
   * active play (pauses and shops excluded), `fences` the fences drawn,
   * `mutator` the map's mutator id or null.
   */
  levelCompleted: (p: {
    level: number;
    overtime: number;
    perfect: boolean;
    daily: boolean;
    seconds: number | null;
    livesLost: number;
    fences: number;
    mutator: string | null;
  }) => track('level_completed', p),

  /**
   * A life was lost, with why (MapFailKind: timeUp, ballHitFence, bossOutside,
   * ...). Fires on every life, the last one included, so it is the map
   * difficulty signal; level_failed only marks the run's end.
   */
  lifeLost: (p: {
    level: number;
    reason: string;
    seconds: number;
    livesLeft: number;
    mutator: string | null;
  }) => track('life_lost', { ...p, daily: runContext.daily }),

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

  /**
   * The run is over. `reason`: won, outOfLives, or restarted (the player
   * abandoned it for a fresh one). `minutes` since it started or was resumed
   * on this launch. `offerId`/`offerPool` = the Sprint Planning card taken.
   */
  runEnded: (p: {
    isWin: boolean;
    levelsCompleted: number;
    totalScore: number;
    daily: boolean;
    reason: 'won' | 'outOfLives' | 'restarted';
    minutes: number | null;
    offerId: string | null;
    offerPool: string | null;
  }) => track('run_ended', p),

  /** The Certificate store was opened (from the menu). */
  certStoreOpened: () => track('cert_store_opened', {}),

  /** A certificate level was bought with Certificate Hours. */
  certBought: (p: { certId: string; level: number }) => track('cert_bought', p),

  /**
   * An ability was used: a charge spent from the ability bar, or a Feature
   * Freeze tap (`featureFreeze` from the upgrade's per-map uses, `freezeCharge`
   * from a banked charge). `level` defaults to the map being played.
   */
  abilityUsed: (p: { abilityId: string; level?: number }) =>
    track('ability_used', { abilityId: p.abilityId, level: p.level ?? runContext.level }),

  /**
   * A non-standard fence type was finished on a map. Once per type per map,
   * so the count reads as "maps it was used on", not fences.
   */
  fenceTypeUsed: (p: { fenceTypeId: string; level: number }) => track('fence_type_used', p),

  /** The player went past the store after a map ("next map" instead of "open store"). */
  shopSkipped: (p: { level: number; overtimeBanked: number }) => track('shop_skipped', p),

  /**
   * A Pair Programming attempt or session. A session that connected is
   * reported when it ends (`connected` true, `maps` = maps started together);
   * a pairing that never connected is reported when it fails (`connected`
   * false, `problem` = the lobby's reason, cut to 80 characters). `method`:
   * nearby (Android radios) or link (QR / link, WebRTC with the relay behind it).
   */
  pairSession: (p: {
    method: 'nearby' | 'link' | null;
    role: 'host' | 'guest' | null;
    transport: string | null;
    connected: boolean;
    maps: number;
    problem?: string;
  }) => track('pair_session', p),

  /** A screen was shown (menus and between-map screens; the board is 'game'). */
  screenViewed: (p: { screen: string }) => track('screen_viewed', p),

  /** An option was changed. `value` is the new value, as a string. */
  settingChanged: (p: { setting: string; value: string }) => track('setting_changed', p),

  /**
   * The 3D board lowered its quality on a slow phone (`to`: a tier, 'res' for
   * resolution only, or '2d'), or could not start at all (from '3d', reason
   * 'startFailed').
   */
  qualityDropped: (p: { from: string; to: string; fps: number | null; reason: 'slowFrames' | 'startFailed' }) =>
    track('quality_dropped', p),

  /** Player took (or skipped) a Sprint Planning offer at the run start. */
  offerSelected: (p: { offerId: string | null; pool: string | null; grantedIds: string[] }) =>
    track('offer_selected', p),
};
