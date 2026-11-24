/**
 * Bot players: six ways to spend a run under the ball tree (BOT_PLAYERS.md).
 *
 * The bot's hands are the same for all of them (policy.ts: where to cut, when
 * to freeze). What differs is the build: which trait the first ball takes,
 * what is bought at the tree stage between maps, and which fence is drawn. So
 * a sweep of the six over a ladder says how each STRATEGY fares on it, and a
 * map that only one of them can clear says so.
 *
 * Each archetype scores what the tree is offering; the shop buys the best it
 * can afford, again and again, until nothing it wants is affordable. A
 * PATIENT archetype stops at the first thing it wants but cannot afford yet
 * and saves for it, rather than spending down on its second choices.
 *
 * Everything an archetype names is a real tree id or rung: botArchetypes.test
 * holds the tables against public/tree.yml, so a renamed node fails a test
 * instead of quietly dropping out of a build.
 */
import type { UpgradeConfig } from "@/types/upgrade";
import { RUNG_IDS, rungCount, type Roster, type RungId } from "@/lib/roster";

/** Something the tree stage sells, priced for this visit. */
export type TreeOffer =
  | { kind: "ball"; price: number }
  | { kind: "rung"; slot: number; rung: RungId; rank: number; price: number }
  | { kind: "node"; id: string; price: number };

/** What an archetype can see when it shops. */
export interface ShopView {
  hours: number;
  roster: Roster;
  owned: ReadonlySet<string>;
  /** 1-based number of the map just cleared. */
  mapsCleared: number;
  /** The tree's nodes by id, for an archetype that reads a node's branch or tier. */
  nodes: ReadonlyMap<string, UpgradeConfig>;
  /** Seeded, for the archetype that chooses at random. */
  rng: () => number;
}

export interface Archetype {
  id: string;
  name: string;
  /** One line: what this player is going for. */
  plan: string;
  /** The run-start trait, first choice first; the offer always holds weight. */
  traits: readonly RungId[];
  /** Fence types to draw, first owned one wins; the standard fence otherwise. */
  fences: readonly string[];
  /** Save for the top want rather than spend down on lesser ones. */
  patient: boolean;
  /** How much this player wants an offer; 0 or less is "never". */
  score: (offer: TreeOffer, view: ShopView) => number;
}

/** A node table: ids the archetype wants, and how much. */
type NodeWants = Record<string, number>;

const nodeScore = (wants: NodeWants, offer: TreeOffer): number =>
  offer.kind === "node" ? (wants[offer.id] ?? 0) : 0;

/** Rungs by preference, as a score; later ranks of a preferred rung still beat a new weak one. */
const rungScore = (prefs: Partial<Record<RungId, number>>, offer: TreeOffer): number =>
  offer.kind === "rung" ? (prefs[offer.rung] ?? 0) : 0;

// ── The six ─────────────────────────────────────────────────────────────────

/** Balls first, as many as the tree sells, then strength spread across all of them. */
const FLEET: Archetype = {
  id: "fleet",
  name: "Fleet",
  plan: "Buys every ball as soon as it can, then spreads rungs evenly across the fleet: weight for bricks, worth for pay.",
  traits: ["weight", "worth", "pace"],
  fences: [],
  patient: true,
  score: (offer, view) => {
    if (offer.kind === "ball") {
      return 100;
    }
    if (offer.kind === "rung") {
      const ball = view.roster.find(b => b.slot === offer.slot);
      // Breadth: the ball with the fewest rungs is served first.
      const spread = 20 - 6 * (ball ? rungCount(ball) : 0);
      return spread + rungScore({ weight: 40, worth: 34, grace: 26, pace: 20, frost: 12, sight: 6 }, offer);
    }
    return 0;
  },
};

/** One ball, made as strong as the tree allows. */
const SUPER_BALL: Archetype = {
  id: "superball",
  name: "Super Ball",
  plan: "Never buys a second ball. Every hour goes into the first one: weight, worth and grace to rank three, then the rest.",
  traits: ["weight", "worth", "grace"],
  fences: [],
  patient: true,
  score: (offer) => {
    if (offer.kind !== "rung" || offer.slot !== 1) {
      return 0;
    }
    return rungScore({ weight: 60, worth: 55, grace: 50, pace: 40, frost: 25, sight: 10 }, offer);
  },
};

/** The fences branch: faster, more at once, then the special fences. */
const FENCER: Archetype = {
  id: "fencer",
  name: "Fence Engineer",
  plan: "The fences branch: build speed, fences at once and head starts first, then the Guardrail and the Tripwire to draw with.",
  traits: ["weight", "grace", "pace"],
  fences: ["tripwire", "guardrail"],
  patient: false,
  score: (offer) => nodeScore({
    fast_compile: 100, multithreading: 92, hot_start: 88, fast_compile_plus: 84,
    scaffolding: 78, multithreading_plus: 74, add_guardrails: 64, crash_barrier: 52,
    hotfix_tripwire: 58, tensioned_wire: 40, cold_storage_ice: 30, incident_flare: 26,
  }, offer),
};

/** Overtime first, then a moderate mix bought out of the bigger purse. */
const EARNER: Archetype = {
  id: "earner",
  name: "Overtime Earner",
  plan: "The office branch's pay first (Performance Bonus, its +, Compound Interest, Expense Account), then a moderate mix: a second ball, a rung or two, a fence and a freeze.",
  traits: ["worth", "weight", "pace"],
  fences: [],
  patient: true,
  score: (offer, view) => {
    const economy = nodeScore({
      performance_bonus: 100, performance_bonus_plus: 92, compound_interest: 86,
      ship_early: 60, expense_account: 80,
    }, offer);
    if (economy > 0) {
      return economy;
    }
    // The mix: modest wants, cheapest first, and never so much of one thing
    // that it stops being a mix.
    const cheap = (price: number) => Math.max(1, 40 - price / 3);
    if (offer.kind === "ball") {
      return view.roster.length < 2 ? cheap(offer.price) + 8 : 0;
    }
    if (offer.kind === "rung") {
      return offer.rank <= 2 && (offer.rung === "worth" || offer.rung === "weight") ? cheap(offer.price) : 0;
    }
    if (["fast_compile", "multithreading", "feature_freeze", "defensive_programming"].includes(offer.id)) {
      return cheap(offer.price);
    }
    return 0;
  },
};

/** Survive first: freezes, shields, lives, and grace on every ball. */
const GUARDIAN: Archetype = {
  id: "guardian",
  name: "Safe Hands",
  plan: "Survival: Feature Freeze, shields, extra lives, grace on every ball and the Guardrail fence. Slow and hard to kill.",
  traits: ["grace", "pace", "weight"],
  fences: ["guardrail"],
  patient: false,
  score: (offer) => {
    if (offer.kind === "rung") {
      return rungScore({ grace: 75, pace: 55, frost: 30, weight: 25 }, offer);
    }
    return nodeScore({
      feature_freeze: 100, defensive_programming: 95, fault_tolerance: 90,
      defensive_programming_plus: 85, fault_tolerance_2: 80, feature_freeze_plus: 50,
      add_guardrails: 45, crash_barrier: 40,
    }, offer);
  },
};

/** No plan: whatever is affordable, at random. The baseline the others are read against. */
const CASUAL: Archetype = {
  id: "casual",
  name: "Casual",
  plan: "No plan: buys something affordable at random every visit. The baseline the other five are measured against.",
  traits: ["weight", "worth", "frost", "pace", "sight", "grace"],
  fences: ["guardrail", "tripwire", "ice", "flare"],
  patient: false,
  score: (_offer, view) => 1 + view.rng() * 10,
};

export const ARCHETYPES: readonly Archetype[] = [FLEET, SUPER_BALL, FENCER, EARNER, GUARDIAN, CASUAL];

export function archetypeById(id: string): Archetype | undefined {
  return ARCHETYPES.find(a => a.id === id);
}

// ── Shared logic ────────────────────────────────────────────────────────────

/** The trait an archetype takes from a run-start offer. */
export function pickTrait(archetype: Archetype, offer: readonly RungId[]): RungId {
  for (const t of archetype.traits) {
    if (offer.includes(t)) {
      return t;
    }
  }
  return offer[0] ?? RUNG_IDS[0];
}

/**
 * A locked node's prerequisites inherit most of what it is wanted for, so an
 * archetype that names only the node it wants still walks the path to it.
 * Transitive, each step a little less, so the nearer step is bought first.
 */
export function withPathWants(
  archetype: Archetype, nodes: ReadonlyMap<string, UpgradeConfig>, owned: ReadonlySet<string>,
): Archetype["score"] {
  return (offer, view) => {
    const own = archetype.score(offer, view);
    if (offer.kind !== "node") {
      return own;
    }
    let inherited = 0;
    // Everything this offer is a step towards: nodes that require it and are
    // not owned yet, scored by the archetype as if they were on sale.
    const seen = new Set<string>();
    const climb = (id: string, factor: number) => {
      for (const n of nodes.values()) {
        if (owned.has(n.id) || seen.has(n.id)) {
          continue;
        }
        const needs = [...(n.prerequisites ?? []), ...(n.upgradeOf ? [n.upgradeOf] : [])];
        if (!needs.includes(id)) {
          continue;
        }
        seen.add(n.id);
        const want = archetype.score({ kind: "node", id: n.id, price: offer.price }, view);
        inherited = Math.max(inherited, want * factor);
        climb(n.id, factor * 0.9);
      }
    };
    climb(offer.id, 0.9);
    return Math.max(own, inherited);
  };
}
