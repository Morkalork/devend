/**
 * The Performance Review: five axes, each banked against its own ceiling.
 *
 * ── What this replaces, and why ────────────────────────────────────────────
 *
 * Every map used to pay into ONE pot with ONE ceiling (points x headroom =
 * 80h on all 35 maps, since every map is `points: 20`). Lock income, though,
 * is a deep multiplicative stack: lockMultiplier x money x frozen x gravity x
 * zone x simultaneous x superior. So the pot overflowed, and everything past
 * the brim was silently discarded:
 *
 *     3 superior locks (x1,x1,x2)                     earns 116h, paid 80h
 *     2 balls in one cut, both superior               earns 212h, paid 80h
 *     2 balls in one cut, superior, in a const area   earns 596h, paid 80h
 *
 * That alone would only have been wasteful. What made it decide the game was
 * that Ship Early was paid ABOVE the ceiling while everything else folded in
 * underneath. Once a run was capped - which was most of the ladder - tempo was
 * the only lever still connected to the payout, so speed was not one tactic
 * among several, it was the only one being measured. A flawless all-superior
 * run on a 3-ball map paid 80h; rushing it sloppily paid 96h. The careful
 * player was punished for being careful.
 *
 * ── The model ──────────────────────────────────────────────────────────────
 *
 * Income splits into DELIVERY plus four tactical axes, each with its own
 * ceiling, and each banked independently. Maxing one never spends another's
 * headroom, so there is nothing left for a single dominant route to crowd out.
 *
 *   DELIVERY  did you lock the balls at all          the baseline, not a tactic
 *   CRAFT     superior / zone / simultaneous quality  costs time and fences
 *   TEMPO     ship early                              costs craft
 *   THRIFT    finishing under par                     costs craft and greed
 *   GREED     clearing past the requirement           costs fences and time
 *
 * The four tactical axes form a ring where neighbours physically fight each
 * other - tight pockets are slow, coarse cuts are loose, extra clearing costs
 * fences - so about two are reachable in one run. Two maxed axes plus the base
 * lands near the same total whichever two you pick, which is the whole point:
 * the tactic is a CHOICE, not a correct answer.
 *
 * ── Everything is a ratio of what THIS map could give ──────────────────────
 *
 * Every axis banks `ceiling x ratio`, where the ratio is measured against the
 * map's own potential rather than an absolute number of hours. That is what
 * makes the ceilings meaningful at all: a 1-ball map holds 12h of lock
 * capacity and a 4-ball act-III map holds 240h, so any flat figure either
 * crushes the big maps or gives the small ones away. Two consequences worth
 * stating, because both were bugs in the old ladders:
 *
 *   - The old space bonus measured extra clearing as a fraction of what was
 *     REQUIRED. At level 29's 93% requirement the most you could physically
 *     exceed it by is 7.5%, so its second and third rungs (30% and 55%) were
 *     unreachable by construction on every late map. Greed now measures the
 *     leftover slack you consumed, which is reachable on all 35.
 *   - The old under-par ladder paid absolute rungs up to 4 fences under, on
 *     maps whose par ranges from 3 to 10. Thrift is now a fraction of par.
 *
 * The upshot is that the same quality of play pays the same on level 3 and on
 * level 29, and a map's ball roster changes what it FEELS like rather than
 * what it is worth.
 */
import type { AxisCeilings, BankedAxes, ScoreAxisInput } from "@/types/scoring";

/** Under par by this fraction of par banks the whole Thrift axis. */
export const THRIFT_FULL_AT_PAR_FRACTION = 0.4;
/** Consuming this much of the leftover slack banks the whole Greed axis. */
export const GREED_FULL_AT_SLACK_FRACTION = 0.6;

/** The five axes, in the order the results screen reads them. */
export const AXIS_NAMES = ["delivery", "craft", "tempo", "thrift", "greed"] as const;
export type AxisName = (typeof AXIS_NAMES)[number];

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** A ratio guarded against a zero or missing denominator (which means "this
 *  map cannot offer this axis", not "you failed at it"). */
function ratio(earned: number, potential: number): number {
  if (!Number.isFinite(potential) || potential <= 0) return 0;
  if (!Number.isFinite(earned) || earned <= 0) return 0;
  return clamp01(earned / potential);
}

/**
 * DELIVERY: the share of the map's lock capacity you actually banked.
 *
 * Capacity is every ball's `lockMultiplier x lockValue` summed over the whole
 * roster, so locking all of them is a full axis and losing one to a game over
 * costs you its share. Deliberately blind to quality - the premium a superior
 * or zone lock pays is Craft's business, not this axis's - which is what makes
 * "just get the balls away" a floor you can always reach rather than a tactic
 * competing with the others.
 */
export function deliveryRatio(lockedCapacity: number, totalCapacity: number): number {
  return ratio(lockedCapacity, totalCapacity);
}

/**
 * CRAFT: the share of the available quality premium you earned.
 *
 * The denominator is what the map would pay if EVERY lock were superior and
 * nothing else stacked, so a clean all-superior run is exactly a full axis.
 * Zone locks, simultaneous cuts, money balls and frozen locks all push the
 * numerator past that and clamp, which is the intended shape: they are
 * different ROUTES to a full Craft axis, not a bigger one. A player who cannot
 * get a const-area lock on a given map is not locked out of the axis.
 */
export function craftRatio(premiumEarned: number, premiumAvailable: number): number {
  return ratio(premiumEarned, premiumAvailable);
}

/**
 * THRIFT: how far under par you finished, as a fraction of par.
 *
 * Relative rather than absolute because par runs from 3 to 10 across the
 * ladder: "four fences under" is a strong result on a par-10 map and literally
 * impossible on a par-3 one. At the default 0.4 a par-7 map banks the full
 * axis three cuts under, and a par-4 map two cuts under.
 */
export function thriftRatio(
  usedFences: number, parFences: number, fullAtParFraction = THRIFT_FULL_AT_PAR_FRACTION,
): number {
  if (!Number.isFinite(parFences) || parFences <= 0) return 0;
  const under = parFences - usedFences;
  if (!Number.isFinite(under) || under <= 0) return 0;
  const full = parFences * (fullAtParFraction > 0 ? fullAtParFraction : THRIFT_FULL_AT_PAR_FRACTION);
  return ratio(under, full);
}

/**
 * GREED: how much of the board you were ALLOWED to leave that you took anyway.
 *
 * The slack is `1 - required`, and the ratio is the part of it you consumed.
 * This is the fix for the old space bonus, which measured the overshoot
 * against the requirement itself and so became unreachable exactly where the
 * requirements got interesting: at level 29's 93% the whole slack is 7%, and
 * the old ladder wanted 30% and 55% overshoots for its upper rungs.
 */
export function greedRatio(
  actualRemovedRatio: number, requiredRemovedRatio: number,
  fullAtSlackFraction = GREED_FULL_AT_SLACK_FRACTION,
): number {
  if (!Number.isFinite(requiredRemovedRatio) || requiredRemovedRatio >= 1) return 0;
  const slack = 1 - requiredRemovedRatio;
  const taken = actualRemovedRatio - requiredRemovedRatio;
  if (!Number.isFinite(taken) || taken <= 0) return 0;
  const full = slack * (fullAtSlackFraction > 0 ? fullAtSlackFraction : GREED_FULL_AT_SLACK_FRACTION);
  return ratio(taken, full);
}

/**
 * TEMPO: the Ship Early ladder, as its own axis rather than a cut of the rest.
 *
 * It used to pay a percent of the whole earned payout, which double-penalised
 * exactly the player it is meant to reward: a speedrunner banks little Craft,
 * so a percentage of their total was small on top of already being fast
 * instead of precise. Scaling the ladder against its own top rung keeps the
 * axis worth the same to everyone who reaches it.
 */
export function tempoRatio(shipEarlyPercent: number, maxPercent: number): number {
  return ratio(shipEarlyPercent, maxPercent);
}

/** A ceiling scaled by an upgrade multiplier, floored at zero. */
function ceiling(base: number, multiplier = 1): number {
  const b = Number.isFinite(base) && base > 0 ? base : 0;
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return b * m;
}

/**
 * Bank every axis and total them.
 *
 * Upgrade multipliers raise an axis CEILING rather than its payout, which is
 * the shape the whole rework exists to support: an upgrade is a commitment to
 * a lane, and a lane you have not played has nothing for the upgrade to
 * multiply. Overdelivery on a run you never took under par is dead weight, and
 * that is the trade the build is supposed to be making.
 */
export function bankAxes(input: ScoreAxisInput, ceilings: AxisCeilings): BankedAxes {
  const {
    lockedCapacity, totalCapacity, premiumEarned, premiumAvailable,
    usedFences, parFences, actualRemovedRatio, requiredRemovedRatio,
    shipEarlyPercent, shipEarlyMaxPercent, flatGreedBonus = 0,
    thriftCeilingMultiplier = 1, greedCeilingMultiplier = 1, tempoCeilingMultiplier = 1,
    lockPayoutMultiplier = 1, fencesOverPar = 0,
    thriftFullAtParFraction, greedFullAtSlackFraction,
  } = input;

  // Demolition (issue #38) multiplies the lock income specifically, because
  // that is what stopping to smash things costs you: the time you spent on it
  // came out of Tempo, so the offset belongs on the axes it was traded for.
  const lockMult = Number.isFinite(lockPayoutMultiplier) && lockPayoutMultiplier > 0 ? lockPayoutMultiplier : 1;

  const delivery = Math.round(
    ceiling(ceilings.delivery) * deliveryRatio(lockedCapacity, totalCapacity) * lockMult,
  );
  const craft = Math.round(
    ceiling(ceilings.craft) * craftRatio(premiumEarned, premiumAvailable) * lockMult,
  );
  /**
   * DELIVERY GATES THE STYLE AXES.
   *
   * Tempo, Thrift and Greed all measure HOW you cleared the board, and none of
   * them needs a single ball sealed away. Left ungated, a fast, frugal, greedy
   * run that locked nothing at all banks three full axes, and the economy's
   * founding rule - locking IS the income, a bare clear cannot fund even the
   * cheapest hire - quietly stops being true.
   *
   * So they scale with the share of the roster you actually delivered. A clean
   * sweep leaves them untouched, which is every run these ceilings were tuned
   * against; losing one ball of four costs a quarter of your style marks; and a
   * clear that seals nothing is worth its flat base and nothing else. It is the
   * Performance Review's own logic: there are no marks for how you worked on
   * something you did not ship.
   *
   * Craft is deliberately NOT gated. It is already a fraction of the premium
   * that only locking can earn, so gating it would square the same penalty.
   */
  // A map with no lock capacity at all cannot gate anything: there is nothing
  // to deliver, so the style axes stand on their own. Same reading the ratio
  // helpers take everywhere else - a missing denominator means the map does not
  // offer this axis, not that the player failed at it.
  const hasCapacity = Number.isFinite(totalCapacity) && totalCapacity > 0;
  const shipped = hasCapacity ? deliveryRatio(lockedCapacity, totalCapacity) : 1;

  const tempo = Math.round(
    ceiling(ceilings.tempo, tempoCeilingMultiplier)
      * tempoRatio(shipEarlyPercent, shipEarlyMaxPercent) * shipped,
  );
  const thrift = Math.round(
    ceiling(ceilings.thrift, thriftCeilingMultiplier)
      * thriftRatio(usedFences, parFences, thriftFullAtParFraction) * shipped,
  );
  // Three or more over par still switches Greed off entirely. Clearing extra
  // board while spraying fences at it is not a greed play, it is the same
  // inefficiency the performance multiplier is already docking the base for.
  const greedCap = ceiling(ceilings.greed, greedCeilingMultiplier);
  const greedEarned = fencesOverPar >= 3
    ? 0
    : (greedCap * greedRatio(actualRemovedRatio, requiredRemovedRatio, greedFullAtSlackFraction)
      + Math.max(0, flatGreedBonus)) * shipped;
  const greed = Math.round(Math.min(greedCap, greedEarned));

  return {
    delivery, craft, tempo, thrift, greed,
    total: delivery + craft + tempo + thrift + greed,
    ratios: {
      delivery: shipped,
      craft: craftRatio(premiumEarned, premiumAvailable),
      tempo: tempoRatio(shipEarlyPercent, shipEarlyMaxPercent),
      thrift: thriftRatio(usedFences, parFences, thriftFullAtParFraction),
      greed: fencesOverPar >= 3
        ? 0
        : greedRatio(actualRemovedRatio, requiredRemovedRatio, greedFullAtSlackFraction),
    },
    ceilings: {
      delivery: Math.round(ceiling(ceilings.delivery)),
      craft: Math.round(ceiling(ceilings.craft)),
      tempo: Math.round(ceiling(ceilings.tempo, tempoCeilingMultiplier)),
      thrift: Math.round(ceiling(ceilings.thrift, thriftCeilingMultiplier)),
      greed: Math.round(greedCap),
    },
  };
}
