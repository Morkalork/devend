/**
 * "Wire the Integration" (issue #73 rewrite). Each circuit terminal is linked to
 * a DORMANT ball; routing a fence within a terminal's radius LIGHTS it and BOOTS
 * that ball - it springs to life (starts bouncing) and releases the uncapturable
 * pocket it reserved while asleep, so that space can be cleared once you trap it.
 *
 * Run once per committed cut. Incremental and independent: each terminal boots
 * its own ball, so you wake them one at a time at your own pace (route -> boot ->
 * trap), instead of juggling a circuit puzzle and live balls at once.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { GameCallbacks } from "./gameCallbacks";
import { pointToSegmentDistance } from "@/lib/polygon";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { playBossChargeSound } from "@/lib/gameAudio";

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
 * Light any circuit terminals this just-committed fence routes through and boot
 * their dormant balls. No-op on maps without a circuit or once all are lit.
 */
export function tickCircuitOnCut(game: CanvasGameState, wall: GrowingWall, callbacks: GameCallbacks): void {
  const c = game.circuit;
  if (!c || c.terminals.every(t => t.lit)) return;

  const segs = cutSegments(wall);
  if (segs.length === 0) return;

  for (const t of c.terminals) {
    if (t.lit) continue;
    if (!segmentsHitPoint(segs, t.x, t.y, t.radius)) continue;
    t.lit = true;
    if (wakeBall(game, t.ballId)) callbacks.onCircuitComplete?.(c.announce);
  }
}

/**
 * Boot a dormant ball: release its reserved pocket, set it active, and launch it
 * with a starting velocity. Returns true when a dormant ball was actually woken.
 */
function wakeBall(game: CanvasGameState, ballId: string): boolean {
  const ball = game.balls.find(b => b.id === ballId);
  if (!ball || ball.state !== "dormant") return false;

  // Release the uncapturable pocket it held so that space can be cleared again.
  const keep = game.spaceGrid?.keepActive;
  if (keep && ball.dormantReserveCells) {
    for (const idx of ball.dormantReserveCells) keep[idx] = 0;
  }
  ball.dormantReserveCells = undefined;

  ball.state = "active";
  // Spring to life from its sleeping spot in a random direction at base speed.
  const ang = Math.random() * Math.PI * 2;
  const sp = ball.baseSpeed || ball.topSpeed || 200;
  ball.velocity = { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp };
  ball.speed = sp;
  ball.spawnTime = performance.now();
  // Re-home its region id from its current position (it was stale while asleep).
  const region = findRegionContainingPoint(game.regions, ball.position.x, ball.position.y);
  if (region) ball.regionId = region.id;

  playBossChargeSound(); // a rising "powering on" cue
  return true;
}
