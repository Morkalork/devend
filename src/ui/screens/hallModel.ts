/**
 * What the Performance Review screen shows, split from the drawing so it can
 * be tested without a canvas (canvas port of components/game/HallOfFameScreen).
 */
import type { TFunction } from "i18next";
import type { RunLedgerEntry } from "@/types/hallOfFame";
import type { MetaProgressionStats } from "@/types/metaProgression";
import type { UpgradeTag } from "@/types/upgrade";

/** Rank medal colours: gold, silver, bronze, then muted. */
export const RANK_COLORS = [0xffd54a, 0xc0c8d4, 0xd0925a];

/** A run's build identity: "Lock + Risk", "Lock", or the Generalist fallback. */
export function buildName(t: TFunction, run: Pick<RunLedgerEntry, "primaryTag" | "secondaryTag">): string {
  const tagLabel = (tag: UpgradeTag) => t(`upgradeShop.tags.${tag}`);
  return run.primaryTag
    ? run.secondaryTag
      ? t("buildRecap.comboName", { a: tagLabel(run.primaryTag), b: tagLabel(run.secondaryTag) })
      : tagLabel(run.primaryTag)
    : t("buildRecap.generalist");
}

/** A ladder score: banked hours as "612h". */
export const hoursText = (score: number) => `${score}h`;

export const fmtDate = (ts: number, lang: string) =>
  new Date(ts).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" });

/** Employee-of-the-Month plaques, newest month first ("YYYY-MM" keys sort lexicographically). */
export const sortPlaques = (monthlyBests: Record<string, RunLedgerEntry>) =>
  Object.entries(monthlyBests).sort(([a], [b]) => b.localeCompare(a));

/** The month label is localized from the key. */
export function monthLabel(key: string, lang: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(lang, { year: "numeric", month: "long" });
}

/** Daily Stand-up: the most recent banked days, newest first. */
export const recentDailies = (dailyBests: Record<string, RunLedgerEntry>) =>
  Object.entries(dailyBests).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);

export const dayLabel = (key: string, lang: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString(lang, { month: "short", day: "numeric", timeZone: "UTC" });

/** The lifetime flavour stats, in display order, keyed by their i18n suffix. */
export const lifetimeStats = (m: MetaProgressionStats) => ([
  ["highestLevel", m.highestLevelReached],
  ["fencesDrawn", m.totalFencesDrawn],
  ["perfectMaps", m.totalLevelsCompletedWithoutLoss],
  ["livesLost", m.totalLivesLost],
] as const);

/** Whether the Daily Stand-up section has anything to say. */
export const showDaily = (dailies: unknown[], streak: number) => dailies.length > 0 || streak > 0;

/** Split a list into rows of `cols`, for the DOM's CSS grids. */
export function gridRows<T>(items: T[], cols: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return rows;
}

/** Tailwind's `sm:` breakpoint, for the grids that gain a column on a wider screen. */
export const SM_BREAKPOINT = 640;

/** CSS `capitalize`: the first letter of every word upper-cased (Swedish and Spanish month names are lower case). */
export const capitalizeWords = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());
