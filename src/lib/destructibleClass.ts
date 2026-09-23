/**
 * Shards and Monoliths: the two things a ball can break, told apart.
 *
 * Act I used to have ONE breakable per map, so "breakable" was a complete
 * description and the win clause counting them needed no adjective. It is not
 * one thing any more. The ladder now carries 88 of them in two clusters that
 * do not overlap and never did:
 *
 *   SHARD     pale glass, 728-1320 square units, goes on any single contact,
 *             authored 4 to 34 per map in runs and lines.
 *   MONOLITH  warm amber, 3120-7200 square units, takes three hits of
 *             accumulated damage, authored 1 to 4 per map.
 *
 * The gap between the clusters is a factor of 2.4 with nothing in it, and the
 * manual has always taught the difference in so many words - "Glass bricks go
 * on one touch, amber blocks take a few". The win clause was the one place
 * that did not know: `smashed 5` counted a shard and a monolith the same, so a
 * map with six shards and one monolith asked for five things and gave you six
 * cheap ones to pick from. Nobody would ever break the monolith. Reported as
 * exactly that question.
 *
 * ── Why the class is the break cost and not the size ───────────────────────
 *
 * Measuring the polygon would be the obvious rule and it would be the wrong
 * one: it makes the class an accident of authoring, it needs a threshold to
 * tune, and a map that authored a 2000-unit block would land wherever the
 * threshold happened to sit that month. What actually separates the two is
 * what the player has to DO. A shard costs one incidental contact - a ball on
 * its way somewhere else does it for you. A monolith costs three deliberate
 * drives, which is a plan, a region held open, and a ball steered into it.
 *
 * That is `brittle`, which the engine already keys the damage model off
 * (destructibles.applyDamage: `if (d.brittle) amount = d.maxHits`). So the
 * class is not a new fact about the board. It is the fact the board already
 * had, given a name the win clause can ask for.
 *
 * One function owns the rule, in the shape entityIsDestructible already uses:
 * everything that asks gets the same answer, and a third class (if the ladder
 * ever grows one) changes this file and nothing else.
 */
import type { DestructibleState } from "@/types/game";
import type { SmashCounts } from "@/types/winSpec";

/**
 * The two classes, and the wildcard the clause needs.
 *
 * `any` is not a class a destructible can BE - it is what a clause says when
 * it does not care, which is what every clause authored before this file said
 * by omission. Kept in the same union so the clause has one field rather than
 * an optional field plus a boolean.
 */
export type DestructibleClass = "shards" | "monoliths";
export type SmashClassFilter = DestructibleClass | "any";

/** What the clause means when the author did not say. See `of` on `smashed`. */
export const DEFAULT_SMASH_CLASS: SmashClassFilter = "any";

/** Every class, in the order admin and the guidelines list them. */
export const DESTRUCTIBLE_CLASSES: DestructibleClass[] = ["shards", "monoliths"];

/** Every value the clause's `of` may take. */
export const SMASH_CLASS_FILTERS: SmashClassFilter[] = ["any", ...DESTRUCTIBLE_CLASSES];

/** The class this breakable belongs to. */
export function destructibleClass(
  d: Pick<DestructibleState, "brittle">,
): DestructibleClass {
  return d.brittle ? "shards" : "monoliths";
}

/**
 * Does this breakable answer a clause asking for `want`?
 *
 * Mirrors and movers never reach here: the callers filter on
 * `kind === "breakable"` first, on the same rule the Engagement axis uses -
 * they are destructible too, and they are scenery a ball happens to hit rather
 * than a thing the player set out to do.
 */
export function matchesSmashClass(
  d: Pick<DestructibleState, "brittle">,
  want: SmashClassFilter | undefined,
): boolean {
  const filter = want ?? DEFAULT_SMASH_CLASS;
  return filter === "any" || destructibleClass(d) === filter;
}

/**
 * Which classes a board actually contains, so a caller can tell a map that
 * mixes them from one that does not.
 *
 * Destroyed ones still count. The question this answers is "what is this map
 * MADE of", which is a fact about the authored board and must not change
 * halfway through a run - a mixed map whose last monolith has just been broken
 * is still a mixed map, and a win clause that started ambiguous does not
 * become unambiguous because the player resolved it.
 */
export function classesPresent(
  ds: readonly Pick<DestructibleState, "brittle" | "kind">[],
): Set<DestructibleClass> {
  const out = new Set<DestructibleClass>();
  for (const d of ds) {
    if (d.kind !== "breakable") continue;
    out.add(destructibleClass(d));
  }
  return out;
}

/**
 * Count the destroyed breakables on a board, by class.
 *
 * Derived from the runtime list rather than from counters kept alongside it,
 * for the reason the single `smashed` count already was: a destroyed
 * destructible is not spliced out, it stays with `destroyed: true`, so the
 * whole tally comes from one place and cannot drift from a path that forgot to
 * bump it. Three numbers now instead of one, built in a single pass.
 */
export function smashCounts(
  ds: readonly Pick<DestructibleState, "brittle" | "kind" | "destroyed">[],
): SmashCounts {
  const out: SmashCounts = { any: 0, shards: 0, monoliths: 0 };
  for (const d of ds) {
    if (d.kind !== "breakable" || !d.destroyed) continue;
    out.any++;
    out[destructibleClass(d)]++;
  }
  return out;
}

/** Nothing smashed yet. A fresh board, and what a snapshot fixture wants. */
export function noSmashes(): SmashCounts {
  return { any: 0, shards: 0, monoliths: 0 };
}
