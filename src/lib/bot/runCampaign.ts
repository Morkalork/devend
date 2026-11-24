/**
 * A whole run under the ball tree, played by one bot player (archetypes.ts).
 *
 * runBot plays one map. This plays a run the way the browser does: the first
 * ball's trait from the run-start offer, then map after map with the roster
 * and the build bought so far, lives carried from map to map, a lost map
 * costing a life and played again, the map's pay banked, the tree stage's
 * interest paid, and the archetype shopping between maps. The run ends when
 * the lives do or the ladder does.
 *
 * Pure apart from the module state the engine itself reads (the rule set and
 * the roster), which is set for the run and put back after it.
 */
import type { LevelConfig } from "@/types/level";
import type { UpgradeConfig, UpgradePricing } from "@/types/upgrade";
import { runBot } from "./runBot";
import { seededRandom } from "./policy";
import { pickTrait, withPathWants, type Archetype, type ShopView, type TreeOffer } from "./archetypes";
import { computeGameModifiers, type GameModifiers } from "@/hooks/useActiveModifiers";
import { mapContextOf } from "@/lib/upgradeConditions";
import { resolveUpgradeCost } from "@/lib/upgradePricing";
import { ballPrice, rungOffers, startTraitOffer, type TreeConfig } from "@/lib/tree";
import { getActiveRoster, setActiveRoster, ROSTER_MAX, type Roster, type RungId, type RungRank } from "@/lib/roster";
import { getActiveRuleSet, setActiveRuleSet } from "@/lib/cardRules";
import { getMapTimeLimit } from "@/lib/mapTiming";
import { storeInterest } from "@/lib/offerPerks";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { DEFAULT_BUG_CONFIG } from "@/types/bugs";
import { DEFAULT_PICKUP_CONFIG } from "@/types/pickups";
import type { MapFailKind } from "@/lib/mapFailure";

/** A run starts with three lives, as the browser's does. */
export const CAMPAIGN_LIVES = 3;
/** A map with no clock of its own is given up after this much play. */
const UNTIMED_SECONDS = 120;

export interface CampaignCatalogue {
  nodes: readonly UpgradeConfig[];
  tree: TreeConfig;
  pricing: UpgradePricing;
}

export interface CampaignOptions {
  /** Stop after this many maps (the whole ladder otherwise). */
  maxMaps?: number;
  /**
   * Practice: lives never end the run. Each map gets `attemptsPerMap` tries;
   * a map still lost after them is skipped without pay and the run goes on.
   * So every player reaches every map and a build grows over the whole
   * ladder, which is how strategies are compared while the bot is too weak to
   * survive a real run.
   */
  endless?: boolean;
  /** Tries per map in practice (default 3). */
  attemptsPerMap?: number;
}

export interface MapAttempt {
  level: number;
  won: boolean;
  failKind?: MapFailKind;
  seconds: number;
  pay: number;
  livesLost: number;
}

export interface Purchase {
  /** Bought after clearing this map (0 = the run-start trait). */
  afterMap: number;
  what: string;
  price: number;
}

export interface CampaignResult {
  archetype: string;
  seed: number;
  /** Played in practice (CampaignOptions.endless). */
  endless: boolean;
  /** Maps won. In a real run these are the first ones in order; in practice, any. */
  mapsCleared: number;
  /** Maps given up on in practice after every try failed. */
  mapsSkipped: number;
  /** Lives spent over the whole run, whatever the mode. */
  livesSpent: number;
  /** The whole ladder was cleared. */
  finished: boolean;
  /** The map the run ended on (or the last one, on a finish). */
  endedOn: number;
  /** How the run ended when it did not finish. */
  endedBy?: MapFailKind | "outOfLives";
  livesLeft: number;
  hoursEarned: number;
  hoursSpent: number;
  interestEarned: number;
  attempts: MapAttempt[];
  purchases: Purchase[];
  roster: Roster;
  owned: string[];
  fence: string | null;
}

/** A tree node may be bought once everything it hangs off is owned. */
export function nodeUnlocked(node: UpgradeConfig, owned: ReadonlySet<string>): boolean {
  const needs = [...(node.prerequisites ?? []), ...(node.upgradeOf ? [node.upgradeOf] : [])];
  return needs.every(id => owned.has(id));
}

/** Everything the tree stage would show for sale right now, priced. */
export function treeOffers(
  roster: Roster, owned: ReadonlySet<string>, catalogue: CampaignCatalogue, discount: number,
): TreeOffer[] {
  const out: TreeOffer[] = [];
  const next = ballPrice(roster.length, catalogue.tree, discount);
  if (next !== null && roster.length < ROSTER_MAX) {
    out.push({ kind: "ball", price: next });
  }
  for (const ball of roster) {
    for (const o of rungOffers(ball, catalogue.tree, discount)) {
      out.push({ kind: "rung", slot: ball.slot, rung: o.rung, rank: o.rank, price: o.price });
    }
  }
  for (const node of catalogue.nodes) {
    if (!node.branch || owned.has(node.id) || !nodeUnlocked(node, owned)) {
      continue;
    }
    const price = Math.max(1, Math.round((resolveUpgradeCost(node, catalogue.pricing) ?? 0) * discount));
    out.push({ kind: "node", id: node.id, price });
  }
  return out;
}

/** What an offer reads as in a purchase log. */
export function offerLabel(offer: TreeOffer): string {
  if (offer.kind === "ball") {
    return "ball";
  }
  if (offer.kind === "rung") {
    return `ball ${offer.slot}: ${offer.rung} ${offer.rank}`;
  }
  return offer.id;
}

/**
 * One visit to the tree stage: buy the archetype's best affordable want, again
 * and again. A patient archetype stops at the first want it cannot afford.
 * Returns the purchases; mutates nothing it was handed.
 */
export function shopVisit(
  archetype: Archetype,
  start: { hours: number; roster: Roster; owned: ReadonlySet<string> },
  catalogue: CampaignCatalogue,
  mapsCleared: number,
  rng: () => number,
  modifiersFor: (owned: ReadonlySet<string>) => GameModifiers,
): { hours: number; roster: Roster; owned: Set<string>; bought: { offer: TreeOffer; label: string }[] } {
  let hours = start.hours;
  let roster: Roster = start.roster.map(b => ({ ...b, rungs: { ...b.rungs } }));
  const owned = new Set(start.owned);
  const nodes = new Map(catalogue.nodes.map(n => [n.id, n]));
  const bought: { offer: TreeOffer; label: string }[] = [];

  // Bounded: a visit cannot buy more than everything there is.
  for (let guard = 0; guard < 64; guard++) {
    const discount = modifiersFor(owned).shopDiscountMultiplier || 1;
    const view: ShopView = { hours, roster, owned, mapsCleared, nodes, rng };
    const score = withPathWants(archetype, nodes, owned);
    const ranked = treeOffers(roster, owned, catalogue, discount)
      .map(offer => ({ offer, want: score(offer, view) }))
      .filter(x => x.want > 0)
      .sort((a, b) => b.want - a.want);
    if (ranked.length === 0) {
      break;
    }
    if (archetype.patient && ranked[0].offer.price > hours) {
      break;
    }
    const pick = ranked.find(x => x.offer.price <= hours);
    if (!pick) {
      break;
    }
    const offer = pick.offer;
    hours -= offer.price;
    if (offer.kind === "ball") {
      roster = [...roster, { slot: roster.length + 1, rungs: {} }];
    } else if (offer.kind === "rung") {
      roster = roster.map(b => b.slot !== offer.slot ? b : { ...b, rungs: { ...b.rungs, [offer.rung]: offer.rank as RungRank } });
    } else {
      owned.add(offer.id);
    }
    bought.push({ offer, label: offerLabel(offer) });
  }
  return { hours, roster, owned, bought };
}

/** The fence an archetype draws with: its first preference the build has granted. */
export function fenceFor(archetype: Archetype, owned: ReadonlySet<string>, nodes: readonly UpgradeConfig[]): string | null {
  const granted = new Set(nodes.filter(n => owned.has(n.id) && n.grantsFenceType).map(n => n.grantsFenceType!));
  return archetype.fences.find(f => granted.has(f)) ?? null;
}

/**
 * Play one run. `levels` is the ladder in order; map numbers are 1-based
 * positions in it. Seeded: the same archetype, seed and ladder replay the
 * same run.
 */
export function runCampaign(
  archetype: Archetype,
  levels: readonly LevelConfig[],
  catalogue: CampaignCatalogue,
  seed: number,
  opts: CampaignOptions = {},
): CampaignResult {
  const rng = seededRandom(seed * 7919 + 17);
  const lookup = new Map(catalogue.nodes.map(n => [n.id, n]));
  const maxMaps = Math.min(levels.length, opts.maxMaps ?? levels.length);
  const endless = opts.endless === true;
  const tries = Math.max(1, opts.attemptsPerMap ?? 3);

  const prevRules = getActiveRuleSet();
  const prevRoster = getActiveRoster();
  setActiveRuleSet("tree");

  const trait: RungId = pickTrait(archetype, startTraitOffer(rng));
  let roster: Roster = [{ slot: 1, rungs: { [trait]: 1 } }];
  let owned = new Set<string>();
  let hours = 0;
  let lives = CAMPAIGN_LIVES;
  let earned = 0;
  let spent = 0;
  let interestEarned = 0;
  let cleared = 0;
  let skipped = 0;
  let livesSpent = 0;
  let lastPlayed = 0;
  let endedBy: CampaignResult["endedBy"];
  const attempts: MapAttempt[] = [];
  const purchases: Purchase[] = [{ afterMap: 0, what: `ball 1: ${trait} 1 (start)`, price: 0 }];

  const modifiersFor = (have: ReadonlySet<string>, mapIndex = lastPlayed) => computeGameModifiers(
    [...have], lookup, undefined,
    { level: mapIndex + 1, lives, banked: hours, map: mapContextOf(levels[Math.min(mapIndex, levels.length - 1)]) },
  );

  try {
    for (let i = 0; i < maxMaps && (endless || lives > 0); i++) {
      const level = levels[i];
      const n = i + 1;
      const limit = getMapTimeLimit(level, n);
      const maxFrames = Math.ceil(((limit ?? UNTIMED_SECONDS) + 5) / PHYSICS_STEP);
      let won = false;
      lastPlayed = n;
      for (let attempt = 0; !won && (endless ? attempt < tries : lives > 0); attempt++) {
        setActiveRoster(roster);
        const modifiers = modifiersFor(owned, i);
        const r = runBot(level, n, seed * 1000 + n * 10 + attempt, {
          // In practice the board still plays real lives within a map, from a full set.
          modifiers, maxFrames, lives: endless ? CAMPAIGN_LIVES : lives,
          bugs: DEFAULT_BUG_CONFIG, pickups: DEFAULT_PICKUP_CONFIG,
          useFreezes: true,
          fenceTypeId: fenceFor(archetype, owned, catalogue.nodes) ?? undefined,
        });
        won = r.won;
        // A map that ran out of play without the game saying why still cost
        // the attempt: the browser's clock would have.
        const cost = won ? r.livesLost : Math.max(1, r.livesLost);
        livesSpent += cost;
        if (!endless) {
          lives -= cost;
        }
        attempts.push({
          level: n, won, failKind: r.failKind, seconds: +(r.frames * PHYSICS_STEP).toFixed(1),
          pay: won ? r.levelScore : 0, livesLost: cost,
        });
        if (won) {
          hours += r.levelScore;
          earned += r.levelScore;
        } else if (!endless && lives <= 0) {
          endedBy = r.failKind ?? "outOfLives";
        }
      }
      if (!won && !endless) {
        break;
      }
      if (won) {
        cleared += 1;
      } else {
        skipped += 1;
      }
      if (n >= maxMaps) {
        break;
      }
      // The tree stage: interest on arrival, then the archetype shops.
      const interest = storeInterest(hours, modifiersFor(owned).shopInterestPercent);
      hours += interest;
      interestEarned += interest;
      const livesBefore = modifiersFor(owned).extraLives ?? 0;
      const visit = shopVisit(archetype, { hours, roster, owned }, catalogue, n, rng, have => modifiersFor(have));
      spent += hours - visit.hours;
      hours = visit.hours;
      roster = visit.roster;
      owned = visit.owned;
      // An extra life arrives with the node that grants it, as grantUpgrades does.
      lives += Math.max(0, Math.round((modifiersFor(owned).extraLives ?? 0) - livesBefore));
      for (const b of visit.bought) {
        purchases.push({ afterMap: n, what: b.label, price: b.offer.price });
      }
    }
  } finally {
    setActiveRuleSet(prevRules);
    setActiveRoster(prevRoster);
  }

  const finished = endless ? lastPlayed >= maxMaps : cleared >= maxMaps;
  return {
    archetype: archetype.id,
    seed,
    endless,
    mapsCleared: cleared,
    mapsSkipped: skipped,
    livesSpent,
    finished,
    endedOn: endless ? lastPlayed : Math.min(maxMaps, cleared + 1),
    endedBy: finished ? undefined : (endedBy ?? "outOfLives"),
    livesLeft: Math.max(0, lives),
    hoursEarned: earned,
    hoursSpent: spent,
    interestEarned,
    attempts,
    purchases,
    roster,
    owned: [...owned],
    fence: fenceFor(archetype, owned, catalogue.nodes),
  };
}
