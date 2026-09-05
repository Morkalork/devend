/**
 * ENGAGEMENT: did you actually operate what this map put on the board?
 *
 * ── The report this answers ────────────────────────────────────────────────
 *
 * "For the first nine maps you can just do two quick locks and get full score.
 * There needs to be something more than just locking on each map."
 *
 * That was true, and it was structural rather than a tuning miss. The five
 * original axes measure how you LOCKED (delivery, craft) and how you spent the
 * clock and the fences doing it (tempo, thrift, greed). Not one of them looks
 * at the map. A board with a vault, a marked zone and a wired circuit on it
 * scored exactly the same as an empty room, provided you sealed the balls with
 * the same efficiency - so every mechanic the ladder introduces was, to the
 * scorer, decoration.
 *
 * ── Why a mean of families rather than one big pool ────────────────────────
 *
 * The obvious implementation adds everything up: hits smashed plus terminals
 * lit plus zones locked, over the same totals. It is wrong, because those units
 * are not commensurable. Level 25 has a 40-hit slab; level 18 has three
 * terminals. Pooled, the slab is thirteen terminals' worth of "engagement" and
 * a map's score would be decided by which mechanic it happened to draw.
 *
 * So each FAMILY banks its own 0..1, and the axis is the mean over the families
 * the map actually offers. The reading is "engage with each thing this map put
 * out", which is what the ask was: not destructibles specifically, but whatever
 * causes a different type of play.
 *
 * ── What counts as a family ────────────────────────────────────────────────
 *
 * Only mechanics with a PLAYER ACTION that can be observed as done or not done.
 * Smash it, lock a ball in it, wire it, harvest it, deliver into it. Movers,
 * gravity wells, mirrors, portals and one-ways are terrain: you play around
 * them, and there is no state that says whether you "engaged" with a wall that
 * bounced a ball. Counting them would mean paying for weather.
 *
 * Breakables are weighted by their authored hits, because within that family
 * the units DO commensurate: a 40-hit slab is most of a map's breaking and a
 * 2-hit chest cover is a detail.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";
import { deliveredCount } from "@/lib/physics/deliveryBox";

/** One family's progress: what you did, out of what the map offered. */
export interface EngagementFamily {
  key: "breakables" | "zones" | "circuit" | "stream" | "boxes";
  done: number;
  offered: number;
}

export interface EngagementProgress {
  /** Mean of the offered families' ratios, 0..1. Zero when nothing is offered. */
  ratio: number;
  /** False when this map offers no engageable feature at all: the axis is then
   *  not offered either, and the overlay draws no lane for it. */
  offered: boolean;
  families: EngagementFamily[];
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const ratioOf = (f: EngagementFamily) => (f.offered > 0 ? clamp01(f.done / f.offered) : 0);

/**
 * The breakable family, weighted by authored hits.
 *
 * Derived from the destructible list rather than counted as things break. A
 * destroyed breakable stays in the list with `destroyed: true`, so both halves
 * read off one place - and a running counter would be a second copy of the same
 * fact, kept in step by every path that can break something (a ball, a black
 * ball, a map beat, a charge, a topple). One of those forgetting to increment
 * is a silent scoring bug; this cannot have one.
 *
 * BREAKABLES ONLY. Mirrors and movers are destructible too, but only by the
 * black ball, which unlocks at level 25 - counting them would put part of the
 * axis behind a roster roll on every earlier map.
 */
export function breakableProgress(
  destructibles: Pick<DestructibleState, "kind" | "maxHits" | "destroyed">[] | undefined,
): EngagementFamily {
  let done = 0, offered = 0;
  // Tolerates a missing list rather than trusting one: this runs on the
  // map-completion path, where a throw does not lose a score, it loses the
  // finished MAP with nothing on screen to say why.
  if (Array.isArray(destructibles)) {
    for (const d of destructibles) {
      if (d.kind !== "breakable") continue;
      const hits = Number.isFinite(d.maxHits) && d.maxHits > 0 ? d.maxHits : 1;
      offered += hits;
      if (d.destroyed) done += hits;
    }
  }
  return { key: "breakables", done, offered };
}

/**
 * Every family this map offers, and how far each got.
 *
 * A family with nothing on the board is left OUT rather than scored as zero:
 * "this map has no circuit" and "you ignored the circuit" are different facts,
 * and averaging the first as a zero would punish a map for what it does not
 * contain.
 */
export function engagementProgress(game: Partial<CanvasGameState>): EngagementProgress {
  const families: EngagementFamily[] = [];

  const breakables = breakableProgress(game.destructibles);
  if (breakables.offered > 0) families.push(breakables);

  // Zones: one ball locked inside each marked area is the whole ask. Capped per
  // area rather than counting every lock, so a map cannot be farmed by sealing
  // four balls in one box while ignoring the other.
  const areas = game.coloredAreas ?? [];
  if (areas.length > 0) {
    families.push({ key: "zones", done: Math.min(areas.length, game.zoneLockCount ?? 0), offered: areas.length });
  }

  const terminals = game.circuit?.terminals ?? [];
  if (terminals.length > 0) {
    families.push({ key: "circuit", done: terminals.filter(t => t.lit).length, offered: terminals.length });
  }

  const seams = game.dataStream?.harvested ?? [];
  if (seams.length > 0) {
    families.push({ key: "stream", done: seams.filter(Boolean).length, offered: seams.length });
  }

  const boxes = game.deliveryBoxes ?? [];
  if (boxes.length > 0) {
    families.push({
      key: "boxes",
      done: Math.min(boxes.length, deliveredCount(game as CanvasGameState)),
      offered: boxes.length,
    });
  }

  if (families.length === 0) return { ratio: 0, offered: false, families };
  const ratio = families.reduce((sum, f) => sum + ratioOf(f), 0) / families.length;
  return { ratio: clamp01(ratio), offered: true, families };
}
