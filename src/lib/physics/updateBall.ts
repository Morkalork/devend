/**
 * updateBall — per-frame ball physics step.
 *
 * Extracted from GameCanvas so it can be unit-tested and shared with future
 * server-side simulation without dragging in React.
 */

import { Ball, Vector2 } from "@/types/game";
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
import { registerWallImpact } from "@/lib/wallImpactEffects";
import {
  REGION_SAMPLE_GRID_SIZE,
  isBallInRegion,
  isBallCellInRegion,
  findContainingRegion,
  constrainBallToRegion,
} from "@/lib/regionOwnership";
import { playWallHitSound, playBossJumpSound, playBossLandSound } from "@/lib/gameAudio";
import { updateBallEffects, triggerWallHit } from "@/lib/ballEffects";
import { findMoverDestructible, findObstacleDestructibleById, obstacleIdFromWallId, registerObjectHit, ballImpactDamage } from "@/lib/physics/destructibles";

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

/** Update ball position and bounce off all walls (all in world coordinates). */
export function updateBall(ball: Ball, dt: number, game: CanvasGameState): void {
  if (ball.state === 'won') return; // stopped and disintegrating

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
  const moveDt = dt * (game.creepFactor || 1) * splitFactor;
  ball.position.x += ball.velocity.x * moveDt;
  ball.position.y += ball.velocity.y * moveDt;

  // Conveyor mutator (issue #54): a steady positional drift, not a velocity
  // change, so it never compounds into speed and the wall resolver keeps the
  // ball in bounds (a gentle current). Uses the raw step, independent of creep.
  const mut = game.mapMutator;
  if (mut && mut.behavior === "conveyor") {
    ball.position.x += (mut.driftX || 0) * dt;
    ball.position.y += (mut.driftY || 0) * dt;
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
          impactStrength
        );
        // Trigger wall hit effect on ball
        triggerWallHit(ball.effects, now, ball.velocity.x, ball.velocity.y, vec2Length(ball.velocity));
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
      ball.position = result.position;
      ball.velocity = result.velocity;
      surfaceHit = true;
      triggerWallHit(ball.effects, now, ball.velocity.x, ball.velocity.y, vec2Length(ball.velocity));
      playWallHitSound(Math.min(1, vec2Length(ball.velocity) / 400));
      // Black ball wears down movers (its heavy mass makes short work of them).
      if (ball.ability === 'breakObjects') {
        const d = findMoverDestructible(game, mover.id);
        if (d) registerObjectHit(game, d, ball.id, now, ballImpactDamage(ball, vec2Length(ball.velocity), game.ballDensityBonus ?? 0));
      }
    }
  }

  // CRITICAL: Check obstacle polygon penetration before edge collisions.
  // Obstacles are static, so a cached AABB (inflated by the ball radius)
  // rejects far-away polygons before the per-edge resolver runs — circle
  // obstacles are 64-gons, so this skips 64 segment tests per miss.
  for (const obstacle of game.obstaclePolygons) {
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
      ball.position = obstacleResult.position;
      ball.velocity = obstacleResult.velocity;
      surfaceHit = true;

      // Trigger wall hit effect on ball
      triggerWallHit(ball.effects, now, ball.velocity.x, ball.velocity.y, vec2Length(ball.velocity));

      // Play wall hit sound for obstacle collision
      const spd = vec2Length(ball.velocity);
      const impactStrength = Math.min(1, spd / 400);
      playWallHitSound(impactStrength);
    }
  }

  // UNIFIED WALL MODEL: Balls bounce off all walls (board edges, obstacles, user walls)
  for (const wall of game.walls) {
    // Skip board edge walls (already handled by boardPolygon collision above).
    // The prefix check is cached: a string scan per wall per ball per step adds up.
    if (wall.isBoardEdge === undefined) wall.isBoardEdge = wall.id.startsWith("board-");
    if (wall.isBoardEdge) continue;

    const impactPoint = collideBallWithWall(ball, wall);

    // Register wall impact for visual effect
    if (impactPoint) {
      surfaceHit = true;
      const spd = vec2Length(ball.velocity);
      const impactStrength = Math.min(1, spd / 400);
      registerWallImpact(wall.start, wall.end, impactPoint, impactStrength);
      triggerWallHit(ball.effects, now, ball.velocity.x, ball.velocity.y, vec2Length(ball.velocity));
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

      // Destructible obstacles are bounced by these edge walls, so hits are
      // counted here (the polygon-collision path rarely fires). Mirrors: black
      // ball only (#37). Breakables: any ball, black counts double (#38).
      if (wall.id.startsWith("obstacle-")) {
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
            const dmg = ballImpactDamage(ball, vn, game.ballDensityBonus ?? 0);
            if (d.kind === 'breakable') {
              registerObjectHit(game, d, ball.id, now, dmg, impactPoint ?? undefined);
            } else if (d.kind === 'mirror' && ball.ability === 'breakObjects') {
              registerObjectHit(game, d, ball.id, now, dmg, impactPoint ?? undefined);
            }
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
      const target = lo + Math.random() * (hi - lo);
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
      ball.velocity.x = ball.minimumSpeed;
      ball.velocity.y = 0;
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
