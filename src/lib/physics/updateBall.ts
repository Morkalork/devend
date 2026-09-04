/**
 * updateBall — per-frame ball physics step.
 *
 * Extracted from GameCanvas so it can be unit-tested and shared with future
 * server-side simulation without dragging in React.
 */

import { Ball, Vector2 } from "@/types/game";
import { gravityStep } from "@/lib/physics/gravity";
import { bouncerKick, bouncerReady, BOUNCER_FLASH_MS, BOUNCER_HOURS_PER_BUMP, type BouncerSpec } from "@/lib/physics/bouncer";
import { applyDent, deformReady, deformSlow, dentDepth, type DeformState } from "@/lib/physics/deformable";
import { portalAt, portalExit, portalArrival, portalReady } from "@/lib/physics/portal";
import { wellStep } from "@/lib/physics/gravityWells";
import { slowFactorAt } from "@/lib/physics/slowAreas";
import { steerHeading, steerWorldOf } from "@/lib/physics/steering";
import { tickTurnTimer } from "@/lib/physics/turnTimer";
import { getRunRng } from "@/lib/runRng";
import { CanvasGameState } from "@/types/gameState";
import {
  vec2Add,
  vec2Sub,
  vec2Scale,
  vec2Normalize,
  vec2Length,
  vec2Distance,
  vec2Dot,
  pointInPolygon,
  resolveBallPolygonCollision,
  resolveBallPolygonCollisionOutward,
  polygonCentroid,
  closestPointOnSegment,
  Polygon,
} from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";
import { registerWallImpact, registerObstacleImpact } from "@/lib/wallImpactEffects";
import {
  REGION_SAMPLE_GRID_SIZE,
  isBallInRegion,
  isBallCellInRegion,
  findContainingRegion,
  constrainBallToRegion,
} from "@/lib/regionOwnership";
import { playWallHitSound, playBossJumpSound, playBossLandSound } from "@/lib/gameAudio";
import { updateBallEffects, triggerWallHit, bounceImpact } from "@/lib/ballEffects";
import { findMoverDestructible, findObstacleDestructibleById, obstacleIdFromWallId, registerObjectHit, ballImpactDamage } from "@/lib/physics/destructibles";
import { registerFenceFracture } from "@/lib/physics/breakFenceWall";
import { collectPhasedOut } from "@/lib/physics/phasing";
import { queryWallsNear } from "@/lib/physics/wallGrid";
import { runStream } from "@/lib/runRng";
import { ballMayPass } from "@/lib/physics/obstacleRules";
import { WALL_THICKNESS } from "@/lib/wallGeometry";

/** Slack added to the wall-index query radius (world units). Comfortably
 *  covers the "+2" collision margin plus any small push-out drift within the
 *  wall loop, so the queried candidate set is never missing a reachable wall. */
const WALL_QUERY_SLACK = 32;
/** Reused candidate buffer for the wall broad-phase (single-threaded loop). */
const _wallScratch: Wall[] = [];

/** Boss cell-division animation duration (issue #56): the bud grows + detaches. */
const SPLIT_MS = 1200;
/** Boss break-out leap duration (issue #56): the arc out of a trapped pocket. */
const BOSS_LEAP_MS = 520;
/** Full stop at the trap spot before the jump launches (wind-up beat). */
const BOSS_LEAP_CROUCH_MS = 190;
/** Landing impact speed fed to the squish so the top-down splat saturates. */
const BOSS_LAND_IMPACT_SPEED = 340;
/** A boss daughter cell buds at this fraction of full size and grows to full while
 *  attached to the parent. Shared with the spawn in bossPhases. */
export const BIRTH_START_FRAC = 0.15;

/**
 * Boss swell envelope over the division (t in [0,1]): a quick bulge to full,
 * held through the middle while the bud forms, then a deflate as it pinches off.
 * Returns 0 at both ends and 1 across the hold, so radius = base * (1 + 0.25*this).
 */
function bossSwell(t: number): number {
  const IN = 0.18, OUT = 0.82;
  if (t < IN) return t / IN;              // swell in
  if (t > OUT) return (1 - t) / (1 - OUT); // deflate as the bud detaches
  return 1;                               // hold at full swell
}

// ---------------------------------------------------------------------------
// Hot-loop notes
// ---------------------------------------------------------------------------
// Everything below runs 120 times per second per ball against every wall
// segment and obstacle polygon, so this file deliberately avoids the vec2*
// helpers (each allocates a fresh object) in favour of inline scalar math,
// and rejects far-away geometry with cached bounds before any segment math.
// Allocations only happen on actual collisions, which are rare.

/** Cached AABBs for static obstacle polygons (mover polygons mutate, movers
 *  use their bounding circle instead — see the mover loop below). */
const _obstacleBounds = new WeakMap<Polygon, { minX: number; minY: number; maxX: number; maxY: number }>();

function getObstacleBounds(poly: Polygon) {
  let b = _obstacleBounds.get(poly);
  if (!b) {
    b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const v of poly.vertices) {
      if (v.x < b.minX) b.minX = v.x;
      if (v.y < b.minY) b.minY = v.y;
      if (v.x > b.maxX) b.maxX = v.x;
      if (v.y > b.maxY) b.maxY = v.y;
    }
    _obstacleBounds.set(poly, b);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Helper: resolve ball vs completed-cut line-segment, in place.
// ROBUST: Uses larger collision margin and push-out distance to prevent
// tunneling. Mutates ball.position/ball.velocity directly; returns the impact
// point on hit and null on miss (the miss path allocates nothing).
// ---------------------------------------------------------------------------
function collideBallWithWall(ball: Ball, wall: Wall): Vector2 | null {
  // Lazily cache the segment AABB on the wall (walls never move once created)
  if (wall.aabbMinX === undefined) {
    wall.aabbMinX = Math.min(wall.start.x, wall.end.x);
    wall.aabbMaxX = Math.max(wall.start.x, wall.end.x);
    wall.aabbMinY = Math.min(wall.start.y, wall.end.y);
    wall.aabbMaxY = Math.max(wall.start.y, wall.end.y);
  }

  // Use a slightly larger collision zone for detection (helps with fast-moving balls)
  const collisionDist = ball.radius + wall.thickness / 2 + 2;
  const px = ball.position.x;
  const py = ball.position.y;

  // Cheap AABB rejection — the overwhelmingly common case
  if (
    px < wall.aabbMinX! - collisionDist || px > wall.aabbMaxX! + collisionDist ||
    py < wall.aabbMinY! - collisionDist || py > wall.aabbMaxY! + collisionDist
  ) {
    return null;
  }

  // Closest point on the segment (scalar form of pointToSegmentDistance)
  const sx = wall.start.x, sy = wall.start.y;
  const edgeX = wall.end.x - sx, edgeY = wall.end.y - sy;
  const edgeLengthSq = edgeX * edgeX + edgeY * edgeY;
  let cx: number, cy: number;
  if (edgeLengthSq === 0) {
    cx = sx; cy = sy;
  } else {
    let t = ((px - sx) * edgeX + (py - sy) * edgeY) / edgeLengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    cx = sx + edgeX * t;
    cy = sy + edgeY * t;
  }
  const toBallX = px - cx, toBallY = py - cy;
  const dist = Math.sqrt(toBallX * toBallX + toBallY * toBallY);
  if (dist >= collisionDist) return null;

  // Normal points from line toward ball; ball exactly on line → use perpendicular
  let nx: number, ny: number;
  if (dist < 0.001) {
    const edgeLen = Math.sqrt(edgeLengthSq);
    if (edgeLen > 0) { nx = -edgeY / edgeLen; ny = edgeX / edgeLen; }
    else { nx = 0; ny = 0; }
  } else {
    nx = toBallX / dist;
    ny = toBallY / dist;
  }

  // Reflect velocity if moving toward line
  const vx = ball.velocity.x, vy = ball.velocity.y;
  const velDotNormal = vx * nx + vy * ny;
  if (velDotNormal < 0) {
    ball.velocity.x = vx - 2 * velDotNormal * nx;
    ball.velocity.y = vy - 2 * velDotNormal * ny;
  }

  // Push ball out with generous margin to prevent re-penetration
  const minSafeDist = ball.radius + wall.thickness / 2 + 3;
  const pushDist = Math.max(0, minSafeDist - dist);
  ball.position.x = px + nx * (pushDist + 2);
  ball.position.y = py + ny * (pushDist + 2);

  return { x: cx, y: cy };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Update ball position and bounce off all walls (all in world coordinates).
 *
 * `phasedOut` is the intangible-obstacle set for this frame (#64). It is
 * identical for every ball in a step, so the game loop computes it ONCE and
 * passes it in; the default keeps standalone callers (tests) working. On a
 * phasing map this avoids re-allocating the set per ball per substep.
 */
/**
 * Catch a non-finite ball before the physics spreads it.
 *
 * This runs FIRST, and the order is the whole point. Integration is the step
 * that turns one bad number into an unrecoverable one: a NaN velocity becomes a
 * NaN position, and a NaN position cannot be rescued by anything downstream.
 * The escaped-board recovery below looks like it would catch it - the ball is
 * certainly not inside the board polygon any more - but every comparison it
 * makes against NaN is false, so `minDist` never improves, the "nearest point"
 * stays the ball's own broken position, and it writes NaN straight back. The
 * ball is then invisible, uncollidable and unlockable for the rest of the map
 * while still counting as an active ball the player has to clear around.
 *
 * Loud, always. A non-finite value here means something upstream is broken, and
 * a silent repair would hide the actual fault - which is exactly what happened
 * once already: an undefined tuning value produced NaN, the minimum-speed floor
 * quietly laundered it into a fixed nudge, and the result looked for all the
 * world like a physics bug in the floor.
 */
function sanitise(ball: Ball, game: CanvasGameState): void {
  const badV = !Number.isFinite(ball.velocity.x) || !Number.isFinite(ball.velocity.y);
  const badP = !Number.isFinite(ball.position.x) || !Number.isFinite(ball.position.y);
  if (!badV && !badP) return;

  console.warn(
    "[PHYSICS] non-finite ball", ball.id,
    badP ? "position" : "", badV ? "velocity" : "", "- recovered",
  );

  if (badP) {
    // The board centre: the one point guaranteed to be on the board when the
    // ball's own coordinates say nothing at all.
    const c = game.boardPolygon ? polygonCentroid(game.boardPolygon) : null;
    ball.position = { x: c?.x ?? 0, y: c?.y ?? 0 };
    ball.prevPosition = { x: ball.position.x, y: ball.position.y };
    ball.renderPosition = { x: ball.position.x, y: ball.position.y };
  }
  if (badV) {
    // Zero, not a guess at a heading. The minimum-speed floor further down owns
    // "a ball that should be moving and is not", and it aims into open space;
    // inventing a direction here would be a second, worse copy of that rule.
    ball.velocity = { x: 0, y: 0 };
    ball.speed = 0;
  }
}

/**
 * Fire a bouncer at a ball, if there is one and it is off cooldown.
 *
 * One helper called from BOTH collision systems, because an obstacle is in both
 * and a kick honoured in only one gives a bumper that fires from its face and
 * is dead at its edges - the same trap the pass-rule comment further down warns
 * about, which was found the hard way.
 *
 * The arithmetic is in bouncer.ts; this is only the plumbing and the cooldown.
 */
function applyBouncer(
  game: CanvasGameState, ball: Ball, spec: BouncerSpec | undefined, now: number,
): void {
  if (!spec || !bouncerReady(ball, spec, now)) return;
  const hit = bouncerKick(ball, spec);
  // Spend an hour from the bumper's bank. In here rather than in bouncerKick
  // because the kick is pure geometry and this is a payment - and because the
  // cooldown that makes one contact one kick is what makes it one hour too.
  //
  // A spent bumper still bounces. It is furniture that happened to be worth
  // something, not a coin that vanishes.
  if (spec.hours > 0) {
    const paid = Math.min(BOUNCER_HOURS_PER_BUMP, spec.hours);
    spec.hours -= paid;
    game.bouncerOvertime = (game.bouncerOvertime ?? 0) + paid;
  }
  ball.velocity = hit.velocity;
  ball.speed = hit.speed;
  ball.lastBouncerId = spec.id;
  ball.lastBouncerAt = now;
  // Told to whatever draws the board, so the kick has a visible cause rather
  // than reading as the ball randomly speeding up.
  //
  // Pruned on the way in rather than by the renderer: a bumper cluster fires
  // several times a second for a whole map, and a queue only ever appended to
  // is a leak that also makes the flare lookup slower every minute of play.
  // Nothing may rely on the renderer draining it - a paused or unmounted board
  // does not draw at all, and the physics still runs.
  const flashes = (game.bouncerFlashes ??= []);
  for (let i = flashes.length - 1; i >= 0; i--) {
    if (now - flashes[i].at > BOUNCER_FLASH_MS) flashes.splice(i, 1);
  }
  flashes.push({
    id: spec.id, x: spec.centre.x, y: spec.centre.y, at: now, intensity: hit.intensity,
  });
}

/**
 * One contact with a deformable: the surface sinks, the ball pays 3%.
 *
 * Shared by both collision systems for the reason the whole mechanic depends
 * on - the polygon and the edge walls describe ONE surface, and a dent written
 * by only one of them would be a wall that gives at its face and is rigid at
 * its rim. The per-ball cooldown is what makes one contact seen by both paths
 * still one dent and one 3%.
 *
 * No flash queue, unlike the bouncer. A bumper's kick has no visible cause
 * without one; this one leaves a permanent mark exactly where it landed, which
 * is a better record than any flash.
 */
function applyDeformable(
  ball: Ball, state: DeformState | undefined,
  at: Vector2, normalSpeed: number, now: number,
): void {
  if (!state || !deformReady(ball, state, now)) return;
  applyDent(state, at, dentDepth(ball, normalSpeed));
  const hit = deformSlow(ball);
  ball.velocity = hit.velocity;
  ball.speed = hit.speed;
  ball.lastDeformId = state.id;
  ball.lastDeformAt = now;
  // The polygon's cached AABB (_obstacleBounds) is deliberately NOT dropped: a
  // dent only ever pulls vertices toward the centre, so the stale box is a
  // superset of the dented shape and the broad phase stays conservative. The
  // per-wall AABB is a different story and applyDent invalidates it - see there.
}

export function updateBall(
  ball: Ball,
  dt: number,
  game: CanvasGameState,
  phasedOut: ReturnType<typeof collectPhasedOut> = collectPhasedOut(game),
): void {
  if (ball.state === 'won') return; // stopped and disintegrating
  if (ball.state === 'dormant') return; // un-booted (#73): no physics until woken

  sanitise(ball, game);

  const now = performance.now();

  // Boss break-out leap (issue #56): after a non-fatal trap the boss comes to a
  // FULL STOP, then ARCS out of the sealed pocket back onto the open map (a whoosh
  // on launch, a top-down squash + thud on landing), rather than teleporting. It
  // is airborne (skips all physics/collision/region checks) and lands at leapTo,
  // where breakBossOut already aimed its velocity into open space.
  if (ball.bossLeapAt !== undefined) {
    const elapsed = now - ball.bossLeapAt;
    const fromX = ball.leapFromX ?? ball.position.x, fromY = ball.leapFromY ?? ball.position.y;
    const toX = ball.leapToX ?? ball.position.x, toY = ball.leapToY ?? ball.position.y;
    // Wind-up: a full stop at the trap spot before the jump launches.
    if (elapsed < BOSS_LEAP_CROUCH_MS) {
      ball.position.x = fromX; ball.position.y = fromY;
      ball.prevPosition = { x: fromX, y: fromY };
      ball.renderPosition = { x: fromX, y: fromY };
      return;
    }
    const t = (elapsed - BOSS_LEAP_CROUCH_MS) / BOSS_LEAP_MS;
    if (t >= 1) {
      // Land: snap to the target, then a TOP-DOWN squash (impact normal points
      // straight down, so it splats vertically regardless of the leap direction)
      // plus a thud; resume normal physics next frame.
      ball.position = { x: toX, y: toY };
      ball.prevPosition = { x: toX, y: toY };
      ball.renderPosition = { x: toX, y: toY };
      ball.bossLeapAt = undefined;
      ball.bossLeapLaunched = undefined;
      ball.leapFromX = ball.leapFromY = ball.leapToX = ball.leapToY = undefined;
      triggerWallHit(ball.effects, now, 0, BOSS_LAND_IMPACT_SPEED, BOSS_LAND_IMPACT_SPEED);
      playBossLandSound();
      return;
    }
    // First airborne frame: the launch whoosh.
    if (!ball.bossLeapLaunched) { ball.bossLeapLaunched = true; playBossJumpSound(); }
    // Straight-line interpolation plus a parabolic hop (screen up = -y) so it
    // visibly vaults over the walls of the pocket it was sealed into.
    const hop = Math.sin(Math.PI * t) * Math.min(90, Math.hypot(toX - fromX, toY - fromY) * 0.3);
    ball.position.x = fromX + (toX - fromX) * t;
    ball.position.y = fromY + (toY - fromY) * t - hop;
    ball.renderPosition = { x: ball.position.x, y: ball.position.y };
    return; // airborne: no walls, no region check
  }

  // Mitosis birth (issue #56): a daughter cell buds from the boss. While ATTACHED
  // it grows in place on the parent's body, FOLLOWING the parent as it moves, so
  // it clearly emerges FROM the boss (not a separate ball popping in). At the end
  // of SPLIT_MS it pinches off and is released, drifting away on its own. Skips
  // normal physics while attached (it is pure animation, pegged to the parent).
  if (ball.birthParentId !== undefined) {
    const parent = game.balls.find(b => b.id === ball.birthParentId && b.state === "active");
    const t = ball.bornAt !== undefined ? (now - ball.bornAt) / SPLIT_MS : 1;
    const dx = ball.birthDirX ?? 1, dy = ball.birthDirY ?? 0;
    if (parent && t < 1) {
      const target = ball.bornRadius ?? ball.radius;
      ball.radius = Math.max(2, target * (BIRTH_START_FRAC + (1 - BIRTH_START_FRAC) * t)); // linear, visible grow
      // Sit mostly on the parent, bulging outward, and track it as it moves.
      const d = parent.radius * 0.85;
      ball.position.x = parent.position.x + dx * d;
      ball.position.y = parent.position.y + dy * d;
      ball.prevPosition = { x: ball.position.x, y: ball.position.y };
      ball.renderPosition = { x: ball.position.x, y: ball.position.y };
      ball.regionId = parent.regionId;
      return; // attached: skip normal physics this step
    }
    // Pinch off: full size, released outward under its own power.
    ball.birthParentId = undefined;
    ball.bornAt = undefined;
    ball.radius = ball.bornRadius ?? ball.radius;
    const spd = ball.speed || ball.baseSpeed || vec2Length(ball.velocity) || 1;
    ball.velocity = { x: dx * spd, y: dy * spd };
  }

  // Cell-division beat (issue #56): the BOSS stops dead, swells ~25%, and births
  // its daughter cell while immobile, then deflates and resumes. splitFactor 0
  // freezes DISPLACEMENT (like Scope Creep below), so the stored velocity is
  // untouched and full speed returns on its own once the division ends.
  let splitFactor = 1;
  if (ball.splitAnimAt !== undefined) {
    const t = (now - ball.splitAnimAt) / SPLIT_MS;
    if (t >= 1 || t < 0) {
      ball.splitAnimAt = undefined;
      if (ball.splitBaseRadius !== undefined) {
        ball.radius = ball.splitBaseRadius; // back to normal size
        ball.splitBaseRadius = undefined;
      }
    } else {
      splitFactor = 0; // dead stop while it divides
      // Remember the pre-swell size on the first frame, then bulge to +25% and
      // hold through the division, deflating as the bud pinches off at the end.
      if (ball.splitBaseRadius === undefined) ball.splitBaseRadius = ball.radius;
      ball.radius = ball.splitBaseRadius * (1 + 0.25 * bossSwell(t));
    }
  }

  // Move ball (world units). Scope Creep + the split beat scale the DISPLACEMENT,
  // not the stored velocity, so abilities that rescale velocity to absolute targets
  // (grey wind-down, yellow variable speed, the minimum-speed floor) stay untouched
  // and the factor can never compound frame-over-frame.
  // A Slow Area scales displacement here for the same reason Scope Creep does,
  // and the comment above is the whole argument: halving the VELOCITY would be
  // erased within a frame by the rescalers, and would fight the minimum-speed
  // floor, whose entire job is to stop a ball moving this slowly.
  const slowFactor = slowFactorAt(ball.position.x, ball.position.y, game.slowAreas);
  const moveDt = dt * (game.creepFactor || 1) * splitFactor * slowFactor;
  ball.position.x += ball.velocity.x * moveDt;
  ball.position.y += ball.velocity.y * moveDt;

  // Shifting gravity (issue #77): bend the HEADING toward the current pull,
  // never the speed. Placed here, after the move and before the speed
  // rescalers below, for the reason the whole feature is shaped this way: the
  // minimum-speed floor and the grey/yellow abilities all rewrite velocity to
  // an absolute magnitude every frame, so anything that accumulated INTO speed
  // would be erased. Steering survives them untouched, and a ball at constant
  // speed can never come to rest, which is what makes "they must bounce" a
  // property of the design rather than a number someone has to tune.
  //
  // Map gravity and gravity wells both bend the heading, and both are applied
  // through steerHeading rather than inline, because the Scrum Master preview
  // has to bend a predicted path by exactly the same rule. It used to decide
  // for itself and had drifted three ways: it had never heard of wells, it
  // ignored the Free Fall bend multiplier, and it read "is gravity on" from a
  // different expression than this did. A forecast the player paid hundreds of
  // hours for has to come from the rule the ball obeys.
  //
  // Frozen balls are exempt, the same exemption the speed floor makes: they are
  // held in place on purpose and must not drift out of a pocket mid-freeze.
  if (!(game.frozenBallId && ball.id === game.frozenBallId)) {
    const steered = steerHeading(
      ball.position, ball.velocity, steerWorldOf(game), game.activePlaySeconds, dt,
    );
    if (steered) { ball.velocity.x = steered.x; ball.velocity.y = steered.y; }
  }

  // Compass ball: a quarter turn when its timer comes up. Placed with the other
  // heading changes, before the speed rescalers, for the same reason they are:
  // it rotates the velocity and never touches the magnitude, so every speed
  // rule downstream keeps working untouched.
  //
  // Frozen balls are exempt, as with gravity and wells: a ball held in a pocket
  // must not turn out of it while the player is looking elsewhere.
  if (!(game.frozenBallId && ball.id === game.frozenBallId)) {
    tickTurnTimer(ball, game.activePlaySeconds, getRunRng(`turn:${ball.id}`));
  }

  // Update rotation based on speed (medium spin rate); uses the creep-scaled
  // step so spin matches apparent speed.
  const speed = vec2Length(ball.velocity);
  const rotationSpeed = speed * 0.015; // Radians per second based on speed
  ball.rotation += rotationSpeed * moveDt;

  updateBallEffects(ball.effects, dt, now);

  // Yellow "variable speed" ability: track whether the ball touched any surface
  // (board edge, mover, obstacle, or fence) this step so its speed can shift.
  let surfaceHit = false;

  // Legacy flash decay (kept for compatibility)
  if (ball.flashIntensity > 0) {
    ball.flashIntensity = Math.max(0, ball.flashIntensity - dt * 7);
  }

  // CRITICAL: First check if ball has escaped the board entirely
  // This is a safety recovery for high-speed tunneling through boundaries
  if (game.boardPolygon && !pointInPolygon(ball.position, game.boardPolygon)) {
    // Ball escaped! Find the nearest edge and push it back inside
    const boardVerts = game.boardPolygon.vertices;
    let minDist = Infinity;
    let nearestPoint: Vector2 = ball.position;
    let nearestNormal: Vector2 = { x: 0, y: -1 };

    for (let i = 0; i < boardVerts.length; i++) {
      const j = (i + 1) % boardVerts.length;
      const p1 = boardVerts[i];
      const p2 = boardVerts[j];
      const closest = closestPointOnSegment(ball.position, p1, p2);
      const dist = vec2Distance(ball.position, closest);

      if (dist < minDist) {
        minDist = dist;
        nearestPoint = closest;
        // Normal pointing into the board (toward centroid)
        const edge = vec2Sub(p2, p1);
        const perpendicular = vec2Normalize({ x: -edge.y, y: edge.x });
        const boardCentroid = polygonCentroid(game.boardPolygon);
        const toCenter = vec2Sub(boardCentroid, closest);
        // Choose direction pointing toward board center (inward)
        nearestNormal = vec2Dot(perpendicular, toCenter) > 0 ? perpendicular : vec2Scale(perpendicular, -1);
      }
    }

    // Push ball back inside with margin
    ball.position = vec2Add(nearestPoint, vec2Scale(nearestNormal, ball.radius + 5));

    // Reflect velocity
    const velDotNormal = vec2Dot(ball.velocity, nearestNormal);
    if (velDotNormal < 0) {
      ball.velocity = vec2Sub(ball.velocity, vec2Scale(nearestNormal, 2 * velDotNormal));
    }

    // CRITICAL: Reassign ball to the correct region after board escape recovery
    let foundRegion = false;
    for (const region of game.regions) {
      if (region.samplePoints) {
        for (const sample of region.samplePoints) {
          if (vec2Distance(ball.position, sample) < REGION_SAMPLE_GRID_SIZE * 1.5) {
            ball.regionId = region.id;
            foundRegion = true;
            console.warn("[PHYSICS] Ball escaped board, reassigned to region:", region.id);
            break;
          }
        }
      }
      if (foundRegion) break;

      // Fallback: check polygon containment
      if (!foundRegion && pointInPolygon(ball.position, region.polygon)) {
        ball.regionId = region.id;
        foundRegion = true;
        console.warn("[PHYSICS] Ball escaped board, reassigned to region (polygon):", region.id);
      }
    }

    console.warn("[PHYSICS] Ball escaped board, recovered to:", ball.position);
  }

  // Resolve collisions with board boundary (always use original board, not region bounding box).
  // Broad-phase: the board is an axis-aligned rectangle, so a ball further than
  // radius+margin from every edge cannot be touching one. Skip the resolver in
  // that (very common) case - it allocates ~19 short-lived objects even on a MISS,
  // and it runs per ball per 120Hz step, so this is the biggest per-step GC source.
  if (game.boardPolygon) {
    const bb = getObstacleBounds(game.boardPolygon); // cached AABB (== the rect edges)
    const m = ball.radius + 2;
    const nearBoardEdge =
      ball.position.x <= bb.minX + m || ball.position.x >= bb.maxX - m ||
      ball.position.y <= bb.minY + m || ball.position.y >= bb.maxY - m;
    if (nearBoardEdge) {
      const boardResult = resolveBallPolygonCollision(ball.position, ball.velocity, ball.radius, game.boardPolygon);
      const vBefore = ball.velocity;
      ball.position = boardResult.position;
      ball.velocity = boardResult.velocity;
      if (boardResult.collided) surfaceHit = true;

      // Register wall impact for visual effect
      if (boardResult.collided && boardResult.impactEdge) {
        const spd = vec2Length(ball.velocity);
        const impactStrength = Math.min(1, spd / 400);
        registerWallImpact(
          boardResult.impactEdge.start,
          boardResult.impactEdge.end,
          boardResult.impactEdge.point,
          impactStrength,
          ball.position,
        );
        // Trigger wall hit effect on ball
        triggerWallHit(ball.effects, now, ...bounceImpact(vBefore, ball.velocity));
        // Play wall hit sound
        playWallHitSound(impactStrength);
      }
    }
  }

  // Bounce off moving obstacles.
  // Bounding-circle rejection first: the mover polygon is a 24-gon rebuilt in
  // place each step, so full polygon collision on every step is wasted work
  // unless the ball is actually near the mover.
  for (const mover of game.movers) {
    if (mover.boundRadius === undefined) {
      mover.boundRadius = mover.shape === "circle"
        ? (mover.radius ?? 0)
        : Math.hypot(mover.width ?? 0, mover.height ?? 0) / 2;
    }
    const mdx = (mover.axis === "horizontal" ? mover.homeX + mover.offset : mover.homeX) - ball.position.x;
    const mdy = (mover.axis === "vertical" ? mover.homeY + mover.offset : mover.homeY) - ball.position.y;
    const reach = mover.boundRadius + ball.radius + 2;
    if (mdx * mdx + mdy * mdy > reach * reach) continue;

    const result = resolveBallPolygonCollisionOutward(ball.position, ball.velocity, ball.radius, mover.polygon);
    if (result.collided) {
      const vBefore = ball.velocity;
      ball.position = result.position;
      ball.velocity = result.velocity;
      surfaceHit = true;
      triggerWallHit(ball.effects, now, ...bounceImpact(vBefore, ball.velocity));
      playWallHitSound(Math.min(1, vec2Length(ball.velocity) / 400));
      // Black ball wears down movers (its heavy mass makes short work of them).
      if (ball.ability === 'breakObjects') {
        const d = findMoverDestructible(game, mover.id);
        // The ball's own position at contact is the impact point. Passing it
        // matters: registerObjectHit records the dent and sheds the chips only
        // when it is given one, so a mover being worn down used to take damage
        // in complete silence - no bite out of its hull, no fragments.
        if (d) {
          registerObjectHit(
            game, d, ball.id, now, ballImpactDamage(ball, vec2Length(ball.velocity)),
            { x: ball.position.x, y: ball.position.y },
          );
        }
      }
    }
  }

  // Phasing obstacles (#64): while phased out, balls pass through them. The
  // set is passed in (computed once per step by the loop); null on the common
  // map with no phasing objects.

  // CRITICAL: Check obstacle polygon penetration before edge collisions.
  // Obstacles are static, so a cached AABB (inflated by the ball radius)
  // rejects far-away polygons before the per-edge resolver runs — circle
  // obstacles are 64-gons, so this skips 64 segment tests per miss.
  // PORTALS, before any collision. A ball entering one comes out of its
  // partner, so the portal must never be resolved as a solid for balls - it is
  // still an obstacle for FENCES, which is what makes it a hole you cannot
  // cover over.
  if (game.portals?.size) {
    const mouth = portalAt(ball.position, game.portals);
    if (mouth && portalReady(ball, now)) {
      const exit = portalExit(mouth, [...game.portals.values()]);
      // A link with only one portal on it is inert rather than a ball-eater.
      if (exit) {
        ball.position = portalArrival(ball, exit);
        ball.lastPortalAt = now;
        const owner = game.regions.find(r => pointInPolygon(ball.position, r.polygon));
        // Reassigned with the move, for the same reason waking a dormant ball
        // does it: a ball owning a region it is no longer standing in breaks
        // every reachability answer downstream.
        if (owner) ball.regionId = owner.id;
      }
    }
  }

  for (const obstacle of game.obstaclePolygons) {
    if (phasedOut && phasedOut.polys.has(obstacle)) continue;
    // A portal is open to balls at its face...
    if (game.portals?.has(obstacle)) continue;
    // One-way membranes and ball-type gates. Checked before the cheap AABB
    // reject rather than after, because a ball that MAY pass should behave
    // exactly as if the obstacle were not there - including not paying for a
    // bounds test on it every frame it is nearby.
    if (game.obstacleRules?.size
      && ballMayPass(game.obstacleRules.get(obstacle), ball, ball.velocity)) {
      continue;
    }
    const b = getObstacleBounds(obstacle);
    const reach = ball.radius + 1;
    if (
      ball.position.x < b.minX - reach || ball.position.x > b.maxX + reach ||
      ball.position.y < b.minY - reach || ball.position.y > b.maxY + reach
    ) {
      continue;
    }

    const obstacleResult = resolveBallPolygonCollisionOutward(
      ball.position,
      ball.velocity,
      ball.radius,
      obstacle
    );
    if (obstacleResult.collided) {
      const vBefore = ball.velocity;
      ball.position = obstacleResult.position;
      ball.velocity = obstacleResult.velocity;
      surfaceHit = true;

      // Deformable face. The reflection has already happened, so the closing
      // speed along the normal is half the change in velocity it caused, and
      // the normal itself is the direction of that change - no need to ask the
      // resolver which edge was struck. A contact that reflected nothing (the
      // resolver merely depenetrated a ball already moving away) is not an
      // impact and must not dent: ballImpactDamage floors at 0.15, so without
      // this guard a ball nestled against the wall would be taxed for nothing.
      const dvx = ball.velocity.x - vBefore.x, dvy = ball.velocity.y - vBefore.y;
      const dvl = Math.hypot(dvx, dvy);
      if (dvl > 1e-6) {
        applyDeformable(
          ball, game.deformables?.get(obstacle),
          // Back off the ball's radius along the normal, so the dent is centred
          // on the SURFACE rather than on the ball's middle a radius clear of it.
          { x: ball.position.x - (dvx / dvl) * ball.radius,
            y: ball.position.y - (dvy / dvl) * ball.radius },
          dvl / 2, now,
        );
      }

      // Pop bumper: it does not merely reflect, it KICKS - outward from the
      // bouncer's middle, faster than the ball arrived. Applied after the
      // resolver has already pushed the ball clear, so the kick starts from a
      // legal position rather than from inside the solid.
      applyBouncer(game, ball, game.bouncers?.get(obstacle), now);

      // Trigger wall hit effect on ball
      triggerWallHit(ball.effects, now, ...bounceImpact(vBefore, ball.velocity));

      // Play wall hit sound for obstacle collision
      const spd = vec2Length(ball.velocity);
      const impactStrength = Math.min(1, spd / 400);
      playWallHitSound(impactStrength);
    }
  }

  // UNIFIED WALL MODEL: Balls bounce off all walls (board edges, obstacles, user walls).
  // Broad-phase: with the spatial index present, test only the walls near the
  // ball. queryWallsNear returns a superset in ascending game.walls order, so
  // the resolution below is bit-identical to scanning every wall (see
  // wallGrid.ts). No grid (e.g. unit tests calling updateBall directly) -> full scan.
  const wallGrid = game.wallGrid;
  const candidateWalls = wallGrid
    ? queryWallsNear(
        wallGrid,
        ball.position.x,
        ball.position.y,
        ball.radius + wallGrid.maxThickness / 2 + WALL_QUERY_SLACK,
        _wallScratch,
      )
    : game.walls;
  for (const wall of candidateWalls) {
    // Skip board edge walls (already handled by boardPolygon collision above).
    // The prefix check is cached: a string scan per wall per ball per step adds up.
    if (wall.isBoardEdge === undefined) wall.isBoardEdge = wall.id.startsWith("board-");
    if (wall.isBoardEdge) continue;
    // A phased-out obstacle's edge walls are intangible this frame (#64).
    if (phasedOut && phasedOut.walls.has(wall.id)) continue;
    // ...and so are the edges of a membrane or gate this ball may cross. An
    // obstacle is in BOTH collision systems; honouring the rule only in the
    // polygon check above gives a wall that lets balls through its middle and
    // bounces them off its edges, which is worse than not having the mechanic.
    if (wall.passRule && ballMayPass(wall.passRule, ball, ball.velocity)) continue;
    // ...and at its edges. Honouring it in only one of the two collision
    // systems would give a portal balls fall into and then bounce off the rim
    // of, which is the trap the pass-rule comment above already warns about.
    if (wall.portal) continue;

    const vBefore = { x: ball.velocity.x, y: ball.velocity.y };
    const impactPoint = collideBallWithWall(ball, wall);

    // Register wall impact for visual effect
    if (impactPoint) {
      surfaceHit = true;
      // The same dent from the edge as from the face. `wall.deformable` is the
      // very object the polygon map holds, so the two paths cannot disagree.
      // Read the normal off the wall BEFORE the dent moves it.
      if (wall.deformable) {
        const dex = wall.end.x - wall.start.x, dey = wall.end.y - wall.start.y;
        const del = Math.hypot(dex, dey) || 1;
        const dvn = Math.abs(ball.velocity.x * (-dey / del) + ball.velocity.y * (dex / del));
        applyDeformable(ball, wall.deformable, impactPoint, dvn, now);
      }
      // The same kick from the edge as from the face. `wall.bouncer` is the very
      // object the polygon map holds, so the two paths cannot disagree.
      applyBouncer(game, ball, wall.bouncer, now);
      const spd = vec2Length(ball.velocity);
      const impactStrength = Math.min(1, spd / 400);
      const isObstacleWall = wall.id.startsWith("obstacle-");
      // Fences/board edges bulge as walls; obstacles get a radial bulge below
      // (a wall bulge here would also be invisible and could leak onto nearby fences).
      if (!isObstacleWall) {
        registerWallImpact(wall.start, wall.end, impactPoint, impactStrength, ball.position);
      }
      triggerWallHit(ball.effects, now, ...bounceImpact(vBefore, ball.velocity));
      playWallHitSound(impactStrength);

      // Ascension fence durability: each (debounced) hit wears the fence down.
      // Exhausted fences are queued and broken after the physics step.
      if (wall.hitsLeft !== undefined) {
        if (wall.lastDamageAt === undefined || now - wall.lastDamageAt > 250) {
          wall.lastDamageAt = now;
          wall.hitsLeft--;
          if (wall.hitsLeft <= 0) game.pendingWallBreaks.push(wall);
        }
      }

      // Black-ball fence fracture (#64): a black wrecking ball cracks the player's
      // own fences apart in three hits (each hit fractures). Only player fences
      // (not board edges, already skipped, nor obstacle boundaries below).
      if (!isObstacleWall && ball.ability === 'breakObjects') {
        registerFenceFracture(game, wall, now);
      }

      // Destructible obstacles are bounced by these edge walls, so hits are
      // counted here (the polygon-collision path rarely fires). Mirrors: black
      // ball only (#37). Breakables: any ball, black counts double (#38).
      if (isObstacleWall) {
        const oid = obstacleIdFromWallId(wall.id);
        if (oid) {
          const d = findObstacleDestructibleById(game, oid);
          if (d) {
            // Force of the hit = closing speed along the wall normal × ball mass.
            // (Reflection preserves the normal-speed magnitude, so post-bounce
            // velocity gives the same |vₙ| as the incoming ball.)
            const ex = wall.end.x - wall.start.x, ey = wall.end.y - wall.start.y;
            const el = Math.hypot(ex, ey) || 1;
            const nvx = -ey / el, nvy = ex / el;
            const vn = Math.abs(ball.velocity.x * nvx + ball.velocity.y * nvy);
            const dmg = ballImpactDamage(ball, vn);
            if (d.kind === 'breakable') {
              registerObjectHit(game, d, ball.id, now, dmg, impactPoint ?? undefined);
            } else if (d.kind === 'mirror' && ball.ability === 'breakObjects') {
              registerObjectHit(game, d, ball.id, now, dmg, impactPoint ?? undefined);
            }
          }
          // Gentle bulge for every obstacle except a mirror: glass that flexes
          // reads as rubber, and its specular treatment already says breakable.
          // Breakables DO bulge (they used to be excluded on the grounds their
          // cracks told the story, and they did not). Movers never reach this
          // path. Push the boundary outward, away from the ball.
          // Breakables DO bulge now. They were excluded on the grounds that
          // cracks and dent notches already told the story, and they did not:
          // a breakable wall took a hit and sat there, so nothing distinguished
          // it from the solid wall beside it until it shattered. Cracks say
          // "this has been damaged"; the give is what says "this can be".
          //
          // Mirrors stay out. Glass that flexes is the wrong material entirely,
          // and they have a specular treatment that reads as breakable already.
          if (!wall.isMirror && d?.kind !== 'mirror') {
            const ex = wall.end.x - wall.start.x, ey = wall.end.y - wall.start.y;
            const el = Math.hypot(ex, ey) || 1;
            let onx = -ey / el, ony = ex / el;
            const sd = (ball.position.x - impactPoint.x) * onx + (ball.position.y - impactPoint.y) * ony;
            if (sd > 0) { onx = -onx; ony = -ony; }
            registerObstacleImpact(impactPoint, onx, ony, impactStrength);
          }
        }
      }
    }
  }

  // ── Ball-type speed abilities (issue #37) ────────────────────────────────
  // Yellow: every surface contact picks a new random speed within its range
  // (never below its minimum). The range itself can be shrunk by a purple.
  if (ball.ability === 'variableSpeed' && surfaceHit && ball.speedRange) {
    if (now - (ball.lastSpeedStepAt ?? 0) > 90) {
      ball.lastSpeedStepAt = now;
      const lo = Math.max(ball.minimumSpeed, ball.speedRange[0]);
      const hi = Math.max(lo, ball.speedRange[1]);
      const target = lo + runStream("variableSpeed")() * (hi - lo);
      const cur = Math.hypot(ball.velocity.x, ball.velocity.y);
      if (cur > 1e-6) {
        const r = target / cur;
        ball.velocity.x *= r;
        ball.velocity.y *= r;
      }
      ball.speed = target;
    }
  }

  // Grey: winds down by 10 speed every 5 seconds, down to its minimum speed.
  if (ball.ability === 'slowDown') {
    const steps = Math.floor((now - ball.spawnTime) / 5000);
    const target = Math.max(ball.minimumSpeed, ball.baseSpeed - 10 * game.ballSpeedScale * steps);
    const cur = Math.hypot(ball.velocity.x, ball.velocity.y);
    if (cur > 1e-6) {
      const r = target / cur;
      ball.velocity.x *= r;
      ball.velocity.y *= r;
    }
    ball.speed = target;
  }

  // Universal minimum-speed floor: no active ball may move below its
  // minimumSpeed for ANY reason — collisions, the MicroManager upgrade, etc.
  // (The post-cut recovery freeze is exempt; it's held in place on purpose.)
  if (ball.minimumSpeed > 0 && !(game.frozenBallId && ball.id === game.frozenBallId)) {
    // Nothing is non-finite by here: sanitise() runs at the top of this
    // function, before the step that would spread the damage. `cur > 1e-6` is
    // FALSE for NaN, so without that a corrupt velocity fell into the
    // stopped-ball branch below and was laundered into a clean, wrong nudge
    // every frame - a permanent standstill that nothing reported.
    const cur = Math.hypot(ball.velocity.x, ball.velocity.y);
    if (cur > 1e-6) {
      if (cur < ball.minimumSpeed) {
        const r = ball.minimumSpeed / cur;
        ball.velocity.x *= r;
        ball.velocity.y *= r;
        ball.speed = ball.minimumSpeed;
      }
    } else {
      // Fully stopped but should be moving — nudge it back to its floor.
      //
      // AIMED INWARD, not along +x. A fixed +x nudge is a trap on the right
      // wall: the ball is pushed into it, the board resolver reflects it, this
      // branch fires again and points it straight back at the wall. That is a
      // permanent standstill, and a ball that has stopped is one the player can
      // fence around for free on a map whose gate is a size threshold.
      //
      // The board centre is the one direction guaranteed to be into open space
      // from anywhere on the board, so the recovery cannot re-wedge itself.
      const c = game.boardPolygon ? polygonCentroid(game.boardPolygon) : null;
      let dx = c ? c.x - ball.position.x : 1;
      let dy = c ? c.y - ball.position.y : 0;
      const len = Math.hypot(dx, dy);
      // Dead centre (or no board): any heading is as good as any other.
      if (!(len > 1e-6)) { dx = 1; dy = 0; }
      else { dx /= len; dy /= len; }
      ball.velocity.x = dx * ball.minimumSpeed;
      ball.velocity.y = dy * ball.minimumSpeed;
      ball.speed = ball.minimumSpeed;
    }
  }

  // CRITICAL: Region containment check using strict ownership system
  // After all collisions, verify ball is still within its assigned region
  // SKIP for frozen balls - they should not be moved during freeze
  if (game.frozenBallId && ball.id === game.frozenBallId) return;

  // O(1) fast accept: ball sits in an ACTIVE grid cell painted with its own
  // region id (painted at init and after every cut). This replaces a scan of
  // up to ~3,000 sample points per ball per physics step. A miss is NOT an
  // escape — cells near walls are unpainted — so fall through to the full
  // sample-based validation below.
  if (game.spaceGrid && isBallCellInRegion(game.spaceGrid, ball.position, ball.regionId)) return;

  // A ball part-way through a membrane or gate is inside an obstacle, and an
  // obstacle's footprint is SUBTRACTED from the playable space - so it is
  // legitimately in no region at all for a few frames. Without this it gets
  // "recovered" straight back out the side it came in, which looks exactly
  // like the membrane being solid and is how this mechanic first appeared not
  // to work at all. It is transiting; leave it alone until it lands.
  //
  // The test is the ball's BODY against the obstacle's bounds, not its centre
  // against the outline. A ball whose centre has just cleared the far face is
  // still straddling it, still overlapping space that belongs to no region,
  // and gets thrown back the way it came - which is what the first version of
  // this did: the ball entered the gate, crossed it, and bounced out a frame
  // after its centre emerged.
  if (game.obstacleRules?.size) {
    for (const [poly, rule] of game.obstacleRules) {
      if (!ballMayPass(rule, ball, ball.velocity)) continue;
      const b = getObstacleBounds(poly);
      const reach = ball.radius + WALL_THICKNESS;
      if (ball.position.x >= b.minX - reach && ball.position.x <= b.maxX + reach
        && ball.position.y >= b.minY - reach && ball.position.y <= b.maxY + reach) {
        return;
      }
    }
  }

  const ballRegion = game.regions.find(r => r.id === ball.regionId);
  if (!ballRegion) return;

  // Use strict region ownership validation
  const isInAssigned = isBallInRegion(ball.position, ballRegion, game.walls);

  if (isInAssigned) return; // Ball is valid in its assigned region

  // Ball escaped - try to find which region it's actually in
  const actualRegion = findContainingRegion(ball.position, game.regions, game.walls);

  if (actualRegion) {
    // Ball moved to a different region - reassign it
    ball.regionId = actualRegion.id;
    return;
  }

  // Ball is not in ANY region - use constraint system to recover
  const constraint = constrainBallToRegion(ball, ballRegion, game.walls);

  if (constraint.corrected) {
    ball.position = constraint.position;
    if (constraint.newVelocity) {
      ball.velocity = constraint.newVelocity;
    }
    console.warn("[OWNERSHIP] Ball", ball.id, "escaped, recovered to region", ball.regionId);
  }
}
