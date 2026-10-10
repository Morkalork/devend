/**
 * What one goal chip says and in what colour (canvas GoalChip). The rules are
 * the DOM chip's, moved here so they can be tested without a renderer.
 */
import type { TFunction } from "i18next";
import type { Goal } from "@/lib/goalTracker";
import { COLOR } from "../theme";

/** The one state that costs a life. */
export const GOAL_AT_RISK = 0xff6b6b;
/** Past par: costs score and nothing else, so amber, not the red of real loss. */
export const GOAL_OVER = 0xffb020;

export interface GoalChipLook {
  color: number;
  /** The glow colour, or null for a goal with nothing to announce. */
  glow: number | null;
  /** Progress as text: "2/3", "73/85%", or a tally's bare "2". */
  value: string;
  /** What the chip prints: the value, or CLEAR once the whole map is won. */
  shown: string;
}

export function goalChipLabel(t: TFunction, goal: Goal): string {
  return goal.ballType ? t(goal.labelKey, { type: goal.ballType }) : t(goal.labelKey);
}

export function goalChipLook(goal: Goal, accent: number, atRisk: boolean, winMet: boolean, clearText: string): GoalChipLook {
  // Four states, and each answers a different question. Done: banked, stop
  // thinking about it. At risk: one lock from losing this, the only state that
  // costs a life. Over: past par, which costs score and nothing else, so it is
  // warned about in amber rather than in the red reserved for real loss.
  const color = goal.done ? accent
    : atRisk ? GOAL_AT_RISK
    : goal.over ? GOAL_OVER
    : COLOR.foreground;
  const glow = goal.done ? accent : atRisk ? GOAL_AT_RISK : goal.over ? GOAL_OVER : null;

  // A tally has no target, so it shows a bare number: "2 locked" rather than a
  // fraction against a requirement this map does not have.
  const value = goal.target === null
    ? `${goal.current}${goal.unit === "percent" ? "%" : ""}`
    : goal.unit === "percent"
      ? `${goal.current}/${goal.target}%`
      : `${goal.current}/${goal.target}`;

  // The space chip's CLEAR speaks for the whole MAP, not its own clause: on
  // level 13 ("clear to 14% AND smash one slab") it announced a win the map
  // had not granted. So it needs winMet (goalTracker.everyRequirementMet).
  const shown = goal.done && goal.kind === 'space' && winMet ? clearText : value;
  return { color, glow, value, shown };
}

/** The chip's accessible name: what it is, how far along, and the warning. */
export function goalChipAria(t: TFunction, label: string, value: string, atRisk: boolean): string {
  return `${label} ${value}${atRisk ? ` (${t("winGate.atRisk", { label })})` : ""}`;
}
