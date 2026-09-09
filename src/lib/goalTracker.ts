/**
 * Every goal a map has, in one list, so the top bar can render one thing.
 *
 * Asked for as "some kind of tracker for the various map goals... if you have
 * breakables in the map goals it should say 0/3... I would also keep those two
 * [par and space] with the rest of the goals so it's cohesive".
 *
 * The row it feeds was four different things wearing the same colour: cuts
 * against par (bespoke markup), space as a percentage counting DOWN, locks as a
 * bare tally, and then WinGateChip for the unusual clauses - the only one of
 * the four that actually read as "x of y". A player scanning that row had to
 * decode four notations to answer one question, and the answer to "what does
 * this map want" was split across them with the most important part (the
 * unusual clause) last.
 *
 * So the win spec becomes the source of the row, and everything in it is
 * rendered as progress toward a target.
 *
 * ── Three tiers, because they are not the same promise ─────────────────────
 *
 *   requirement  a clause in `spec.require`. It has a target, it can be met,
 *                and on the last ball it can be AT RISK.
 *   budget       cuts against par. Not a win condition on any map that does not
 *                author `underPar`: going over costs score, never the map. It
 *                must not read as a goal you are failing.
 *   tally        locks on a map that does not require them. A running count
 *                worth seeing (it pays overtime) with nothing to reach.
 *
 * Flattening those three into one look is exactly the mistake the live-edge cue
 * avoided: a chip that says "0/8" in the same voice as "0/1 SMASH" claims the
 * map wants eight cuts, and it does not.
 *
 * ── Why space is re-expressed here ─────────────────────────────────────────
 *
 * The evaluator models space as a LIMIT: remaining percent counting down to a
 * threshold, which is the honest shape for the win check and a poor one for a
 * tracker, where every other row counts UP toward a number. So the display pair
 * is inverted here - cleared out of needed - while `met` is taken straight from
 * the evaluator rather than recomputed. The two can disagree about presentation
 * and must never disagree about whether the map is won.
 */
import { evaluateWinCondition } from "@/lib/winSpec";
import type {
  WinCondition, WinConditionKind, WinConditionProgress, WinSnapshot, WinSpec,
} from "@/types/winSpec";

/** What a goal is promising the player. */
export type GoalTier = "requirement" | "budget" | "tally";

export interface Goal {
  /** Stable across renders, and unique even with two clauses of one kind. */
  key: string;
  kind: WinConditionKind | "par";
  tier: GoalTier;
  /** Progress so far, in display terms (see the space note above). */
  current: number;
  /** What `current` is heading for. Null on a tally, which has no target. */
  target: number | null;
  /** Percent goals render "73/85%"; the rest render "2/3". */
  unit?: "percent";
  /**
   * Banked, not merely "currently true". A limit reads as met from the first
   * frame (nothing spent yet), and colouring that as an achievement would light
   * the row green on a map the player has not begun.
   */
  done: boolean;
  /** Over a budget: costs score, not the map. Never true for a requirement. */
  over: boolean;
  /** i18n key for the chip's short label. */
  labelKey: string;
  /** lockType names the ball, which is the whole requirement. */
  ballType?: string;
  /** The clause this came from, for the at-risk check. Null off-spec. */
  progress: WinConditionProgress | null;
}

/** The two the row shows on every map, required or not. */
const ALWAYS_SHOWN: WinConditionKind[] = ["space", "locks"];

const labelKeyFor = (kind: WinConditionKind | "par"): string =>
  kind === "par" ? "goal.par" : `winGate.${kind}`;

const keyFor = (c: WinCondition): string =>
  c.kind === "lockType" ? `lockType:${c.ballType}` : c.kind;

/** One required clause, as a row. */
function requirementGoal(c: WinCondition, snap: WinSnapshot): Goal {
  const p = evaluateWinCondition(c, snap);
  const base = {
    key: keyFor(c), kind: c.kind, tier: "requirement" as const,
    labelKey: labelKeyFor(c.kind), progress: p, over: false,
    ...(c.kind === "lockType" ? { ballType: c.ballType } : {}),
  };
  if (c.kind === "space") {
    // Counting up, out of what the map asks for. Clamped at zero because a
    // board can briefly read over 100% remaining while a region resolves, and
    // "-2 of 85" is not a thing to show anyone.
    return {
      ...base, unit: "percent",
      current: Math.max(0, Math.round(100 - p.current)),
      target: Math.round(100 - p.target),
      done: p.met,
    };
  }
  // A limit (underPar, speedClear) is something you are living under, so it is
  // not "done" until the map is actually won. gateSatisfied says the same.
  return { ...base, current: p.current, target: p.target, done: p.mode === "accumulate" && p.met };
}

/**
 * Every goal on this map, in the order the win spec states them, with the
 * always-shown pair filled in where the map does not require them and the
 * fence budget last.
 *
 * Authored order rather than an order of this file's own, so the row reads the
 * same way the Acceptance Criteria modal does. A player who has just read
 * "clear 85%, smash 1" finds them in that order on the bar.
 */
export function mapGoals(spec: WinSpec, snap: WinSnapshot): Goal[] {
  const goals = spec.require.map(c => requirementGoal(c, snap));
  const have = new Set(goals.map(g => g.kind));

  // Space is on every map whether or not it is authored: it is what the board
  // is FOR, and a map that does not require it still shows how much is left.
  if (!have.has("space")) {
    goals.unshift({
      key: "space", kind: "space", tier: "tally", labelKey: labelKeyFor("space"),
      unit: "percent", current: Math.max(0, Math.round(100 - snap.remainingPercent)),
      target: null, done: false, over: false, progress: null,
    });
  }
  // Locks likewise, as a tally: no target, because this map does not ask for
  // one, and showing "2/0" would invent a requirement.
  if (!have.has("locks")) {
    goals.push({
      key: "locks", kind: "locks", tier: "tally", labelKey: labelKeyFor("locks"),
      current: snap.lockedBalls, target: null, done: false, over: false, progress: null,
    });
  }

  // The budget, last. It is the one row that is not a demand.
  //
  // Read off the SNAPSHOT rather than taken as an argument, because the top bar
  // used to be handed `level.expectedCuts` directly while the win check read
  // `snap.par`. Two copies of one number, free to disagree the day anything
  // adjusts par - which is the bug class this codebase keeps finding. One
  // source, and the chip cannot contradict the clause.
  goals.push({
    key: "par", kind: "par", tier: "budget", labelKey: labelKeyFor("par"),
    current: snap.cuts, target: snap.par,
    done: false, over: snap.cuts > snap.par, progress: null,
  });
  return goals;
}

/**
 * The goals that make this map unusual: everything except the pair every map
 * shows and the budget.
 *
 * The board frame is built on this rather than on the whole list, for the
 * reason WinGateFrame gives: it says "this map is not an ordinary clear", and a
 * frame that lit for space would light on all forty maps and teach nothing.
 */
export function extraGoals(goals: readonly Goal[]): Goal[] {
  return goals.filter(g =>
    g.tier === "requirement" && !ALWAYS_SHOWN.includes(g.kind as WinConditionKind));
}

/** The goals still outstanding, for the board frame and the last-ball warning. */
export function outstandingGoals(goals: readonly Goal[]): Goal[] {
  return goals.filter(g => g.tier === "requirement" && !g.done);
}

/**
 * Would locking the last ball throw this goal away?
 *
 * Space and locks are the two a last lock HELPS: it adds a lock, and the
 * capture cascade takes the board down. Everything else outstanding - a zone to
 * fill, a slab to break, a terminal to light - is something that ball still has
 * to do, and sealing it ends the map's ability to change. Costing a life must
 * never be a surprise, so the row says so before it happens.
 */
export function goalAtRisk(goal: Goal, ballsInPlay: number): boolean {
  if (goal.tier !== "requirement" || goal.done) return false;
  if (ALWAYS_SHOWN.includes(goal.kind as WinConditionKind)) return false;
  return ballsInPlay <= 1;
}
