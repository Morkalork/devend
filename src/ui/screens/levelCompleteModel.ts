/**
 * What the post-map overlay shows, worked out once from the scorer's numbers
 * (canvas port of components/game/LevelCompleteOverlay.tsx: the arithmetic and
 * its reasoning moved here, the drawing lives in LevelCompleteOverlay.tsx).
 *
 * Every number on that screen either comes straight from the scorer or is a
 * difference of two numbers that do, because each time the overlay recomputed
 * part of the payout for itself it drifted from what was actually paid.
 */
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import {
  Trophy, Sparkles, TrendingUp, Target, Lock, Clock, Zap, Medal, Hammer, Timer, Gift, CodeXml,
} from "lucide-react";
import type { LevelScoreData } from "@/types/game";
import { isFlawlessRun } from "@/lib/scoreAxes";
import { COLOR } from "../theme";

/** The Tailwind palette entries this screen used, as numbers. */
export const TW = {
  cyan400: 0x22d3ee,
  cyan300: 0x67e8f9,
  teal400: 0x2dd4bf,
  amber400: 0xfbbf24,
  fuchsia300: 0xf0abfc,
  fuchsia400: 0xe879f9,
  violet400: 0xa78bfa,
  orange400: 0xfb923c,
  emerald400: 0x34d399,
  yellow400: 0xfacc15,
  yellow500: 0xeab308,
  /** The gold of FLAWLESS, a new highscore and a personal best. */
  gold: 0xffd54a,
  /** The second player's colour. */
  peer: 0xffb347,
} as const;

/** `text-success` is the same hsl as the primary in this theme. */
export const SUCCESS = COLOR.primary;

// Press-and-hold info cards: each stat row explains its mechanic and how to
// earn more from it (keys under levelComplete.info.<key> in the locales).
export const STAT_INFO: Record<string, { icon: LucideIcon; color: number }> = {
  level: { icon: Trophy, color: SUCCESS },
  remaining: { icon: Target, color: COLOR.foreground },
  fencesUsed: { icon: Target, color: COLOR.foreground },
  spaceBonus: { icon: Sparkles, color: COLOR.primary },
  baseOvertime: { icon: Clock, color: COLOR.foreground },
  threadLocks: { icon: Lock, color: TW.cyan400 },
  superiorLocks: { icon: Medal, color: TW.cyan300 },
  zoneLocks: { icon: CodeXml, color: TW.fuchsia300 },
  breakBonus: { icon: Hammer, color: TW.amber400 },
  shipEarly: { icon: Timer, color: TW.teal400 },
  winBonus: { icon: Trophy, color: TW.violet400 },
  pushBonus: { icon: Zap, color: TW.orange400 },
  pickupBonus: { icon: Gift, color: TW.fuchsia400 },
  capBonus: { icon: Clock, color: COLOR.primary },
  qualifiedOvertime: { icon: Lock, color: TW.emerald400 },
  newHighscore: { icon: TrendingUp, color: TW.yellow400 },
  totalBonus: { icon: Sparkles, color: SUCCESS },
  overtimeEarned: { icon: Clock, color: COLOR.primary },
  // The DOM said text-accent-foreground, which is near-black in this theme and
  // vanished on the card (the row itself was moved off it for the same reason).
  totalOvertime: { icon: Clock, color: COLOR.primary },
  // The Performance Review lanes. Holding a bar explains what that lane
  // pays for and, more usefully, what it costs you on the others.
  axis_delivery: { icon: Lock, color: TW.cyan400 },
  axis_craft: { icon: Medal, color: TW.cyan300 },
  axis_tempo: { icon: Timer, color: TW.teal400 },
  axis_thrift: { icon: Target, color: SUCCESS },
  axis_greed: { icon: Sparkles, color: COLOR.primary },
  axis_engagement: { icon: Hammer, color: TW.amber400 },
};

/** The info card a held row opens, or null when that row has none. */
export function statInfoFor(key: string | null): { icon: LucideIcon; color: number } | null {
  return key && STAT_INFO[key] ? STAT_INFO[key] : null;
}

export interface OnTopRow { key: string; label: string; hours: number; color: number }

export interface LevelCompleteModel {
  /** "Won by: <reason>" and the optional "(space target also met)"; null without a reason. */
  winReason: { label: string; reason: string; also: string | null } | null;
  /** The push-failed warning, or null. */
  pushFailedText: string | null;
  /** The bonus subtotal on the collapsed breakdown header ("+20h"), or null when nothing was earned. */
  subtotalText: string | null;
  totalBonus: number;
  /** Remaining is meaningless on an all-balls-locked auto-win (the board drains to 0%). */
  showRemaining: boolean;
  flawless: boolean;
  fencesText: string;
  underPar: { text: string; bonusText: string } | null;
  overPar: { text: string; multiplierText: string } | null;
  /** The space optimisation section, shown when extra space was removed. */
  space: { extraText: string; disabled: boolean; valueText: string } | null;
  paidBase: number;
  isOverPar: boolean;
  /** "1/2": zones sealed out of the map's zones, or null when none were taken. */
  zonesSealedText: string | null;
  zonesMissedCost: number;
  earnedTotal: number;
  availableTotal: number;
  /** The Score row's two halves: "56" and "/ 100h". */
  scoreEarnedText: string;
  scoreAvailableText: string;
  onTopRows: OnTopRow[];
  onTopTotal: number;
  capRaise: number;
  clipped: number;
  overtimeCeiling: number;
  overtimeIsFull: boolean;
  /** "/ 100" after the Overtime Earned count-up, or null when the map paid in full. */
  overtimeSuffix: string | null;
}

export function levelCompleteModel(scoreData: LevelScoreData, t: TFunction): LevelCompleteModel {
  const {
    cutCount,
    expectedCuts,
    basePoints,
    levelScore,
    pushFailed = false,
    underParBonus = 0,
    spaceBonus = 0,
    spaceBonusRaw = 0,
    zoneShareWithheld = 0,
    multipliedBase,
    mapCeiling,
    performanceMultiplier = 1,
    fencesUnderPar = 0,
    fencesOverPar = 0,
    extraPercent = 0,
    axes,
    winBonus = 0,
    winBonusPercent = 0,
    lockBonus = 0,
    lockedBallsCount = 0,
    superiorLockCount = 0,
    zoneLockCount = 0,
    zoneCount = 0,
    bouncerOvertime = 0,
    capBonus = 0,
    qualifiedOvertime = 0,
    pushBonus = 0,
    breakBonus = 0,
    shipEarlyBonus = 0,
    pickupBonus = 0,
    beatHighscore = false,
    highscoreBonus = 0,
    wonByAllLocked = false,
    winReason,
    alsoClearedSpace = false,
  } = scoreData;

  const isOverPar = fencesOverPar > 0;
  const isSpaceDisabled = fencesOverPar >= 3;
  const hasPushBonus = pushBonus > 0;

  /**
   * FLAWLESS: every ball on the map locked, and every one of those locks tight.
   *
   * Defined on COUNTS rather than on the Craft ratio, because that ratio can be
   * pushed past 1 by zone and simultaneous multipliers - so a run with one
   * sloppy lock in a const area could reach a full axis and would have claimed
   * this without being flawless at all. The counts cannot lie: n balls, n
   * locks, n of them superior.
   *
   * Deliberately not "max every axis". The tactical axes fight each other by
   * construction and about two are reachable per run, so an all-five badge
   * would be unwinnable.
   */
  const flawless = isFlawlessRun(lockedBallsCount, superiorLockCount, axes?.ratios.delivery ?? 0);

  // The base the SCORER used, not a recomputation of it. Deriving it as
  // basePoints x performanceMultiplier dropped the build's score multiplier,
  // so a 1.25x run showed a base whose visible parts did not sum to the total.
  const paidBase = Math.round(multipliedBase ?? Math.floor(basePoints * performanceMultiplier));
  // Hours the map withheld because its colored areas were left alone.
  const zonesMissedCost = Math.max(0, Math.round(zoneShareWithheld));
  // "Score: x / y". Both ends come from the scorer: y is the base plus every
  // lane's own ceiling, so the fraction adds up to the rows above it.
  const earnedTotal = Math.max(0, Math.round(paidBase + (axes?.total ?? 0) - zonesMissedCost));
  const availableTotal = Math.max(earnedTotal, Math.round(mapCeiling ?? 0));

  /**
   * Hours paid OUTSIDE the map's own lanes, each with a row of its own below
   * the Score line (#79: "it says I got 146 score, but I get 137 overtime").
   * They sit below the Score they are paid on top of, and levelCompleteAddsUp
   * pins the identity: Score + these = Overtime Earned. The backstop can still
   * clip the sum on an enormous map, which is what `clipped` reports.
   */
  const onTopRows: OnTopRow[] = [
    { key: "winBonus", label: t("levelComplete.winBonus", { percent: Math.round(winBonusPercent) }), hours: winBonus, color: TW.violet400 },
    { key: "newHighscore", label: t("levelComplete.newHighscore"), hours: beatHighscore ? highscoreBonus : 0, color: TW.gold },
    { key: "bouncerHours", label: t("levelComplete.bouncerHours"), hours: bouncerOvertime, color: COLOR.primary },
    { key: "pickupBonus", label: t("levelComplete.pickupHours"), hours: pickupBonus, color: TW.fuchsia400 },
    { key: "qualifiedOvertime", label: t("levelComplete.qualifiedOvertime"), hours: qualifiedOvertime, color: TW.emerald400 },
  ].filter(r => r.hours > 0);
  const onTopTotal = onTopRows.reduce((sum, r) => sum + r.hours, 0);
  // Comp Time / Stock Options is NOT income and deliberately not in the sum
  // above: it raises this map's ceiling, so its row is phrased as a ceiling change.
  const capRaise = Math.max(0, Math.round(capBonus));
  // What the backstop took off the top, if anything. Never negative: the
  // qualified channel is added after the clamp.
  const clipped = Math.max(0, earnedTotal + onTopTotal - levelScore);

  // "Overtime x / y" on the always-visible row: the Score row lives inside the
  // collapsed breakdown, and the headline alone cannot say whether 84h was the
  // whole map or a third of it. Same denominator as that row on purpose: two
  // fractions on one screen that disagree is worse than one that is hidden.
  const overtimeCeiling = Math.round(mapCeiling ?? 0);
  // Drop the fraction when the map paid everything it had (>= also covers a
  // win premium paying ABOVE the ceiling, and a missing mapCeiling). Compared
  // against the final score, not the animating one, so it does not blink.
  const overtimeIsFull = levelScore >= overtimeCeiling;

  // The axes ARE the bonus. Push-your-luck hours bank into Greed, the map's
  // features into Engagement and the lock stack into Delivery + Craft, so
  // summing the itemised rows would count each of them twice.
  const totalBonus = (axes
    ? axes.total
    : underParBonus + spaceBonus + lockBonus + pushBonus + breakBonus + shipEarlyBonus)
    + winBonus;

  return {
    winReason: winReason
      ? {
        label: t("levelComplete.winReason.label"),
        reason: t(`levelComplete.winReason.${winReason}`),
        also: alsoClearedSpace ? `(${t("levelComplete.winReason.alsoCleared")})` : null,
      }
      : null,
    pushFailedText: pushFailed
      ? t("levelComplete.pushFailed") + (hasPushBonus ? t("levelComplete.pushFailedBonus", { bonus: pushBonus }) : t("levelComplete.pushFailedNoBonus"))
      : null,
    subtotalText: totalBonus > 0 ? `+${totalBonus}h` : null,
    totalBonus,
    showRemaining: !wonByAllLocked,
    flawless,
    fencesText: `${cutCount} / ${expectedCuts}`,
    underPar: fencesUnderPar > 0
      ? { text: t("levelComplete.underPar", { count: fencesUnderPar }), bonusText: `+${underParBonus}h` }
      : null,
    overPar: fencesOverPar > 0
      ? {
        text: t("levelComplete.overPar", { count: fencesOverPar }),
        multiplierText: t("levelComplete.baseMultiplier", { multiplier: performanceMultiplier })
          + (isSpaceDisabled ? t("levelComplete.noSpaceBonus") : ""),
      }
      : null,
    space: extraPercent > 0
      ? {
        extraText: `+${(extraPercent * 100).toFixed(0)}%`,
        disabled: isSpaceDisabled,
        valueText: isSpaceDisabled ? `${spaceBonusRaw}h` : spaceBonus > 0 ? `+${spaceBonus}h` : "-",
      }
      : null,
    paidBase,
    isOverPar,
    zonesSealedText: zoneCount > 0 && zoneLockCount > 0 ? `${Math.min(zoneLockCount, zoneCount)}/${zoneCount}` : null,
    zonesMissedCost,
    earnedTotal,
    availableTotal,
    scoreEarnedText: String(earnedTotal),
    scoreAvailableText: `/ ${availableTotal}h`,
    onTopRows,
    onTopTotal,
    capRaise,
    clipped,
    overtimeCeiling,
    overtimeIsFull,
    overtimeSuffix: overtimeIsFull ? null : `/ ${overtimeCeiling}`,
  };
}

/** The count-up's timing: it waits for the card to land, then eases in. */
export const COUNT_UP_DELAY_MS = 380;
export const COUNT_UP_DURATION_MS = 900;

/** The counted-up value `elapsedMs` after mount (cubic ease-out, as the DOM's rAF loop). */
export function countUpAt(target: number, elapsedMs: number): number {
  if (elapsedMs < COUNT_UP_DELAY_MS) return 0;
  const progress = Math.min(1, (elapsedMs - COUNT_UP_DELAY_MS) / COUNT_UP_DURATION_MS);
  const ease = 1 - (1 - progress) * (1 - progress) * (1 - progress);
  return Math.round(target * ease);
}
