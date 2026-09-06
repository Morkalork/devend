/**
 * The drill fence (FENCE_TYPES_PLAN.md): the one that eats through.
 *
 * Three things no other fence does, and they are one idea rather than three:
 *
 *   ANCHOR   a drill cut may START on a breakable. Every other fence is refused
 *            there (cutAnchorsBreakable), and until now that read as an
 *            arbitrary rule. It becomes "only the drill bites into slabs",
 *            which teaches the drill for free.
 *   CHEW     while a drill fence touches a breakable it damages it over time,
 *            through the same registerObjectHit a ball uses - so a slab dies
 *            the same way whatever killed it, and the smash counters, the
 *            chest rewards and the sealed-shadow reopen all happen once.
 *   CONTINUE when that slab dies, the fence RESUMES GROWING through the space
 *            it just freed, until it meets the next wall, obstacle or fence.
 *            One drill can chain through several slabs.
 *
 * ── Why the continuation is a real growing fence ───────────────────────────
 *
 * It would be cheaper to extend the finished wall's endpoint and re-rasterize.
 * It would also be wrong: a growing fence can be cut by a ball, and the plan
 * calls the resumed growth "unprotected" on purpose. That is the drill's third
 * cost - it opens a hole and then spends time in it - and an instant extension
 * would quietly delete it. So the continuation is spawned as an ordinary
 * GrowingWall and takes every rule an ordinary cut takes, including the
 * smashReach guard: a drill that frees a slab and then walls it off again has
 * to be caught by the same check as any other fence.
 *
 * It does NOT cost a fence from the budget. game.wallCount is incremented where
 * the player draws, not here, so one drill is one fence however many slabs it
 * chains through. Paying twice for a single gesture would make the WIP-limit
 * maps unplayable with a drill equipped, which is the opposite of the point.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall } from "@/types/game";
import type { DestructibleState } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import { pointToSegmentDistance, vec2Distance, type Vector2 } from "@/lib/polygon";
import { castRayWithReflections } from "@/lib/wallGeometry";
import { getFenceType } from "@/lib/fences";
import { registerObjectHit } from "@/lib/physics/destructibles";
import { findRegionContainingPoint } from "@/lib/gameUtils";

/**
 * How close a drill fence has to be to a slab to be eating it.
 *
 * Half the fence thickness plus a couple of units. Generous enough that a cut
 * drawn "against" a slab counts without the player having to land on it exactly,
 * tight enough that a fence passing a slab in the next lane does not quietly
 * chew it from a distance.
 */
const TOUCH_MARGIN = 8;

/** Every breakable this segment is close enough to be eating. */
function slabsTouchedBy(
  game: CanvasGameState, a: Vector2, b: Vector2, thickness: number,
): DestructibleState[] {
  const reach = thickness / 2 + TOUCH_MARGIN;
  const out: DestructibleState[] = [];
  for (const d of game.destructibles ?? []) {
    if (d.kind !== "breakable" || d.destroyed || !d.obstaclePolygon) continue;
    const v = d.obstaclePolygon.vertices;
    let near = false;
    for (let i = 0; i < v.length && !near; i++) {
      // Both directions: a short fence beside a long slab needs the slab's
      // vertices measured against the fence, and a long fence past a small slab
      // needs the fence's ends measured against the slab's edges.
      if (pointToSegmentDistance(v[i], a, b) <= reach) near = true;
      else if (pointToSegmentDistance(a, v[i], v[(i + 1) % v.length]) <= reach) near = true;
      else if (pointToSegmentDistance(b, v[i], v[(i + 1) % v.length]) <= reach) near = true;
    }
    if (near) out.push(d);
  }
  return out;
}

/** True when this wall is a drill the player drew. */
function isDrill(wall: Wall): boolean {
  return getFenceType(wall.fenceTypeId).drillDamage > 0;
}

/**
 * Chew every slab a drill fence is touching, and remember which wall was on it.
 *
 * Called once per frame with the frame's own dt, so the damage is per SECOND
 * rather than per frame - a drill must not eat faster on a fast device, which
 * is the sort of thing that only shows up on somebody else's phone.
 *
 * Damage goes through registerObjectHit, the same entry a ball uses, so the
 * slab dies once and everything downstream of a death (the smash counter, a
 * chest's reward, the sealed-shadow reopen) happens exactly as it would have.
 * That function debounces per object, which also stops two drill segments
 * meeting at a corner from doing double damage.
 */
export function tickDrills(game: CanvasGameState, dtSeconds: number): void {
  if (dtSeconds <= 0) return;
  const now = performance.now();
  for (const wall of game.walls) {
    // ONE gate, not two. An `isDrill` check here as well read as belt and
    // braces and was neither: drillDamage is 0 for every other type, so the
    // line below already refuses them, and a mutation deleting the check left
    // every test green - which is the definition of a line that does nothing.
    const damage = getFenceType(wall.fenceTypeId).drillDamage * dtSeconds;
    if (damage <= 0) continue;
    for (const d of slabsTouchedBy(game, wall.start, wall.end, wall.thickness)) {
      // The wall that was eating it, so the continuation below knows which
      // fence to resume and in which direction. Recorded on the DESTRUCTIBLE
      // because the wall may be one of several and the slab is the thing that
      // is about to disappear.
      d.drilledByWallId = wall.id;
      registerObjectHit(game, d, `drill:${wall.id}`, now, damage, {
        x: (wall.start.x + wall.end.x) / 2,
        y: (wall.start.y + wall.end.y) / 2,
      });
    }
  }
}

/**
 * The endpoint of `wall` that was up against `slab`, and the direction to
 * continue in, or null when neither end was touching it.
 *
 * A drill drawn ACROSS a slab (both ends past it) has nothing to continue into:
 * the fence already spans the gap the slab was filling, so the removal simply
 * opens it. Only a fence that STOPPED at the slab resumes.
 */
function continuationFrom(
  wall: Wall, slab: DestructibleState,
): { from: Vector2; dir: Vector2 } | null {
  const v = slab.obstaclePolygon?.vertices;
  if (!v || v.length === 0) return null;
  const distTo = (p: Vector2) => {
    let best = Infinity;
    for (let i = 0; i < v.length; i++) {
      best = Math.min(best, pointToSegmentDistance(p, v[i], v[(i + 1) % v.length]));
    }
    return best;
  };
  const reach = wall.thickness / 2 + TOUCH_MARGIN;
  const dStart = distTo(wall.start);
  const dEnd = distTo(wall.end);
  const len = vec2Distance(wall.start, wall.end);
  if (len < 1e-6) return null;

  // Continue from whichever end is against the slab, heading AWAY from the
  // other end - which is the direction the cut was travelling when it stopped.
  if (dEnd <= reach && dEnd <= dStart) {
    return {
      from: { ...wall.end },
      dir: { x: (wall.end.x - wall.start.x) / len, y: (wall.end.y - wall.start.y) / len },
    };
  }
  if (dStart <= reach) {
    return {
      from: { ...wall.start },
      dir: { x: (wall.start.x - wall.end.x) / len, y: (wall.start.y - wall.end.y) / len },
    };
  }
  return null;
}

/** How far past the slab's face the continuation starts, so it clears the rubble. */
const RESUME_NUDGE = 2;
/** Below this the continuation is not worth spawning: it would be a stub. */
const MIN_RESUME_LENGTH = 12;

/**
 * A slab a drill was eating has died: send the fence on through the gap.
 *
 * Called from the destroy pipeline AFTER the slab's cells have been reopened,
 * because the ray has to be cast against the board as it is now - cast it a
 * frame early and the fence stops dead on the obstacle that is no longer there.
 *
 * Returns the spawned wall, or null when there is nothing to continue into.
 */
export function resumeDrillThrough(
  game: CanvasGameState, slab: DestructibleState,
): GrowingWall | null {
  const wallId = slab.drilledByWallId;
  if (!wallId) return null;
  slab.drilledByWallId = undefined;   // one continuation per slab, whatever else happens
  const wall = game.walls.find(w => w.id === wallId);
  if (!wall || !isDrill(wall)) return null;

  const cont = continuationFrom(wall, slab);
  if (!cont) return null;

  // Step off the slab's face before casting, or the ray starts inside the
  // rubble's own footprint and finds the thing it is standing in.
  const origin = {
    x: cont.from.x + cont.dir.x * RESUME_NUDGE,
    y: cont.from.y + cont.dir.y * RESUME_NUDGE,
  };
  const cast = castRayWithReflections(origin, cont.dir, game.walls);
  if (!cast || cast.waypoints.length < 2) return null;
  const target = cast.waypoints[cast.waypoints.length - 1];
  if (vec2Distance(origin, target) < MIN_RESUME_LENGTH) return null;

  const region = findRegionContainingPoint(game.regions, origin.x, origin.y);
  if (!region) return null;

  // Grows in ONE direction only. The backward half is degenerate on purpose:
  // this is not a new cut from a point the player chose, it is the same fence
  // carrying on, so it must not also open up behind itself.
  const still = [{ ...origin }, { ...origin }];
  const continuation: GrowingWall = {
    origin: { ...origin },
    direction: { ...cont.dir },
    startWaypoints: still,
    endWaypoints: cast.waypoints,
    startSegmentIndex: 0,
    endSegmentIndex: 0,
    startPoint: { ...origin },
    endPoint: { ...origin },
    targetStart: still[still.length - 1],
    targetEnd: target,
    thickness: wall.thickness,
    isComplete: false,
    activeRegionId: region.id,
    startTime: performance.now(),
    // Still a drill, so it can chain: the next slab it reaches gets eaten too.
    fenceTypeId: wall.fenceTypeId,
  };
  game.activeWalls.push(continuation);
  return continuation;
}
