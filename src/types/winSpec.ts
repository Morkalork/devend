/**
 * What a map asks of you, as data instead of as control flow.
 *
 * Win conditions used to be an implicit priority chain in applyCut.ts reading
 * five unrelated LevelConfig fields, where the fact that a gate area REPLACES
 * the space clear rather than adding to it was expressed only by the order of
 * the `if`s. Nothing could bind an editor to that, and the "How to win" modal
 * had to read the same five fields a second time and reach the same conclusion
 * independently, which its own header comment already worried about.
 *
 * One spec, read by the gate and by the modal, is the fix for both: a map can
 * be edited, and it cannot tell the player one thing and check another.
 */

/**
 * One clause of a win.
 *
 * Deliberately a closed union rather than a `kind` string with loose params:
 * the admin panel renders a different editor per kind, the modal writes a
 * different sentence per kind, and an unknown kind should fail to compile
 * rather than silently evaluate as "met".
 */
/**
 * The difficulty premium a clause carries, in percent of the map's earned pay.
 *
 * Attached to the CONDITION rather than to the level so the price and the thing
 * being priced live together: an author who adds "lock a ball in the const
 * zone" writes what it is worth in the same row, and cannot add a hard win and
 * forget to pay for it.
 *
 * Premiums from every MET condition add up (30 + 20 = 50, not 56), because an
 * author reading a list of clauses should be able to total them in their head.
 * A required clause always pays, since you cannot win the map without it; an
 * `alsoWinIf` clause pays only when it is the one that actually fired, which is
 * what lets a hard alternative route be worth taking.
 */
export interface WinBonus {
  /** Extra pay as a percent of the map's earned overtime. 30 = +30%. */
  bonusPercent?: number;
}

export type WinCondition = (
  /** Clear down to at most `threshold` percent of the board remaining. */
  | { kind: "space"; threshold: number }
  /** Lock at least `count` balls, of any type. */
  | { kind: "locks"; count: number }
  /** Lock at least `count` balls in a pocket tight enough to grade SUPERIOR. */
  | { kind: "superiorLocks"; count: number }
  /**
   * Lock at least `count` target balls inside a gate Colored Area.
   *
   * `count` generalises level 10, where the gate was satisfied by the first
   * target in. Two balls in one zone is the shape the economy's Craft axis
   * already pays for and the win could not previously ask for.
   */
  | { kind: "area"; count: number }
  /** Lock at least `count` balls whose ball type is `ballType`. */
  | { kind: "lockType"; ballType: string; count: number }
  /** Defeat the boss ball. */
  | { kind: "boss" }
  /** Lock every ball that is still in play. */
  | { kind: "allLocked" }
  /** Finish using at most `par + delta` cuts (delta may be negative). */
  | { kind: "underPar"; delta: number }
  /** Meet the rest of the win inside `seconds` of ACTIVE play. */
  | { kind: "speedClear"; seconds: number }
) & WinBonus;

export type WinConditionKind = WinCondition["kind"];

/** Every kind, in the order the admin panel and the modal list them. */
export const WIN_CONDITION_KINDS: WinConditionKind[] = [
  "space", "locks", "superiorLocks", "area", "lockType",
  "boss", "allLocked", "underPar", "speedClear",
];

/**
 * A map's whole win.
 *
 * Two groups because the existing behaviour needs both and neither alone is
 * enough: `require` is a conjunction (clear the board AND lock two), while
 * "every ball locked ends the map whatever space is left" is an alternative
 * that has always short-circuited the rest.
 */
export interface WinSpec {
  /** All of these must be met for the map to be won. */
  require: WinCondition[];
  /** Any single one of these wins outright, whatever `require` says. */
  alsoWinIf: WinCondition[];
  /**
   * True when the spec was authored on the level rather than derived from its
   * legacy fields. Derived specs must stay behaviourally identical to the old
   * chain; authored ones are free to say anything.
   */
  authored: boolean;
}

/** The counters a win condition can read, gathered from live game state. */
export interface WinSnapshot {
  /** Percent of the board still playable. */
  remainingPercent: number;
  lockedBalls: number;
  superiorLocks: number;
  /** Target balls locked inside a gate Colored Area. */
  areaTargets: number;
  /** Locked balls by their ball-type id, for `lockType`. */
  lockedByType: Record<string, number>;
  bossDefeated: boolean;
  /** True when no ball is still in play. */
  allLocked: boolean;
  cuts: number;
  par: number;
  activeSeconds: number;
}

/** How one clause is doing, for the HUD and the admin preview. */
export interface WinConditionProgress {
  condition: WinCondition;
  current: number;
  target: number;
  met: boolean;
  /**
   * `limit` clauses (underPar, speedClear) start met and can only be lost, so a
   * HUD must show them neutrally rather than celebrating them at second zero.
   */
  mode: "accumulate" | "limit";
}
