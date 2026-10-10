/**
 * What the main menu shows, as data (canvas port of WelcomeScreen). The DOM
 * component decided each button's presence, label, disabled state and
 * highlight inline in its markup; here those rules are one pure function so
 * they can be tested without rendering a canvas.
 */
import type { MenuHighlightFlags, MenuHighlightKey } from "@/hooks/useMenuHighlights";

export type WelcomeButtonId =
  | "continue" | "newGame" | "daily" | "twoPlayer" | "tutorial" | "options"
  | "certificates" | "loadouts" | "records" | "achievements" | "jukebox" | "admin";

/** A translation key and its values. */
export interface TextRef {
  key: string;
  vars?: Record<string, string | number>;
}

export interface WelcomeButtonSpec {
  id: WelcomeButtonId;
  /** Absent while `loading` (the button shows the spinner and "Loading" instead). */
  label?: TextRef;
  /** A second line under the label (the saved run's ascension depth). */
  sub?: TextRef;
  /** Shows the spinner and `welcome.loading` in place of the label. */
  loading: boolean;
  disabled: boolean;
  /** Gold ring (the first-time highlight). */
  ring: boolean;
  /** The sparkle NEW badge next to the label. */
  badge: boolean;
  /** Primary glow (box-shadow in the DOM). */
  glow: boolean;
  /** The glow breathes (`animate-pulse-glow`). */
  pulse: boolean;
  /** A light band sweeps across it: the recommended action. */
  shimmer: boolean;
  /** Shown but locked: half opacity, grey (certificates before they unlock). */
  locked: boolean;
  /** The pill after the label. */
  chip?: { kind: "streak" | "hours" | "count"; value: number };
  /** The green check (today's stand-up is banked). */
  check: boolean;
  variant: "primary" | "secondary";
  /** Which first-time highlight a tap on this button acknowledges. */
  highlightKey?: MenuHighlightKey;
}

/** The props of WelcomeScreen that decide what the menu shows. */
export interface WelcomeMenuInput {
  hasContinue: boolean;
  savedRunAscension?: number;
  hasDaily: boolean;
  hasTwoPlayer: boolean;
  pairPartnerName?: string;
  dailyStreak?: number;
  dailyDoneToday?: boolean;
  hasCertificateStore: boolean;
  hasLoadouts: boolean;
  hasHallOfFame: boolean;
  hasAchievements: boolean;
  hasJukebox: boolean;
  hasAdmin: boolean;
  isLoading?: boolean;
  totalCertificateHours?: number;
  completedAchievementCount?: number;
  highlights?: Partial<MenuHighlightFlags>;
}

const base = (id: WelcomeButtonId, isLoading: boolean): WelcomeButtonSpec => ({
  id, loading: false, disabled: isLoading, ring: false, badge: false, glow: false,
  pulse: false, shimmer: false, locked: false, check: false, variant: "primary",
});

/** The menu's buttons, top to bottom. */
export function welcomeButtons(p: WelcomeMenuInput): WelcomeButtonSpec[] {
  const loading = !!p.isLoading;
  const hl = p.highlights ?? {};
  const out: WelcomeButtonSpec[] = [];

  // Continue only appears when a saved run exists; it shimmers to mark it as
  // the recommended action. New Game is always a normal button.
  if (p.hasContinue) {
    const depth = p.savedRunAscension ?? 0;
    out.push({
      ...base("continue", loading),
      loading,
      label: loading ? undefined : { key: "welcome.continueGame" },
      sub: !loading && depth > 0 ? { key: "ascension.ladderTitle", vars: { depth } } : undefined,
      glow: true,
      shimmer: true,
    });
  }

  // Without a save, Start Game is the one thing to press, so it glows; a
  // highlight ring replaces the glow while it is new.
  out.push({
    ...base("newGame", loading),
    loading,
    label: loading ? undefined : { key: p.hasContinue ? "welcome.newGame" : "welcome.startGame" },
    ring: !!hl.newGame,
    badge: !loading && !!hl.newGame,
    glow: !p.hasContinue && !hl.newGame,
    pulse: !p.hasContinue && !hl.newGame,
    highlightKey: "newGame",
  });

  // Daily Stand-up: today's seeded run, same for every player. The flame chip
  // is the attendance streak; the check = banked today.
  if (p.hasDaily) {
    const streak = p.dailyStreak ?? 0;
    out.push({
      ...base("daily", loading),
      label: { key: "welcome.dailyStandup" },
      ring: !!hl.daily,
      badge: !!hl.daily,
      chip: streak > 0 ? { kind: "streak", value: streak } : undefined,
      check: !!p.dailyDoneToday,
      highlightKey: "daily",
    });
  }

  // 2-Player: says whose run is waiting when this phone holds a pair save, so
  // the player knows what they are walking into before the codes come out.
  if (p.hasTwoPlayer) {
    out.push({
      ...base("twoPlayer", loading),
      label: p.pairPartnerName
        ? { key: "pair.resumeWith", vars: { name: p.pairPartnerName } }
        : { key: "pair.title" },
    });
  }

  out.push({ ...base("tutorial", loading), label: { key: "welcome.tutorial" } });
  out.push({ ...base("options", loading), label: { key: "welcome.options" } });

  // When certificates aren't unlocked yet the store callback is absent; instead
  // of a dead button it stays tappable and explains how to gain access.
  const hours = p.totalCertificateHours;
  out.push({
    ...base("certificates", loading),
    label: { key: "welcome.certificates" },
    locked: !p.hasCertificateStore,
    ring: !!hl.certificates,
    badge: !!hl.certificates,
    chip: hours !== undefined && hours > 0 ? { kind: "hours", value: hours } : undefined,
    highlightKey: "certificates",
  });

  if (p.hasLoadouts) out.push({ ...base("loadouts", loading), label: { key: "welcome.loadouts" } });

  if (p.hasHallOfFame) {
    out.push({
      ...base("records", loading),
      label: { key: "welcome.records" },
      ring: !!hl.records,
      badge: !!hl.records,
      highlightKey: "records",
    });
  }

  if (p.hasAchievements) {
    // Only wired once the feature is unlocked (clearing level 5), so its mere
    // presence means "ready"; just guard against the loading state.
    const enabled = !loading;
    const count = p.completedAchievementCount;
    out.push({
      ...base("achievements", loading),
      label: { key: "welcome.achievements" },
      disabled: !enabled,
      ring: !!hl.achievements && enabled,
      badge: !!hl.achievements && enabled,
      chip: count !== undefined && count > 0 ? { kind: "count", value: count } : undefined,
      highlightKey: "achievements",
    });
  }

  if (p.hasJukebox) out.push({ ...base("jukebox", loading), label: { key: "welcome.music" } });

  // Admin is never disabled, loading or not (the DOM button had no `disabled`).
  if (p.hasAdmin) {
    out.push({ ...base("admin", loading), label: { key: "welcome.admin" }, disabled: false, variant: "secondary" });
  }
  return out;
}

/** Tapping a highlighted button acknowledges its first-time highlight. */
export function highlightToAck(
  spec: Pick<WelcomeButtonSpec, "highlightKey">,
  highlights: Partial<MenuHighlightFlags> | undefined,
): MenuHighlightKey | null {
  const key = spec.highlightKey;
  return key && highlights?.[key] ? key : null;
}

/**
 * What a Daily Stand-up tap does: the first visit explains what it is before
 * the run starts; afterwards the button launches straight in.
 */
export function dailyTapAction(showDailyIntro: boolean): "intro" | "start" {
  return showDailyIntro ? "intro" : "start";
}

/** Certificates open the store once unlocked, the "how to unlock" card before. */
export function certificatesTapAction(hasStore: boolean): "store" | "lockedInfo" {
  return hasStore ? "store" : "lockedInfo";
}

/** Taps needed on the menu ball to unlock admin, and the gap that resets them. */
export const SECRET_TAPS = 10;
export const SECRET_GAP_MS = 1200;

/**
 * The secret admin unlock: 10 taps on the animated ball (deployed dev). Taps
 * must come in quick succession - a >1.2s gap resets the count, so it's
 * deliberate. `getUnlock` is read at tap time, so the latest callback is used;
 * with none, taps do nothing at all (not even count).
 */
export function createSecretTapCounter(getUnlock: () => (() => void) | undefined) {
  let taps = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    tap() {
      const unlock = getUnlock();
      if (!unlock) return;
      if (timer) clearTimeout(timer);
      timer = null;
      taps += 1;
      if (taps >= SECRET_TAPS) {
        taps = 0;
        unlock();
        return;
      }
      timer = setTimeout(() => { taps = 0; timer = null; }, SECRET_GAP_MS);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
