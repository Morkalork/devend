/**
 * Why the map was lost, carried from the physics layer to the screen that has
 * to explain it.
 *
 * Every way of failing a map used to end in the same two frames: a red flash, a
 * shake, and either a remount or a generic GAME OVER. The reason existed only
 * as the branch that fired and was discarded on the way out, so the one moment
 * the player most needs to know what happened is the moment the game says
 * least. Running out of time was the worst of them - a life gone and the map
 * silently back at the start, with nothing on screen having named the clock.
 *
 * There are two halves to an honest answer, and the trigger alone is only the
 * first:
 *
 *   - WHAT ENDED IT. The clock, the fence budget, or a gate zone that no ball
 *     can reach any more.
 *   - WHAT WAS STILL MISSING. The requirements that were not met yet, each with
 *     how close it had come. "Out of time" tells a player the rule; "out of
 *     time, and you still needed 2 locks, you had 1" tells them the game.
 *
 * Pure and free of both LevelConfig and CanvasGameState: it takes the spec and
 * the snapshot the win check has already computed, so it cannot disagree with
 * the gate it is reporting on, and a test can build one in two lines.
 */
import type { TFunction } from "i18next";
import type { WinSpec, WinSnapshot, WinConditionProgress } from "@/types/winSpec";
import { evaluateWinCondition } from "@/lib/winSpec";

/** What ended the map. Every one of these costs a life. */
export type MapFailKind =
  /** The map deadline passed (mapTiming's limit, authored or the default ramp). */
  | "timeUp"
  /** The last fence in the map's budget completed without winning (WIP Limit). */
  | "outOfFences"
  /** A gate Colored Area with no target ball left that could still reach it. */
  | "areaUnreachable"
  /** A ball sealed inside a launcher barrel before it had finished ejecting. */
  | "launcherPrematureLock"
  /**
   * A ball hit a fence while it was still growing.
   *
   * The commonest death in the game, and the one the old code argued needed no
   * sentence because the player watched it happen. That holds while the map
   * continues; it does not hold on the last life, where the run ends and the
   * results screen showed a bare GAME OVER.
   */
  | "ballHitFence"
  /**
   * A mover ran through a fence while it was still growing.
   *
   * Kept apart from ballHitFence because the lesson is different: a ball is
   * dodgeable and a patrolling mover is a timing window, and "your fence was
   * cut by a ball" would be a lie about which thing on the board killed you.
   */
  | "moverHitFence"
  /**
   * Every ball locked with the map's requirements still unmet.
   *
   * Sealing the last ball used to be a free win on 27 of the 35 maps: the
   * `allLocked` alternative shipped the map whatever the board looked like,
   * and even without it captureUnreachableCells writes off the whole board the
   * instant nothing is in play, so the space clause was met as a consequence.
   * Locking everything therefore beat any map whose win was only space, with
   * every object on it untouched.
   *
   * Nothing can change once no ball is in play - a slab cannot be smashed, a
   * zone cannot be entered - so an unmet requirement at that moment is final,
   * and saying so immediately is kinder than a board that quietly cannot be
   * finished. Same shape as areaUnreachable, which has always ended a gate map
   * whose zone became impossible.
   */
  | "lockedOut";

/**
 * Every kind, as a runtime list.
 *
 * Built from an exhaustive Record so that adding a kind to the union without
 * adding it here is a COMPILE error, not a silent gap. The alternative - a
 * hand-written array - is what let `launcherPrematureLock` ship without ever
 * being checked for having words in the three locales.
 */
const ALL_FAIL_KINDS: Record<MapFailKind, true> = {
  timeUp: true,
  outOfFences: true,
  areaUnreachable: true,
  launcherPrematureLock: true,
  ballHitFence: true,
  moverHitFence: true,
  lockedOut: true,
};

export const MAP_FAIL_KINDS = Object.keys(ALL_FAIL_KINDS) as MapFailKind[];

export interface MapFailure {
  kind: MapFailKind;
  /**
   * The requirements still unmet when it ended, each carrying `current` and
   * `target` so the explanation can be specific rather than a restatement of
   * the map's rules.
   *
   * Can legitimately be empty: a gate map whose zone became unreachable has
   * failed on a board property, not on a counter, so there may be nothing to
   * list beyond the kind. The UI must read an empty list as "the kind says it
   * all" and not as "no reason".
   */
  unmet: WinConditionProgress[];
}

/**
 * Build the failure from the same spec and snapshot the win check just read.
 *
 * Only `require` is considered. An unmet ALTERNATIVE is not a reason the map
 * was lost - it is a door the player chose not to take - and listing every
 * "or else" clause as a failure would bury the requirement that actually
 * stopped them.
 */
export function mapFailure(
  kind: MapFailKind, spec: WinSpec, snap: WinSnapshot,
): MapFailure {
  return {
    kind,
    unmet: spec.require
      .map(c => evaluateWinCondition(c, snap))
      .filter(p => !p.met),
  };
}

/** The headline: one short sentence naming what ended the map. */
export function failHeadline(t: TFunction, failure: MapFailure): string {
  return t(`mapFailure.${failure.kind}`) as string;
}

/**
 * One line per unmet requirement, in the map's own terms plus the numbers.
 *
 * Rendered from the condition and the progress ALONE, never from LevelConfig,
 * so the result screen can explain a failure it was handed without also having
 * to be handed the level it came from. `target` already carries everything the
 * level would have contributed (underPar's target is par plus its delta, worked
 * out when the snapshot was taken).
 */
export function failLines(t: TFunction, failure: MapFailure): string[] {
  return failure.unmet.map(p => {
    const c = p.condition;
    const v = { current: p.current, target: p.target };
    switch (c.kind) {
      case "space": return t("mapFailure.needSpace", v) as string;
      case "locks": return t("mapFailure.needLocks", v) as string;
      case "superiorLocks": return t("mapFailure.needSuperior", v) as string;
      case "area": return t("mapFailure.needArea", v) as string;
      case "lockType": return t("mapFailure.needLockType", { ...v, ball: c.ballType }) as string;
      case "boss": return t("mapFailure.needBoss") as string;
      case "allLocked": return t("mapFailure.needAllLocked") as string;
      case "smashed": return t("mapFailure.needSmashed", v) as string;
      case "delivered": return t("mapFailure.needDelivered", v) as string;
      case "underPar": return t("mapFailure.needUnderPar", v) as string;
      case "speedClear": return t("mapFailure.needSpeed", v) as string;
    }
  });
}
