/**
 * The between-map pipeline (UI_REDO_PLAN.md, phase 2): which stages stand
 * between this map and the next, and which one the player is on.
 *
 * The run used to stop and restart between maps: Level Complete, then the
 * Promotion draft when one was due, then the store, each its own screen with
 * its own header and its own idea of where Continue goes. They are still
 * three screens in the session's state machine (that logic is tested and
 * stays), but each now draws inside one PipelineFrame showing every stage, so
 * the player always sees how far there is to go before the next map.
 */
import type { TFunction } from "i18next";
import type { Stage } from "../kit/pipelineStyle";

/** What stands between the map just won and the next, decided when it is won. */
export interface BetweenMapPlan {
  /** The level just cleared (1-based). */
  clearedLevel: number;
  /** A Promotion is due after this level and has not been taken. */
  promotion: boolean;
  /** The store opens after this level. */
  store: boolean;
  /** This was the last level: the run ends, a win, on the result screen. */
  last: boolean;
}

/** The content column's widest, so a tablet does not stretch rows across the screen. */
export const PIPELINE_MAX_WIDTH = 560;
/** The column's side margin on a phone. */
const PIPELINE_PAD = 16;

/** How wide the content column is on a screen this wide. */
export function pipelineColumnWidth(screenWidth: number): number {
  return Math.min(screenWidth - PIPELINE_PAD * 2, PIPELINE_MAX_WIDTH);
}

export type PipelineStageId = "debrief" | "promotion" | "store" | "next";

/** The plan a gallery entry or a preview uses: every stage present. */
export function samplePlan(clearedLevel = 10): BetweenMapPlan {
  return { clearedLevel, promotion: true, store: true, last: false };
}

/** The stages in order, the ones this map skips left out. */
export function stageIds(plan: BetweenMapPlan): PipelineStageId[] {
  const ids: PipelineStageId[] = ["debrief"];
  if (plan.promotion && !plan.last) {
    ids.push("promotion");
  }
  if (plan.store && !plan.last) {
    ids.push("store");
  }
  ids.push("next");
  return ids;
}

/** The stage after `at`, which names the Continue button. */
export function nextStage(plan: BetweenMapPlan, at: PipelineStageId): PipelineStageId {
  const ids = stageIds(plan);
  const i = ids.indexOf(at);
  return ids[Math.min(ids.length - 1, (i < 0 ? 0 : i) + 1)];
}

/** Every stage with its state relative to `at`, titled for the strip. */
export function pipelineStages(plan: BetweenMapPlan, at: PipelineStageId, t: TFunction): Stage[] {
  const ids = stageIds(plan);
  const here = Math.max(0, ids.indexOf(at));
  return ids.map((id, i) => ({
    id,
    title: stageTitle(plan, id, t),
    state: i < here ? "done" : i === here ? "now" : "todo",
  }));
}

export function stageTitle(plan: BetweenMapPlan, id: PipelineStageId, t: TFunction): string {
  switch (id) {
    case "debrief": return t("pipeline.debrief");
    case "promotion": return t("pipeline.promotion");
    case "store": return t("pipeline.store");
    default: return plan.last ? t("pipeline.finish") : t("pipeline.level", { level: plan.clearedLevel + 1 });
  }
}

/** What the button that leaves `at` says: where it goes. */
export function continueLabel(plan: BetweenMapPlan, at: PipelineStageId, t: TFunction): string {
  const to = nextStage(plan, at);
  switch (to) {
    case "promotion": return t("pipeline.toPromotion");
    case "store": return t("pipeline.toStore");
    default: return plan.last ? t("pipeline.toFinish") : t("pipeline.toLevel", { level: plan.clearedLevel + 1 });
  }
}
