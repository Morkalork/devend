/**
 * Descope: delete one obstacle from the map, for good.
 *
 * The counterpart to Scope Creep, and the bluntest ability in the game. Where
 * Slow Area changes how a part of the board BEHAVES, this changes what the board
 * IS: the obstacle's footprint stops being wall and becomes capturable space,
 * which is both the reward and the cost, since the pocket it used to form goes
 * with it.
 *
 * It reuses the destroy pipeline a black ball and a Deploy Charge already run
 * through (detach, reopen the footprint, topple whatever rested on it, rebuild
 * the regions, repaint). Doing it any other way would mean a second removal path
 * with its own opinion about grid cells and region ownership, which is exactly
 * the kind of divergence that produces obstacles that are gone but still solid.
 *
 * ── What cannot be descoped, and why ───────────────────────────────────────
 *
 * OBJECTIVES. A map whose objective is "smash the hardened cache" would become
 * a map with no cache, and either the objective is unmeetable or it is met by
 * deleting the work. Neither is a game. You may not descope the actual job.
 *
 * CHESTS. Their reward is granted by SMASHING them, so deleting one would
 * silently destroy something the player was owed. Refusing is honest; granting
 * the loot would quietly turn this into "open any chest for free", which is a
 * different and much stronger ability than the one on the card.
 *
 * A tap that lands on either, or on nothing, spends no charge.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";
import { pointInPolygon } from "@/lib/polygon";
import { findObstacleDestructibleById, findMoverDestructible } from "@/lib/physics/destructibles";

/** Why a tap did not remove anything, for feedback and for tests. */
export type DescopeRefusal = "none" | "objective" | "chest" | "already";

export interface DescopeTarget {
  id: string;
  /** The existing destructible, when the obstacle already had one. */
  destructible?: DestructibleState;
  /** The obstacle's polygon, for synthesising one when it did not. */
  polygon: { vertices: { x: number; y: number }[] };
  kind: "obstacle" | "mover";
}

/**
 * The obstacle under a world point, or null.
 *
 * Movers are searched FIRST. A mover patrolling across a static obstacle
 * overlaps it, and the mover is the thing drawn on top and the thing the player
 * is pointing at; resolving to the wall underneath would delete something they
 * cannot even see at that moment.
 */
export function findDescopeTarget(
  game: CanvasGameState, x: number, y: number,
): DescopeTarget | null {
  const p = { x, y };

  for (const m of game.movers ?? []) {
    if (!m.polygon || m.polygon.vertices.length < 3) continue;
    if (!pointInPolygon(p, m.polygon)) continue;
    return {
      id: m.id,
      destructible: findMoverDestructible(game, m.id),
      polygon: m.polygon,
      kind: "mover",
    };
  }

  for (const so of game.stackObjects ?? []) {
    if (so.toppled) continue;
    if (!so.polygon || so.polygon.vertices.length < 3) continue;
    if (!pointInPolygon(p, so.polygon)) continue;
    return {
      id: so.id,
      destructible: findObstacleDestructibleById(game, so.id),
      polygon: so.polygon,
      kind: "obstacle",
    };
  }

  return null;
}

/** May this target be removed, or why not? */
export function descopeRefusal(t: DescopeTarget | null): DescopeRefusal | null {
  if (!t) return "none";
  const d = t.destructible;
  if (!d) return null;                       // a plain wall: always removable
  if (d.destroyed) return "already";
  if (d.chest) return "chest";
  if (d.objective) return "objective";
  return null;
}

/**
 * Remove the obstacle at a world point. Returns true when something was queued
 * for destruction, false when the tap hit nothing removable.
 *
 * False must mean NO CHARGE SPENT at the call site: a miss that costs a charge
 * is the worst outcome this ability can have, because the player cannot see the
 * hit boxes and a near-miss on a thin wall would feel like theft.
 */
export function descopeAt(game: CanvasGameState, x: number, y: number): boolean {
  const target = findDescopeTarget(game, x, y);
  if (descopeRefusal(target) !== null) return false;
  const t = target as DescopeTarget;

  let dest = t.destructible;
  if (!dest) {
    // A plain wall has no destructible, because nothing could ever break it.
    // Synthesise one so it travels the same pipeline as everything else rather
    // than getting a bespoke removal path of its own. Registered on the game so
    // later lookups by id find it and cannot queue it a second time.
    dest = {
      id: t.id,
      kind: "breakable",
      hits: 0,
      maxHits: 1,
      lastHitAt: 0,
      destroyed: false,
      obstaclePolygon: t.polygon as DestructibleState["obstaclePolygon"],
      objective: false,
      fenceStyle: false,
      chest: false,
    } as DestructibleState;
    (game.destructibles ??= []).push(dest);
  }

  if (game.pendingDestroys.includes(dest)) return false;
  game.pendingDestroys.push(dest);
  return true;
}
