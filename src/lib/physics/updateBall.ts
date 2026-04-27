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
  pointToSegmentDistance,
} from "@/lib/polygon";
import { registerWallImpact } from "@/lib/wallImpactEffects";
import {
  REGION_SAMPLE_GRID_SIZE,
  isBallInRegion,
  findContainingRegion,
  constrainBallToRegion,
} from "@/lib/regionOwnership";
import { playWallHitSound } from "@/lib/gameAudio";
import { updateBallEffects, triggerWallHit } from "@/lib/ballEffects";

// ---------------------------------------------------------------------------
// Helper: resolve ball vs completed-cut line-segment
// ROBUST: Uses larger collision margin and push-out distance to prevent tunneling
// ---------------------------------------------------------------------------
function resolveBallLineCollision(
  ballPos: Vector2,
  ballVel: Vector2,
  ballRadius: number,
  lineStart: Vector2,
  lineEnd: Vector2,
  lineThickness: number,
): { position: Vector2; velocity: Vector2; collided: boolean; impactPoint?: Vector2 } {
  const dist = pointToSegmentDistance(ballPos, lineStart, lineEnd);
  // Use a slightly larger collision zone for detection (helps with fast-moving balls)
  const collisionDist = ballRadius + lineThickness / 2 + 2;

  if (dist < collisionDist) {
    // Get closest point on line
    const edge = vec2Sub(lineEnd, lineStart);
    const edgeLengthSq = edge.x * edge.x + edge.y * edge.y;
    let closestPoint: Vector2;

    if (edgeLengthSq === 0) {
      closestPoint = { ...lineStart };
    } else {
      const t = Math.max(0, Math.min(1, vec2Dot(vec2Sub(ballPos, lineStart), edge) / edgeLengthSq));
      closestPoint = vec2Add(lineStart, vec2Scale(edge, t));
    }

    // Normal points from line toward ball
    const toBall = vec2Sub(ballPos, closestPoint);
    let normal = vec2Normalize(toBall);
    if (vec2Length(toBall) < 0.001) {
      // Ball exactly on line, use perpendicular
      normal = vec2Normalize({ x: -edge.y, y: edge.x });
    }

    // Reflect velocity if moving toward line
    const velDotNormal = vec2Dot(ballVel, normal);
    let newVel = { ...ballVel };
    if (velDotNormal < 0) {
      newVel = vec2Sub(ballVel, vec2Scale(normal, 2 * velDotNormal));
    }

    // Push ball out with generous margin to prevent re-penetration
    const minSafeDist = ballRadius + lineThickness / 2 + 3;
    const pushDist = Math.max(0, minSafeDist - dist);
    const newPos = vec2Add(ballPos, vec2Scale(normal, pushDist + 2));

    return { position: newPos, velocity: newVel, collided: true, impactPoint: closestPoint };
  }

  return { position: ballPos, velocity: ballVel, collided: false };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Update ball position and bounce off all walls (all in world coordinates). */
export function updateBall(ball: Ball, dt: number, game: CanvasGameState): void {
  if (ball.state === 'won') return; // stopped and disintegrating

  // Move ball (world units)
  ball.position.x += ball.velocity.x * dt;
  ball.position.y += ball.velocity.y * dt;

  // Update rotation based on speed (medium spin rate)
  const speed = vec2Length(ball.velocity);
  const rotationSpeed = speed * 0.015; // Radians per second based on speed
  ball.rotation += rotationSpeed * dt;

  // Update ball visual effects (pulse, wall hit, ball hit decays)
  const now = performance.now();
  updateBallEffects(ball.effects, dt, now);

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

  // Resolve collisions with board boundary (always use original board, not region bounding box)
  if (game.boardPolygon) {
    const boardResult = resolveBallPolygonCollision(ball.position, ball.velocity, ball.radius, game.boardPolygon);
    ball.position = boardResult.position;
    ball.velocity = boardResult.velocity;

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
      triggerWallHit(ball.effects, performance.now());
      // Play wall hit sound
      playWallHitSound(impactStrength);
    }
  }

  // Bounce off moving obstacles
  for (const mover of game.movers) {
    const result = resolveBallPolygonCollisionOutward(ball.position, ball.velocity, ball.radius, mover.polygon);
    if (result.collided) {
      ball.position = result.position;
      ball.velocity = result.velocity;
      triggerWallHit(ball.effects, performance.now());
      playWallHitSound(Math.min(1, vec2Length(ball.velocity) / 400));
    }
  }

  // CRITICAL: Check obstacle polygon penetration before edge collisions
  for (const obstacle of game.obstaclePolygons) {
    const obstacleResult = resolveBallPolygonCollisionOutward(
      ball.position,
      ball.velocity,
      ball.radius,
      obstacle
    );
    if (obstacleResult.collided) {
      ball.position = obstacleResult.position;
      ball.velocity = obstacleResult.velocity;

      // Trigger wall hit effect on ball
      triggerWallHit(ball.effects, performance.now());

      // Play wall hit sound for obstacle collision
      const spd = vec2Length(ball.velocity);
      const impactStrength = Math.min(1, spd / 400);
      playWallHitSound(impactStrength);
    }
  }

  // UNIFIED WALL MODEL: Balls bounce off all walls (board edges, obstacles, user walls)
  for (const wall of game.walls) {
    // Skip board edge walls (already handled by boardPolygon collision above)
    if (wall.id.startsWith("board-")) continue;

    const wallResult = resolveBallLineCollision(
      ball.position,
      ball.velocity,
      ball.radius,
      wall.start,
      wall.end,
      wall.thickness,
    );
    ball.position = wallResult.position;
    ball.velocity = wallResult.velocity;

    // Register wall impact for visual effect
    if (wallResult.collided && wallResult.impactPoint) {
      const spd = vec2Length(ball.velocity);
      const impactStrength = Math.min(1, spd / 400);
      registerWallImpact(wall.start, wall.end, wallResult.impactPoint, impactStrength);
      triggerWallHit(ball.effects, performance.now());
      playWallHitSound(impactStrength);
    }
  }

  // CRITICAL: Region containment check using strict ownership system
  // After all collisions, verify ball is still within its assigned region
  // SKIP for frozen balls - they should not be moved during freeze
  if (game.frozenBallId && ball.id === game.frozenBallId) return;

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
