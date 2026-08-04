/**
 * "Deploy Charge" (a player-authored Turn on fence PLACEMENT). A map's fuse is
 * ARMED when a committed fence routes within its radius; after a telegraphed
 * delay it DETONATES, destroying its target obstacle slab (reopening that space,
 * via the existing breakable-destroy pipeline), flinging nearby balls outward,
 * and fracturing the player's own fences inside the blast radius.
 *
 * Arming runs once per committed cut (tickChargeOnCut, from applyCut). The
 * delayed detonation is checked every frame (tickCharges, from the game loop)
 * off game.activePlaySeconds so pauses/menus never advance the fuse.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Vector2 } from "@/types/game";
import { pointToSegmentDistance, polygonCentroid } from "@/lib/polygon";
import { isPlayerFence, FENCE_FRACTURE_HITS } from "@/lib/wallGeometry";
import { findObstacleDestructibleById } from "@/lib/physics/destructibles";
import { playBossChargeSound, playBossLandSound, playFenceBreakSound } from "@/lib/gameAudio";

/** How much faster a flung ball leaves the blast than it arrived. */
const BLAST_BOOST = 1.4;

export interface ChargeArmCallbacks { onChargeArmed?: (announce?: string) => void }
export interface ChargeBlowCallbacks { onChargeBlown?: (announce?: string) => void }

/** The line segments of a just-committed cut (both grown halves of the fence). */
function cutSegments(wall: GrowingWall): Array<[Vector2, Vector2]> {
  const segs: Array<[Vector2, Vector2]> = [];
  const add = (wps: Vector2[]) => {
    for (let i = 0; i < wps.length - 1; i++) segs.push([wps[i], wps[i + 1]]);
  };
  add(wall.startWaypoints);
  add(wall.endWaypoints);
  return segs;
}

/** True when any of the fence's segments passes within `radius` of the point. */
function segmentsHitPoint(segs: Array<[Vector2, Vector2]>, x: number, y: number, radius: number): boolean {
  const p = { x, y };
  for (const [a, b] of segs) {
    if (pointToSegmentDistance(p, a, b) <= radius) return true;
  }
  return false;
}

/**
 * Arm any unarmed fuse this just-committed fence routes over. Telegraphs (a
 * charge cue + optional banner); the actual blast fires later in tickCharges.
 */
export function tickChargeOnCut(game: CanvasGameState, wall: GrowingWall, callbacks: ChargeArmCallbacks): void {
  const charges = game.charges;
  if (!charges || charges.length === 0) return;

  const segs = cutSegments(wall);
  if (segs.length === 0) return;

  for (const c of charges) {
    if (c.blown || c.armedAt !== null) continue;
    if (!segmentsHitPoint(segs, c.fuse.x, c.fuse.y, c.radius)) continue;
    c.armedAt = game.activePlaySeconds;
    playBossChargeSound();
    callbacks.onChargeArmed?.(undefined);
  }
}

/**
 * Detonate any armed fuse whose telegraph delay has elapsed. Runs every frame.
 * Reopening the target's space is handled by the shared breakable-destroy path
 * (we push the target onto game.pendingDestroys); here we do the blast: fling
 * nearby balls and fracture the player's own fences in radius.
 */
export function tickCharges(game: CanvasGameState, callbacks: ChargeBlowCallbacks): void {
  const charges = game.charges;
  if (!charges || charges.length === 0) return;

  const now = performance.now();
  for (const c of charges) {
    if (c.blown || c.armedAt === null) continue;
    if (game.activePlaySeconds - c.armedAt < c.delaySeconds) continue;
    detonate(game, c, now, callbacks);
  }
}

function detonate(
  game: CanvasGameState,
  c: CanvasGameState["charges"][number],
  now: number,
  callbacks: ChargeBlowCallbacks,
): void {
  c.blown = true;

  // Blast centre = the target slab's centroid when it exists, else the fuse.
  let center: Vector2 = { x: c.fuse.x, y: c.fuse.y };

  // Destroy the target obstacle through the shared destroy pipeline (detach +
  // reopen its footprint + recapture + repaint), the same path a ball-smashed
  // breakable uses. Skip if it's already gone (a ball beat the fuse to it).
  const target = findObstacleDestructibleById(game, c.targetId);
  if (target && !target.destroyed && !game.pendingDestroys.includes(target)) {
    if (target.obstaclePolygon) center = polygonCentroid(target.obstaclePolygon);
    else if (target.mirrorPolygon) center = polygonCentroid(target.mirrorPolygon);
    game.pendingDestroys.push(target);
  }

  // Shockwave: fling every active ball inside the blast outward from the centre,
  // which is what frees a ball that was trapped against the slab.
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    let dx = b.position.x - center.x, dy = b.position.y - center.y;
    let d = Math.hypot(dx, dy);
    if (d > c.blastRadius) continue;
    const sp = (Math.hypot(b.velocity.x, b.velocity.y) || b.baseSpeed || 100) * BLAST_BOOST;
    if (d < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy) || 1; }
    dx /= d; dy /= d;
    b.velocity.x = dx * sp; b.velocity.y = dy * sp; b.speed = sp;
  }

  // Shred the player's own fresh fences caught in the blast (the downside of
  // detonating): queue any player fence with a point inside the radius to break,
  // subject to the same void-safety as a chain sweep in processWallBreaksFn.
  let shredded = false;
  for (const wall of game.walls) {
    if (!isPlayerFence(wall)) continue;
    if (wall.blackHits !== undefined && wall.blackHits >= FENCE_FRACTURE_HITS) continue;
    const dist = pointToSegmentDistance(center, wall.start, wall.end);
    if (dist > c.blastRadius) continue;
    wall.blackHitAt = now;
    wall.blackHits = FENCE_FRACTURE_HITS;
    if (!game.pendingWallBreaks.includes(wall)) game.pendingWallBreaks.push(wall);
    shredded = true;
  }

  playBossLandSound();
  if (shredded) playFenceBreakSound();
  callbacks.onChargeBlown?.(c.announce);
}
