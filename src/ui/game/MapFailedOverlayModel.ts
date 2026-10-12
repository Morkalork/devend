/**
 * MapFailedOverlay's timing and copy, apart from the drawing so both can be
 * checked without a canvas. The reasoning behind each lives in
 * components/game/MapFailedOverlay.tsx and is repeated where it decides a value.
 */
import type { TFunction } from "i18next";
import { failHeadline, failLines, type MapFailure } from "@/lib/mapFailure";

/** Long enough to read two short lines without becoming a wall between attempts. */
export const MAP_FAILED_MS = 4200;

/**
 * The backstop on the last life, where the overlay waits for a tap instead.
 *
 * Not a reading window - it is far longer than anyone reads for. A run ending
 * is not a retry loop, so there is no next attempt to hurry back to and the
 * player is allowed to sit with it; but a modal with no timer at all is a modal
 * that strands the whole run if its tap ever fails to land.
 */
export const MAP_FAILED_RUN_OVER_MS = 30000;

/**
 * With the ticket up: the whole Acceptance Criteria card to read, not two
 * short lines, so a longer window (a tap still goes at once).
 */
export const MAP_FAILED_TICKET_MS = 7000;

/** How long the overlay waits before dismissing itself. */
export function mapFailedDelay(runOver: boolean, ticket = false): number {
  return runOver ? MAP_FAILED_RUN_OVER_MS : ticket ? MAP_FAILED_TICKET_MS : MAP_FAILED_MS;
}

export interface MapFailedCopy {
  /** What ended the map. */
  headline: string;
  /** What was still outstanding when it did, with the numbers. */
  lines: string[];
  /** The stakes: lives left, or that the run is over. */
  stakes: string;
  /** What a tap does: retry, or finish. Never "try again" over a finished run. */
  tapLine: string;
}

export function mapFailedCopy(t: TFunction, failure: MapFailure, livesLeft: number, runOver: boolean): MapFailedCopy {
  return {
    headline: failHeadline(t, failure),
    lines: failLines(t, failure),
    stakes: runOver ? t("mapFailure.runOver") as string : t("mapFailure.livesLeft", { count: livesLeft }) as string,
    tapLine: runOver ? t("mapFailure.tapToFinish") as string : t("mapFailure.tapToRetry") as string,
  };
}
