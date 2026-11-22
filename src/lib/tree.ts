/**
 * The ball tree (BALL_TREE_PLAN.md phase 3): what the tree stage sells and
 * for how much.
 *
 * Two kinds of thing are bought between maps under the tree rule set:
 *
 *   GENERAL NODES  the `upgrades:` of public/tree.yml, in the catalogue shape
 *                  the modifier pipeline already reads. Owned ones live in
 *                  the run's ownedUpgradeIds like any upgrade; their price is
 *                  the pricing block's, by tier, with no inflation; their
 *                  edges are `prerequisites`. `branch` files them.
 *   THE ROSTER     the balls and their rungs (lib/roster.ts, physics/rungs.ts),
 *                  priced here from the `tree:` block: a rung by its rank and
 *                  by how many rungs the ball already holds (the stack
 *                  factor), a new ball by how many the roster has.
 *
 * The prices bend toward the fork the plan wants: stacking costs more on one
 * ball, breadth costs more per ball, and neither is the discount route to the
 * other.
 */
import type { UpgradeConfig } from "@/types/upgrade";
import { ROSTER_MAX, RUNG_IDS, rungCount, type RosterBall, type RungId, type RungRank } from "@/lib/roster";

export type TreeBranch = "balls" | "fences" | "hands" | "office";
export const TREE_BRANCHES: readonly TreeBranch[] = ["balls", "fences", "hands", "office"];

export interface TreeConfig {
  /** Hours for a rung at rank one, two and three, before stacking. */
  rungBase: [number, number, number];
  /** The next rung on a ball costs this much more per rung the ball already holds. */
  stackFactor: number;
  /** The second ball, then the third; one entry per ball past the first. */
  ballCost: number[];
}

export const DEFAULT_TREE: TreeConfig = {
  rungBase: [15, 30, 45],
  stackFactor: 1.25,
  ballCost: [30, 45],
};

/** Read the `tree:` block of tree.yml over the defaults, field by field. */
export function parseTreeConfig(raw: unknown): TreeConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const base = Array.isArray(r.rungBase) && r.rungBase.length === 3 && r.rungBase.every(n => Number.isFinite(Number(n)) && Number(n) > 0)
    ? (r.rungBase.map(Number) as [number, number, number])
    : DEFAULT_TREE.rungBase;
  const stack = Number.isFinite(Number(r.stackFactor)) && Number(r.stackFactor) >= 1
    ? Number(r.stackFactor)
    : DEFAULT_TREE.stackFactor;
  const balls = Array.isArray(r.ballCost) && r.ballCost.length > 0 && r.ballCost.every(n => Number.isFinite(Number(n)) && Number(n) >= 0)
    ? r.ballCost.map(Number)
    : DEFAULT_TREE.ballCost;
  return { rungBase: base, stackFactor: stack, ballCost: balls };
}

// ── The live tree, set by the catalogue loader ──────────────────────────────

let live: TreeConfig = DEFAULT_TREE;

export function setLiveTree(config: TreeConfig): void {
  live = config;
}

export function getLiveTree(): TreeConfig {
  return live;
}

// ── Prices ──────────────────────────────────────────────────────────────────

/** The next rank this ball may take on a rung: 1 to 3, or null when it holds rank three. */
export function nextRank(ball: RosterBall, rung: RungId): RungRank | null {
  const held = ball.rungs[rung] ?? 0;
  if (held >= 3) {
    return null;
  }
  return (held + 1) as RungRank;
}

/**
 * What the next rank of `rung` costs on `ball`: the rank's base, times the
 * stack factor for every rung the ball already holds. `discount` is the
 * tree's own (Expense Account), as the store's was.
 */
export function rungPrice(ball: RosterBall, rung: RungId, config: TreeConfig = live, discount = 1): number | null {
  const rank = nextRank(ball, rung);
  if (rank === null) {
    return null;
  }
  const base = config.rungBase[rank - 1];
  return Math.max(1, Math.round(base * Math.pow(config.stackFactor, rungCount(ball)) * discount));
}

/** What the next ball costs with `size` balls held, or null at the cap. */
export function ballPrice(size: number, config: TreeConfig = live, discount = 1): number | null {
  if (size >= ROSTER_MAX || size < 1) {
    return null;
  }
  const raw = config.ballCost[Math.min(config.ballCost.length - 1, size - 1)];
  return Math.max(1, Math.round(raw * discount));
}

/** Every rung a ball could take next, priced. */
export function rungOffers(ball: RosterBall, config: TreeConfig = live, discount = 1): { rung: RungId; rank: RungRank; price: number }[] {
  const out: { rung: RungId; rank: RungRank; price: number }[] = [];
  for (const rung of RUNG_IDS) {
    const rank = nextRank(ball, rung);
    const price = rungPrice(ball, rung, config, discount);
    if (rank !== null && price !== null) {
      out.push({ rung, rank, price });
    }
  }
  return out;
}

// ── The general nodes ───────────────────────────────────────────────────────

/** The nodes of one branch, in catalogue order. A node without a branch is nobody's: left out. */
export function nodesOf(branch: TreeBranch, upgrades: readonly UpgradeConfig[]): UpgradeConfig[] {
  return upgrades.filter(u => u.branch === branch);
}

/**
 * The run-start trait: three rank-one rungs, weight always among them because
 * the ladder is bricks, the other two drawn by `pick` from the rest in a
 * fixed order so a seeded run deals the same three.
 */
export function startTraitOffer(pick: () => number): RungId[] {
  const rest = RUNG_IDS.filter(id => id !== "weight");
  const a = rest.splice(Math.floor(pick() * rest.length), 1)[0];
  const b = rest.splice(Math.floor(pick() * rest.length), 1)[0];
  return ["weight", a, b];
}
