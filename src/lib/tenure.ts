/**
 * Tenure (issue #75): the checkpoint replacement.
 *
 * The old system let you resume from level 10/20/30 after a loss. That is gone;
 * this rewards depth instead of restoring it. Get far in a run and the NEXT run
 * opens with a free upgrade, deeper the further you got:
 *
 *   reached 10-19   a Junior
 *   reached 20-29   that Junior AND its Senior
 *   reached 30+     the whole Junior + Senior + Principal chain
 *
 * The full chain is granted, not just the top card, because upgrade modifiers
 * COMPOUND (useActiveModifiers multiplies): Runtime Optimisation owned end to
 * end is 0.95 x 0.90 x 0.85, so handing over the Principal alone would make the
 * 30-level reward weaker than the 20-level one.
 *
 * Selection is by TIER, never by graph position. Three upgrades have no
 * prerequisites yet are not entry-level (`golden_parachute` is a 250h Wizard,
 * `system_architect` an Architect, `technical_debt_senior` a Senior), so a
 * "roots of the prerequisite graph" rule would hand out the most expensive
 * upgrade in the game as a first-tier reward.
 *
 * Where a step has more than one candidate the game picks for the player, which
 * covers both `choiceGroup` alternatives (runtime_optimisation_principal_a/_b)
 * and plain branches in the chain.
 */
import type { UpgradeConfig, UpgradeTier } from "@/types/upgrade";

/** Levels reached in the previous ended run, and the reward each pays. */
export const TENURE_THRESHOLDS = [10, 20, 30] as const;

/** The chain shape a head start walks. Index i is the tier granted at step i. */
export const TENURE_PATH: readonly UpgradeTier[] = ["Junior", "Senior", "Principal"];

/** How many offers the draft screen shows. */
export const TENURE_OFFER_COUNT = 3;

/** A resolved offer: the chain, and exactly which upgrades it would grant. */
export interface TenureOffer {
  /** The Junior at the head of the chain; identifies the offer. */
  headId: string;
  /** Display name of the chain (all tiers share one name). */
  name: string;
  /** The upgrades granted if this offer is taken, lowest tier first. */
  upgrades: UpgradeConfig[];
}

/**
 * How many chain steps the previous run's depth pays for. 0 means no reward.
 * Kept separate from the offer roll so the welcome screen can tease the next
 * threshold without building offers.
 */
export function tenureSteps(levelsReached: number): 0 | 1 | 2 | 3 {
  if (levelsReached >= TENURE_THRESHOLDS[2]) return 3;
  if (levelsReached >= TENURE_THRESHOLDS[1]) return 2;
  if (levelsReached >= TENURE_THRESHOLDS[0]) return 1;
  return 0;
}

/** Levels still needed for the next reward step, or null once fully earned. */
export function levelsToNextTenure(levelsReached: number): number | null {
  for (const t of TENURE_THRESHOLDS) {
    if (levelsReached < t) return t - levelsReached;
  }
  return null;
}

/**
 * Eligible at this depth: not ascension-only, and unlocked by the level the
 * player actually reached. The gate applies to EVERY granted upgrade, so
 * reaching 11 offers only what level 11 had access to, never a later card.
 */
function isAvailable(upgrade: UpgradeConfig, levelsReached: number): boolean {
  if (upgrade.ascensionOnly) return false;
  return (upgrade.unlockLevel ?? 1) <= levelsReached;
}

/** Fisher-Yates, so offers vary per run but stay seedable for Daily parity. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Walk `steps` tiers down from `head`, staying inside the head's FAMILY and
 * choosing randomly whenever the family itself offers more than one option.
 * Returns null when the family cannot pay the required depth, which is how
 * short chains are filtered out.
 *
 * The family constraint is what makes the card honest. The prerequisite graph
 * is not a set of tidy chains: several Seniors are the prerequisite for
 * Principals belonging to entirely different families, so an unconstrained walk
 * hands a card headed "Fast Compile" a third tier of Multithreading, and
 * "Runtime Optimisation" one of MicroManager. The player earned a chain fully
 * upgraded, so the walk stays in that chain and a foreign family is not a
 * candidate, however legal the prerequisite edge is.
 *
 * Every tier of a family shares its `name` (fast_compile_junior/_senior/
 * _principal are all "Fast Compile"), which is what identifies the family here.
 * The remaining forks are genuine same-family alternatives - `choiceGroup` pairs
 * like runtime_optimisation_principal_a/_b - and those are still rolled for the
 * player, since they earned the chain rather than the fork.
 */
function resolveChain(
  head: UpgradeConfig, all: UpgradeConfig[], steps: number,
  levelsReached: number, rng: () => number,
): UpgradeConfig[] | null {
  const path = [head];
  for (let step = 1; step < steps; step++) {
    const wantTier = TENURE_PATH[step];
    const prev = path[path.length - 1];
    const candidates = all.filter(u =>
      u.tier === wantTier
      && (u.prerequisites ?? []).includes(prev.id)
      && u.name === head.name
      && isAvailable(u, levelsReached),
    );
    if (candidates.length === 0) return null;
    path.push(candidates[Math.floor(rng() * candidates.length)]);
  }
  return path;
}

/** Every chain that can pay a head start of this depth, already resolved. */
export function eligibleTenureChains(
  upgrades: UpgradeConfig[], levelsReached: number, rng: () => number,
): TenureOffer[] {
  const steps = tenureSteps(levelsReached);
  if (steps === 0) return [];

  const heads = upgrades.filter(u =>
    u.tier === TENURE_PATH[0]
    && (u.prerequisites ?? []).length === 0
    && isAvailable(u, levelsReached),
  );

  const offers: TenureOffer[] = [];
  for (const head of heads) {
    const chain = resolveChain(head, upgrades, steps, levelsReached, rng);
    if (chain) offers.push({ headId: head.id, name: head.name, upgrades: chain });
  }
  return offers;
}

/**
 * The offers to put in front of the player: up to `count` distinct chains.
 * Re-rolled fresh on every run start, so a retry is a new draw rather than the
 * same three cards.
 */
export function rollTenureOffers(
  upgrades: UpgradeConfig[], levelsReached: number, rng: () => number,
  count: number = TENURE_OFFER_COUNT,
): TenureOffer[] {
  return shuffled(eligibleTenureChains(upgrades, levelsReached, rng), rng).slice(0, count);
}
