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

/** Which way a `splitLocks` clause cuts the board. */
export type SplitAxis = "vertical" | "horizontal";

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
  /**
   * Lock at least `count` balls on EACH side of a dividing line.
   *
   * The clause that asks WHERE rather than how many. Every other lock condition
   * counts balls and is satisfied wherever they were sealed, so on a two-ball
   * map "lock 2" and "lock them anywhere" are the same sentence - which is a
   * large part of why the opening maps play alike whatever furniture they carry.
   * This one cannot be met by taking the pocket that happens to be convenient
   * twice: a side already paid for is worth nothing, so the second lock has to
   * be set up on the far side while the first is still standing.
   *
   * The line is the map's to choose, because the division it tests has to be
   * the one the map actually has. `axis` picks which way the board is cut and
   * `at` picks where, defaulting to the board's own centre on that axis - which
   * is where the opening maps' jamb column already sits. A map divided by a
   * horizontal shelf asks for `axis: horizontal` and gets top and bottom; a map
   * whose divider is off-centre says so in `at` rather than being told its
   * geometry is wrong.
   *
   * Which side a lock counted for is worked out HERE, from the position the
   * lock was recorded at, rather than tallied into two counters while the map
   * is played. The runtime cannot know where an author will draw the line, and
   * a tally taken against the wrong line is not recoverable afterwards.
   */
  | {
      kind: "splitLocks";
      /** How many locks each side needs. Both sides need the same number. */
      count: number;
      /**
       * Which way the board is divided. `vertical` gives a left and a right
       * (a line running up the board); `horizontal` gives a top and a bottom.
       */
      axis?: SplitAxis;
      /**
       * Where the dividing line sits, in world units along the axis: an x for
       * `vertical`, a y for `horizontal`. Defaults to the board's centre.
       */
      at?: number;
    }
  /** Defeat the boss ball. */
  | { kind: "boss" }
  /** Lock every ball that is still in play. */
  | { kind: "allLocked" }
  /**
   * Deliver at least `count` balls into delivery boxes.
   *
   * Deliberately separate from "locks": a delivered ball was herded through a
   * membrane, not sealed into a pocket, and the two are different verbs with
   * different difficulty. Counting them together would let a map that asked for
   * herding be satisfied by ordinary sealing.
   */
  | { kind: "delivered"; count: number }
  /**
   * Smash at least `count` of the map's breakable obstacles.
   *
   * The clause act I was missing. Breakables are the most common feature in
   * the opening maps and there was no way to make one part of the win, so a
   * map built to teach "break the slab" could be finished without ever
   * touching it. Counts breakables only, on the same rule the Engagement axis
   * uses: mirrors and movers are destructible too, but they are scenery a ball
   * happens to hit rather than a thing the player sets out to do.
   */
  | { kind: "smashed"; count: number }
  /**
   * Light at least `count` of the map's circuit terminals.
   *
   * A terminal is lit by routing a fence THROUGH it, which is a different verb
   * from sealing or breaking: it spends a cut on something that does not shrink
   * the board. That trade is the whole point of a wiring map, and until now the
   * win could not ask for it - the Engagement axis has always measured lit
   * terminals, so the game counted the play it could not require.
   */
  | { kind: "terminals"; count: number }
  /**
   * Harvest at least `count` segments of the map's data stream.
   *
   * Harvested by running a fence ALONG the seam rather than through a point,
   * so it is its own verb again. Counted in segments, which is what the runtime
   * flags, rather than in whole streams: a seam is partially harvestable by
   * design and a win that could only ask for all of it would be a different,
   * much harder clause wearing the same name.
   */
  | { kind: "harvested"; count: number }
  /** Finish using at most `par + delta` cuts (delta may be negative). */
  | { kind: "underPar"; delta: number }
  /** Meet the rest of the win inside `seconds` of ACTIVE play. */
  | { kind: "speedClear"; seconds: number }
) & WinBonus;

export type WinConditionKind = WinCondition["kind"];

/** Every kind, in the order the admin panel and the modal list them. */
export const WIN_CONDITION_KINDS: WinConditionKind[] = [
  "space", "locks", "superiorLocks", "area", "lockType", "splitLocks",
  "boss", "allLocked", "smashed", "delivered", "terminals", "harvested",
  "underPar", "speedClear",
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
  /**
   * Where each locked ball was at the moment its pocket closed, for
   * `splitLocks` and anything later that asks a question about position.
   *
   * Positions rather than a per-side tally, because the runtime taking the
   * tally does not know where the clause will draw its line: a map may divide
   * the board the other way round, or off-centre, and two counters added up
   * against the wrong line cannot be un-added. Bounded by the map's ball count,
   * so this is a handful of points at most.
   */
  lockPoints: { x: number; y: number }[];
  /** Balls herded into delivery boxes. Counted apart from locks on purpose. */
  delivered: number;
  /** The map's breakable obstacles that have been destroyed. */
  smashed: number;
  /** Circuit terminals lit by routing a fence through them. */
  terminals: number;
  /** Data-stream segments harvested by running a fence along them. */
  harvested: number;
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
