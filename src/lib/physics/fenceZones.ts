/**
 * Ground that changes how fast a fence builds.
 *
 * Every other map mechanic acts on the balls or blocks the space. None of them
 * touches the cut itself - and the cut is what the game is actually about. The
 * whole tension of a fence is the race between it finishing and something
 * hitting it, and until now that race ran at the same speed everywhere on the
 * board.
 *
 * A zone with speed 0.5 makes a cut across it take twice as long. That turns a
 * chokepoint into something genuinely frightening in a way no obstacle can: the
 * obstacle tells you where you cannot cut, the slow ground tells you where you
 * had better be sure.
 *
 * ── Why the whole path, and not the tip ────────────────────────────────────
 *
 * The obvious hook is "multiply this frame's growth by the factor under the
 * growing tip", and it does not work. updateFenceWall drives growth from an
 * ease curve over ELAPSED TIME - `currT = elapsed / expectedDuration` - and
 * force-snaps both halves to their targets when currT hits 1. A tip slowed
 * along the way would simply be teleported to the end at the same wall-clock
 * moment, so the zone would change the shape of the growth and not its
 * duration, which is the one thing it exists to change.
 *
 * So the factor is computed once, over the path the fence will take, and folded
 * into the speed alongside the ability and upgrade multipliers that are already
 * there. A fence that crosses slow ground is slower for its whole life, which
 * is also easier to read on screen than one that lurches.
 */
import { vec2Distance, type Vector2 } from "@/lib/polygon";

export interface FenceZone {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Growth multiplier inside. Below 1 slows the cut, above 1 speeds it. */
  speed: number;
  /** Optional label, shown in the admin. */
  name?: string;
}

/** Clamp: a zone of 0 would never finish, and a huge one makes cuts instant. */
export const MIN_ZONE_SPEED = 0.15;
export const MAX_ZONE_SPEED = 4;

export const clampZoneSpeed = (s: number): number =>
  Math.max(MIN_ZONE_SPEED, Math.min(MAX_ZONE_SPEED, s));

/** The multiplier at a point: the product of every zone covering it. */
export function zoneFactorAt(zones: FenceZone[] | undefined, p: Vector2): number {
  if (!zones?.length) return 1;
  let f = 1;
  for (const z of zones) {
    if (p.x >= z.x && p.x <= z.x + z.width && p.y >= z.y && p.y <= z.y + z.height) {
      f *= clampZoneSpeed(z.speed);
    }
  }
  return f;
}

/** Samples per path segment. Enough that a zone edge lands within a few units. */
const SAMPLES_PER_SEGMENT = 12;

/**
 * The single speed multiplier for a fence following this path.
 *
 * A HARMONIC mean weighted by length, not an arithmetic one, and the difference
 * is not pedantry. Time is length over speed, so a path half at 1x and half at
 * 0.5x takes 0.5 + 1 = 1.5 units of time, i.e. an effective 0.67x - whereas
 * averaging the factors gives 0.75x and a fence that finishes noticeably early.
 * Summing the time each piece really costs is the only way the zone means what
 * the number on it says.
 */
export function pathSpeedFactor(zones: FenceZone[] | undefined, waypoints: Vector2[]): number {
  if (!zones?.length || waypoints.length < 2) return 1;

  let totalLength = 0;
  let totalTime = 0;
  // Whether any sample actually landed on special ground. A cut that misses
  // every zone returns exactly 1 rather than 0.9999999999999999: summing and
  // dividing drifts by an ulp or two even when every factor is 1, and that
  // would multiply into the fence speed of every cut on every map that has a
  // zone anywhere on it. The run-determinism work earlier in this codebase is
  // exactly about not letting differences like that exist.
  let touched = false;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const segLength = vec2Distance(a, b);
    if (segLength <= 0) continue;
    const step = segLength / SAMPLES_PER_SEGMENT;
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      const t = (s + 0.5) / SAMPLES_PER_SEGMENT;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const f = zoneFactorAt(zones, p);
      if (f !== 1) touched = true;
      totalTime += step / f;
    }
    totalLength += segLength;
  }
  if (!touched || totalTime <= 0) return 1;
  return totalLength / totalTime;
}

/**
 * The factor for a whole cut: both halves of it, together.
 *
 * A cut grows from its origin in two directions and completes when the LONGER
 * half is done, so its cost is the cost of that path - not of the two averaged.
 */
export function cutSpeedFactor(
  zones: FenceZone[] | undefined, startWaypoints: Vector2[], endWaypoints: Vector2[],
): number {
  if (!zones?.length) return 1;
  const pathLength = (w: Vector2[]) => {
    let n = 0;
    for (let i = 0; i < w.length - 1; i++) n += vec2Distance(w[i], w[i + 1]);
    return n;
  };
  const longer = pathLength(startWaypoints) >= pathLength(endWaypoints)
    ? startWaypoints : endWaypoints;
  return pathSpeedFactor(zones, longer);
}
