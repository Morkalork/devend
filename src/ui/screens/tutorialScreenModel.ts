/**
 * What the How to Play screen lists, as data (canvas port of
 * components/game/TutorialScreen.tsx).
 */
import { Move, Scissors, Target, AlertTriangle, Heart, Flag, Star, Hammer, Fence } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BallTypeDef } from "@/lib/ballTypes";
import type { BugDef } from "@/types/bugs";

export interface TutorialStep {
  icon: LucideIcon;
  /** Under `tutorial.steps.<key>.title` / `.description`. */
  key: string;
}

export const tutorialSteps: TutorialStep[] = [
  { icon: Move, key: "swipeToCut" },
  { icon: Scissors, key: "removeEmptySpace" },
  { icon: AlertTriangle, key: "avoidTheBall" },
  { icon: Target, key: "winCondition" },
  { icon: Hammer, key: "breakObstacles" },
  // Last of the board steps: the slot bar is on screen from map one but stays
  // empty until an upgrade fills it, so it reads as decoration until something
  // says what it is. This screen is the only place that says so before the
  // player owns one.
  { icon: Fence, key: "fenceTypes" },
];

export const lifeCycleSteps: TutorialStep[] = [
  { icon: Heart, key: "lives" },
  { icon: Flag, key: "checkpoints" },
  { icon: Star, key: "headStartCertificates" },
];

/** Base ball types whose description always shows, regardless of encounter state. */
export const ALWAYS_REVEALED_BALL_IDS = new Set(["red", "green"]);

/**
 * Whether a ball's ability is shown. Types the player has not locked yet show
 * "Not encountered yet." instead: discovering one is the reward. Red and green,
 * the base/common types, are always shown.
 */
export function isBallRevealed(id: string, encounteredBallTypeIds: readonly string[]): boolean {
  return ALWAYS_REVEALED_BALL_IDS.has(id) || encounteredBallTypeIds.includes(id);
}

export interface BallRosterEntry {
  ball: BallTypeDef;
  revealed: boolean;
}

export function ballRoster(balls: BallTypeDef[], encounteredBallTypeIds: readonly string[]): BallRosterEntry[] {
  return balls.map(ball => ({ ball, revealed: isBallRevealed(ball.id, encounteredBallTypeIds) }));
}

/**
 * The bug roster: every entry, always, with nothing hidden behind having met
 * it - deliberately unlike the ball roster. A bug's decision happens BEFORE you
 * touch it, and the one that can cost you the map is the rarest in the pool;
 * a roster that made you meet it first would withhold exactly the warning it
 * exists to give. The copy is the catalogue's own (public/bugs.yml), the same
 * strings the press-and-hold explainer shows.
 */
export function bugRoster(bugs: BugDef[]): BugDef[] {
  return bugs;
}

export interface ControlRow {
  /** `tutorial.controlTouchLabel` or `tutorial.controlMouseLabel`. */
  labelKey: string;
  textKey: string;
}

/** The controls box: two touch rows, plus click-and-drag where there is no touch screen. */
export function controlRows(hasTouch: boolean): ControlRow[] {
  const rows: ControlRow[] = [
    { labelKey: "tutorial.controlTouchLabel", textKey: "tutorial.controlSwipeToCut" },
    { labelKey: "tutorial.controlTouchLabel", textKey: "tutorial.controlSecondFinger" },
  ];
  if (!hasTouch) rows.push({ labelKey: "tutorial.controlMouseLabel", textKey: "tutorial.controlClickAndDrag" });
  return rows;
}
