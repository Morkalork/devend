/**
 * What the end-of-run screen shows and which buttons it offers (canvas port of
 * components/game/ResultScreen.tsx; the drawing is in ResultScreen.tsx).
 */
import { contentText } from "@/i18n/content";
import type { TFunction } from "i18next";
import type { GameResult } from "@/types/game";
import type { RunRecap } from "@/lib/buildRecap";
import type { RunRankInfo } from "@/lib/runLedger";
import type { UpgradeTag } from "@/types/upgrade";

export type ResultRunRank = RunRankInfo & {
  aheadThroughMaps: number | null;
  monthBest?: boolean;
  /** Daily Stand-up: run beat today's daily best / current attendance streak. */
  dayBest?: boolean;
  dailyStreak?: number;
};

/**
 * Build name: "Freeze-Lock" from the archetype lean, or Generalist. The
 * flavour title ("Cryo Engineer") keys off the primary archetype alone.
 */
export function buildIdentity(runRecap: RunRecap | null, t: TFunction): { buildName: string; buildTitle: string; buildLine: string } {
  const tagLabel = (tag: UpgradeTag) => t(`upgradeShop.tags.${tag}`);
  const buildName = runRecap?.primary
    ? runRecap.secondary
      ? t("buildRecap.comboName", { a: tagLabel(runRecap.primary), b: tagLabel(runRecap.secondary) })
      : tagLabel(runRecap.primary)
    : t("buildRecap.generalist");
  const buildTitle = runRecap?.primary
    ? t(`buildRecap.titles.${runRecap.primary}`)
    : t("buildRecap.generalistTitle");
  return { buildName, buildTitle, buildLine: t("buildRecap.buildLine", { name: buildName, title: buildTitle }) };
}

export type PinnedKind = "continue" | "restart" | "playAgain";
export interface PinnedAction { kind: PinnedKind; variant: "primary" | "secondary"; text: string }

/**
 * PLAY AGAIN, always on screen: the run-continuation choice, and at most two
 * buttons of it. Continue-from-checkpoint and Restart-from-one stay together
 * because they are the same decision asked two ways, and splitting them across
 * the fold would hide the harder half. Empty when there is no way to play on,
 * in which case no bar is drawn at all.
 */
export function pinnedActions(
  opts: { checkpointLevel?: number; hasPlayAgain: boolean; hasRestart: boolean },
  t: TFunction,
): PinnedAction[] {
  const { checkpointLevel, hasPlayAgain, hasRestart } = opts;
  if (!hasPlayAgain && !hasRestart) return [];
  if (checkpointLevel && checkpointLevel > 1) {
    const out: PinnedAction[] = [];
    if (hasPlayAgain) out.push({ kind: "continue", variant: "primary", text: t("result.continueLevel", { level: checkpointLevel }) });
    if (hasRestart) out.push({ kind: "restart", variant: "secondary", text: t("result.restart") });
    return out;
  }
  return hasPlayAgain ? [{ kind: "playAgain", variant: "primary", text: t("result.playAgain") }] : [];
}

export type DetourKind = "records" | "share" | "mainMenu";

/**
 * The DETOURS. Reading the ladder, sharing the card and leaving for the menu
 * are all "instead of playing", so they sit at the end of the scrolling recap
 * and the pinned bar stays one decision deep.
 */
export function detourActions(opts: { hasRecords: boolean; totalScore?: number }): DetourKind[] {
  const out: DetourKind[] = [];
  if (opts.hasRecords) out.push("records");
  // Share the run as an image only when something was banked.
  if (opts.totalScore !== undefined && opts.totalScore > 0) out.push("share");
  out.push("mainMenu");
  return out;
}

export interface LadderBlock {
  bankedText: string;
  /** #1 all-time. */
  newBestText: string | null;
  rankText: string | null;
  gapToNextText: string | null;
  gapToTop10Text: string | null;
  /** Employee of the Month: the monthly crown, winnable when the Top 10 is out of reach. */
  monthBestText: string | null;
  dayBestText: string | null;
  streakText: string | null;
  epitaphText: string | null;
}

/**
 * Ladder placement (HIGHSCORES.md): the run's banked overtime and where it
 * landed on the all-time Top 10, with the near-miss gap as the next target.
 * Null when the run is not ranked or banked nothing.
 */
export function ladderBlock(result: GameResult, runRank: ResultRunRank | null, t: TFunction): LadderBlock | null {
  if (!runRank || result.totalScore === undefined || result.totalScore <= 0) return null;
  const ranked = runRank.rank !== null && runRank.rank > 1;
  return {
    bankedText: `${result.totalScore}h`,
    newBestText: runRank.rank === 1 ? t("result.newBestRun") : null,
    rankText: ranked ? t("result.rankAllTime", { rank: runRank.rank }) : null,
    gapToNextText: ranked && runRank.gapToNext !== null
      ? t("result.gapToNext", { hours: runRank.gapToNext, rank: (runRank.rank as number) - 1 })
      : null,
    gapToTop10Text: runRank.rank === null && runRank.gapToTop10 !== null
      ? t("result.gapToTop10", { hours: runRank.gapToTop10 })
      : null,
    monthBestText: runRank.monthBest && runRank.rank !== 1 ? t("result.employeeOfMonth") : null,
    dayBestText: runRank.dayBest ? t("result.dailyBest") : null,
    streakText: (runRank.dailyStreak ?? 0) > 0 ? t("result.dailyStreak", { count: runRank.dailyStreak }) : null,
    epitaphText: runRank.aheadThroughMaps !== null ? t("result.paceEpitaph", { count: runRank.aheadThroughMaps }) : null,
  };
}

export interface RecapBlock {
  buildLine: string;
  /** Tag chips, most-owned first, zero counts dropped. */
  chips: Array<{ tag: UpgradeTag; count: number }>;
  capstoneText: string | null;
}

/** Build recap: what this run WAS - the build's name and the capstone. */
export function recapBlock(runRecap: RunRecap | null, t: TFunction): RecapBlock | null {
  if (!runRecap) return null;
  return {
    buildLine: buildIdentity(runRecap, t).buildLine,
    chips: Object.entries(runRecap.tagCounts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count > 0)
      .map(([tag, count]) => ({ tag: tag as UpgradeTag, count })),
    capstoneText: runRecap.capstoneName
      ? t("buildRecap.capstoneLine", {
        name: runRecap.capstoneId
          ? contentText.capstoneName(t, { id: runRecap.capstoneId, name: runRecap.capstoneName })
          : runRecap.capstoneName,
      })
      : null,
  };
}
