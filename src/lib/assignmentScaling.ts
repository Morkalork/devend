/**
 * Sizing a lock mission to the block it is actually set over.
 *
 * The tiers in assignments.yml were authored as absolute numbers, and nothing
 * checked them against how many balls the next five maps put on the board.
 * Measured, they were not merely tight, most were impossible:
 *
 *   block   balls available   lock_quota top tier   crunch_delivery top tier
 *    6-10          11                20 (182%)              40 (364%)
 *   11-15          14                20 (143%)              40 (286%)
 *   16-20          14                20 (143%)              40 (286%)
 *   31-35           8                20 (250%)              40 (500%)
 *
 * A mission asking for more locks than there are balls is not a hard mission,
 * it is a dead one: the player takes the constraint for the whole block and the
 * reward was never reachable. Even the reachable ones had no slack, with
 * cost_cutting wanting 10 superior locks out of 11 possible on the first block.
 *
 * So thresholds are scaled to a SHARE of the block's real capacity, preserving
 * the shape the author gave them. A three-tier mission stays three tiers with
 * the same relative spacing; only the scale moves. That way the roster can be
 * balanced by feel in the YAML, and retuning a map's `maxBalls` later cannot
 * silently make a mission unwinnable again.
 */
import type { AssignmentConfig } from "@/types/assignment";
import type { LevelConfig } from "@/types/level";
import { selectBallTypesForMap, getBallType } from "@/lib/ballTypes";

/** Maps in one assignment block. Matches assignments.yml's cadence. */
export const BLOCK_SIZE = 5;

/**
 * How much of a block's lock capacity the TOP tier may ask for.
 *
 * Below level 20 there is deliberate slack: a player is still learning to seal
 * pockets at all, the roster is small, and a block that demands near-perfect
 * conversion turns the draft into a trap you learn to skip. Later blocks tighten
 * because by then locking reliably IS the skill the game is testing.
 */
export const TOP_TIER_SHARE_EARLY = 0.60;
export const TOP_TIER_SHARE_LATE = 0.75;

/**
 * The same, for SUPERIOR locks, which are a different ask entirely: every one
 * needs a pocket tight enough to grade, so converting even half the roster is a
 * strong block. Sharing a number with plain locks is what left cost_cutting
 * wanting ten superior locks from eleven balls.
 */
export const SUPERIOR_TOP_TIER_SHARE_EARLY = 0.40;
export const SUPERIOR_TOP_TIER_SHARE_LATE = 0.55;

/** The level from which the tighter shares apply. */
export const TIGHTEN_FROM_LEVEL = 20;

/**
 * How many balls the block starting at `fromLevel` puts on the board.
 *
 * Reads `maxBalls` off the authored maps. Deliberately ignores the extra balls
 * a rainbow can spawn, a boss can divide into, or a pickup can clone: none is
 * guaranteed on any given map, and a target a player can only reach on a lucky
 * roster is the same trap in a subtler form. Anything extra is slack in the
 * player's favour, which is the direction an assignment should err.
 *
 * Level variants (level-2b and friends) share a level number and only one is
 * ever played, so the first is taken and the rest ignored: summing them would
 * double-count balls that never coexist.
 */
export function blockLockCapacity(
  levels: readonly LevelConfig[], fromLevel: number, blockSize = BLOCK_SIZE,
): number {
  const seen = new Set<number>();
  let total = 0;
  for (let n = fromLevel; n < fromLevel + blockSize; n++) {
    const map = levels.find(l => l.level === n);
    if (!map || seen.has(n)) continue;
    seen.add(n);
    total += map.maxBalls ?? map.balls?.length ?? 1;
    // A terminal's sleeper is a ball you have to wake and then trap, so it is
    // lockable capacity that `maxBalls` does not mention. Level 15 declares
    // maxBalls: 0 and puts two balls on the board; counting only maxBalls made
    // that block look thinner than it is.
    total += map.circuit?.terminals?.length ?? 0;
  }
  return total;
}

/** The share of capacity the top tier of this mission may ask for. */
export function topTierShare(kind: string, fromLevel: number): number {
  const early = fromLevel < TIGHTEN_FROM_LEVEL;
  if (kind === "superiorLocks") {
    return early ? SUPERIOR_TOP_TIER_SHARE_EARLY : SUPERIOR_TOP_TIER_SHARE_LATE;
  }
  return early ? TOP_TIER_SHARE_EARLY : TOP_TIER_SHARE_LATE;
}

/**
 * An assignment with its lock thresholds sized to the block it is offered for.
 *
 * Only `cumulative` missions counting locks are touched. An `everyMap` mission's
 * thresholds are maps-passed out of five and have nothing to do with how many
 * balls there are; scaling those by ball count would be nonsense.
 *
 * Every tier keeps its relative position, so the author's shape survives: a
 * 20/30/40 mission on a 14-ball block becomes 5/7/10, still three rungs at the
 * same spacing, with the top one asking for 75% of what the block can give.
 * Each tier is floored at 1 and kept strictly ascending, because two tiers that
 * round to the same number would pay the lower reward for the higher effort.
 */
export function scaleAssignmentToBlock(
  a: AssignmentConfig, capacity: number, fromLevel: number,
): AssignmentConfig {
  const track = a.mission?.track;
  const summed = track?.kind === "lockCount" || track?.kind === "superiorLocks";
  if (!track || track.mode !== "cumulative" || !summed) return a;
  if (!Number.isFinite(capacity) || capacity <= 0) return a;

  const tiers = a.mission.tiers;
  if (tiers.length === 0) return a;
  const authoredTop = Math.max(...tiers.map(t => t.threshold));
  if (authoredTop <= 0) return a;

  const target = capacity * topTierShare(track.kind, fromLevel);
  const factor = target / authoredTop;
  // Never scale a mission UP. The authored numbers are the design's intent for
  // a generous block; a roomy block should make a mission easier to clear, not
  // move the goalposts to keep it just as hard.
  if (factor >= 1) return a;

  let previous = 0;
  const scaled = tiers.map(t => {
    const next = Math.max(1, previous + 1, Math.round(t.threshold * factor));
    previous = next;
    return { ...t, threshold: next };
  });
  return { ...a, mission: { ...a.mission, tiers: scaled } };
}

/** Scale a whole offer set for the block that follows `completedLevel`. */
export function scaleOffersForBlock(
  offers: readonly AssignmentConfig[],
  levels: readonly LevelConfig[],
  completedLevel: number,
): AssignmentConfig[] {
  const fromLevel = completedLevel + 1;
  const capacity = blockLockCapacity(levels, fromLevel);
  return offers
    // Bounties are named here for the same reason lock tiers are sized here:
    // both only mean anything once the block is known. An unresolvable one is
    // kept rather than dropped at this point - the pool filter upstream should
    // already have removed it, and silently shrinking a drawn offer set would
    // hand the player a two-card draft with no explanation.
    .map(a => resolveBountyForBlock(a, levels, fromLevel) ?? a)
    .map(a => scaleAssignmentToBlock(a, capacity, fromLevel));
}

// ── Ball-type bounties ──────────────────────────────────────────────────────

/**
 * Which ball types the block's maps will ACTUALLY put on the board, and on how
 * many of the five.
 *
 * `selectBallTypesForMap` is seeded on the map id and level alone - no run
 * seed, no Math.random - so this is not a forecast, it is the roster. That is
 * what makes a named bounty safe to set: a mission asking for a green over a
 * block whose maps never spawn one is the same dead mission the lock scaling
 * above exists to prevent, just wearing a different hat.
 *
 * An authored `ballTypeIds` (the Playground override) wins, the same way it
 * does in initGame. A circuit terminal's sleeper is counted too: it is a ball
 * you wake and then trap, and it carries an authored type of its own.
 */
export function blockBallTypeSpread(
  levels: readonly LevelConfig[], fromLevel: number, blockSize = BLOCK_SIZE,
): Map<string, number> {
  const spread = new Map<string, number>();
  const seen = new Set<number>();
  for (let n = fromLevel; n < fromLevel + blockSize; n++) {
    const map = levels.find(l => l.level === n);
    if (!map || seen.has(n)) continue;
    seen.add(n);
    const maxBalls = map.maxBalls ?? map.balls?.length ?? 1;
    const ids = new Set<string>();
    const roster = map.ballTypeIds !== undefined
      ? map.ballTypeIds.filter(id => !!getBallType(id))
      : selectBallTypesForMap(map.id, n, maxBalls).map(t => t.id);
    for (const id of roster) ids.add(id);
    for (const term of map.circuit?.terminals ?? []) {
      const id = term.ball?.typeId ?? roster[0];
      if (id) ids.add(id);
    }
    // Counted once per MAP, not once per ball: the mission asks for a map you
    // sealed one on, so a map with three greens is still one opportunity.
    for (const id of ids) spread.set(id, (spread.get(id) ?? 0) + 1);
  }
  return spread;
}

/**
 * Name the block's bounty: the type that appears on the FEWEST maps while still
 * covering every tier.
 *
 * Not the most common one. A bounty on a type that turns up on all five maps is
 * an ordinary lock mission with extra words, because you would have sealed one
 * anyway; the interesting ask is a type you have to go looking for. So this
 * takes the rarest type that still makes the top tier reachable, which is the
 * hardest honest mission the block can carry.
 *
 * Returns null when nothing clears the top tier, and the caller then drops the
 * assignment from the draft rather than offering a bounty that cannot be paid.
 */
export function pickBountyType(
  spread: Map<string, number>, topTier: number,
): string | null {
  let best: string | null = null;
  let bestMaps = Infinity;
  // Sorted for determinism: two types on the same number of maps must not
  // depend on Map insertion order, or a Daily would differ between players.
  for (const id of [...spread.keys()].sort()) {
    const maps = spread.get(id)!;
    if (maps < topTier) continue;
    if (maps < bestMaps) { best = id; bestMaps = maps; }
  }
  return best;
}

/**
 * Resolve a ball-type bounty for the block, or refuse the assignment.
 *
 * Authored without a type (`kind: ballType` and no `ballType`), because the
 * right one depends entirely on which maps the block turned out to contain.
 * Returns the assignment with its bounty named, unchanged if it is not a bounty
 * at all, and NULL when no type in the block covers the top tier - the caller
 * drops it from the draft rather than offering a mission that cannot be paid.
 */
export function resolveBountyForBlock(
  a: AssignmentConfig, levels: readonly LevelConfig[], fromLevel: number,
): AssignmentConfig | null {
  const track = a.mission?.track;
  if (!track || track.kind !== "ballType") return a;

  const tiers = a.mission.tiers;
  if (tiers.length === 0) return null;

  const spread = blockBallTypeSpread(levels, fromLevel);
  if (spread.size === 0) return null;          // no roster at all: unplayable

  // Cap the ask at what the block's best-covered type can actually deliver.
  //
  // The same argument as the lock scaling above, and measured the same way:
  // authored at "four of five maps" this mission was refused outright in three
  // of the six blocks a run drafts over, because late maps field a WIDER
  // roster spread thinner - L31-35 has seven types and none of them on more
  // than two maps. A fixed threshold cannot survive that, so the author writes
  // the shape and the block places it.
  const scaledTiers = capTiersTo(tiers, Math.max(...spread.values()));
  const topTier = Math.max(...scaledTiers.map(t => t.threshold));
  const mission = { ...a.mission, tiers: scaledTiers };

  // An explicitly authored type is trusted even where the block is thin: it
  // exists so a test or a Daily can pin the bounty, and second-guessing it
  // would make that unpredictable.
  if (track.ballType) return { ...a, mission };

  const picked = pickBountyType(spread, topTier);
  if (!picked) return null;
  return { ...a, mission: { ...mission, track: { ...track, ballType: picked } } };
}

/**
 * Pull a mission's tiers down so its top rung asks for at most `available`.
 *
 * Keeps the author's shape: the same number of rungs at the same relative
 * spacing, floored at 1 and kept strictly ascending so two rungs never collapse
 * onto one number and pay the lower reward for the higher effort. Never scales
 * UP - a generous block should make a mission easier, not move the goalposts.
 */
function capTiersTo(
  tiers: AssignmentConfig["mission"]["tiers"], available: number,
): AssignmentConfig["mission"]["tiers"] {
  const authoredTop = Math.max(...tiers.map(t => t.threshold));
  if (authoredTop <= 0 || available <= 0 || authoredTop <= available) return tiers;
  const factor = available / authoredTop;
  let previous = 0;
  return tiers.map(t => {
    const next = Math.max(1, previous + 1, Math.round(t.threshold * factor));
    previous = next;
    return { ...t, threshold: next };
  });
}

/**
 * The assignments that can actually be run over the block starting at
 * `fromLevel`. Filter the POOL with this before drawing the draft, so a
 * bounty with no eligible type costs the player an offer slot rather than
 * appearing as a mission they cannot clear.
 */
export function assignmentsPlayableInBlock(
  pool: readonly AssignmentConfig[], levels: readonly LevelConfig[], fromLevel: number,
): AssignmentConfig[] {
  return pool.filter(a => resolveBountyForBlock(a, levels, fromLevel) !== null);
}
