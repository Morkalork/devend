import { CanvasGameState } from "@/types/gameState";
import { GrowingWall } from "@/types/game";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import {
  ballStruckFence, moverStruckFence, clearFreeze, FREEZE_MAX_MS,
} from "./fenceStrike";
import { readWinSnapshot } from "./applyCut";
import { resolveWinSpec } from "@/lib/winSpec";
import { mapFailure, type MapFailKind } from "@/lib/mapFailure";
import { circleCapsuleCollision, lineSegmentIntersection, pointInPolygon, vec2Distance, vec2Normalize, vec2Sub, vec2Add, vec2Scale } from "@/lib/polygon";
import { getWallSpeedBase } from "@/lib/gameUtils";
import { abilityFenceRushFactor, abilityFenceShieldActive } from "@/lib/abilityEffects";
import { MINIMUM_WALL_TIME } from "@/lib/gameConstants";
import { cutSpeedFactor } from "@/lib/physics/fenceZones";

export { clearFreeze, FREEZE_MAX_MS };

/**
 * Why the run just ended, built from the same spec and snapshot the win check
 * reads. Worked out at the moment of death, because the board is about to be
 * torn down and this is the only record of how close the player had got.
 */
function fenceDeath(
  kind: MapFailKind, game: CanvasGameState, level: LevelConfig,
) {
  return mapFailure(kind, resolveWinSpec(level), readWinSnapshot(game, level));
}

export function updateFenceWallFn(
  dt: number,
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  fenceSpeedBase: number,
  fenceSpeedMin: number,
  fenceSpeedPerLevel: number,
  callbacks: GameCallbacks,
  wall: GrowingWall,
): void {
  const { regions, balls } = game;
  if (!wall || wall.isComplete) return;

  const activeRegion = regions.find(r => r.id === wall.activeRegionId);
  if (!activeRegion) { game.activeWalls = game.activeWalls.filter(w => w !== wall); return; }

  const wallSpeedBase = getWallSpeedBase(levelNumber, fenceSpeedBase, fenceSpeedMin, fenceSpeedPerLevel);
  // Knowledge Transfer: every ball locked this map speeds up fence generation
  // for the rest of the map (lockedBallsCount resets per map). Continuous
  // Delivery does the same per completed fence (wallCount resets per map too).
  const lockTempo = 1
    + activeModifiers.fenceSpeedPerLock * game.lockedBallsCount
    + activeModifiers.fenceSpeedPerFence * game.wallCount;
  // Fence Overclock ability (#38): cuts build much faster for a few seconds.
  const rush = abilityFenceRushFactor(game);
  // Fence-speed ground. Folded in here with the other multipliers rather than
  // applied to each frame's growth: growth is driven by an ease curve over
  // elapsed time and force-snapped when it completes, so a per-tip factor would
  // change the SHAPE of the build and not its duration - the one thing a slow
  // zone exists to change. Computed over the longer half's whole path, once.
  const terrain = cutSpeedFactor(game.fenceZones, wall.startWaypoints, wall.endWaypoints);
  const wallSpeedEffective =
    wallSpeedBase * activeModifiers.fenceGenerationSpeedMultiplier * lockTempo * rush * terrain;

  let totalStartPath = 0;
  for (let i = 0; i < wall.startWaypoints.length - 1; i++) {
    totalStartPath += vec2Distance(wall.startWaypoints[i], wall.startWaypoints[i + 1]);
  }
  let totalEndPath = 0;
  for (let i = 0; i < wall.endWaypoints.length - 1; i++) {
    totalEndPath += vec2Distance(wall.endWaypoints[i], wall.endWaypoints[i + 1]);
  }
  const longestHalf = Math.max(totalStartPath, totalEndPath);
  // The 0.35s minimum build time keeps normal cuts from being degenerate-instant,
  // but it also swallows Overclock's speed-up (short cuts already sit at the
  // floor). Lower the floor by the rush factor too, so Overclock actually makes
  // cuts near-instant instead of just nudging the longest ones.
  // The floor is a MINIMUM build time, i.e. a maximum speed, and it swallows
  // speed-ups on short cuts - the note above records Overclock hitting exactly
  // this. Fast ground would hit it too, so it lifts the floor the same way.
  // Only when terrain > 1: slow ground already sits well under the cap, and
  // dividing by a factor below 1 would RAISE the floor and cap a slow fence
  // twice.
  const minWallTime = MINIMUM_WALL_TIME / (rush * Math.max(1, terrain));
  const wallSpeedFinal = Math.min(wallSpeedEffective, longestHalf / minWallTime);

  const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  let growth: number;
  if (wall.startTime) {
    const elapsed = (performance.now() - wall.startTime) / 1000;
    const expectedDuration = longestHalf / wallSpeedFinal;
    const currT = Math.max(0, Math.min(1, elapsed / expectedDuration));

    if (currT >= 1) {
      wall.startPoint = { ...wall.targetStart };
      wall.startSegmentIndex = Math.max(0, wall.startWaypoints.length - 2);
      wall.endPoint = { ...wall.targetEnd };
      wall.endSegmentIndex = Math.max(0, wall.endWaypoints.length - 2);
      wall.isComplete = true;
      return;
    }

    const prevT = Math.max(0, Math.min(1, (elapsed - dt) / expectedDuration));
    growth = (easeInOut(currT) - easeInOut(prevT)) * longestHalf;
  } else {
    growth = wallSpeedFinal * dt;
  }

  // Grow start side
  {
    let remaining = growth;
    while (remaining > 0.01 && wall.startSegmentIndex < wall.startWaypoints.length - 1) {
      const segTarget = wall.startWaypoints[wall.startSegmentIndex + 1];
      const dist = vec2Distance(wall.startPoint, segTarget);
      if (dist <= remaining + 0.5) {
        wall.startPoint = { ...segTarget };
        remaining -= dist;
        wall.startSegmentIndex++;
      } else {
        const dir = vec2Normalize(vec2Sub(segTarget, wall.startPoint));
        wall.startPoint = vec2Add(wall.startPoint, vec2Scale(dir, remaining));
        remaining = 0;
      }
    }
  }

  // Grow end side
  {
    let remaining = growth;
    while (remaining > 0.01 && wall.endSegmentIndex < wall.endWaypoints.length - 1) {
      const segTarget = wall.endWaypoints[wall.endSegmentIndex + 1];
      const dist = vec2Distance(wall.endPoint, segTarget);
      if (dist <= remaining + 0.5) {
        wall.endPoint = { ...segTarget };
        remaining -= dist;
        wall.endSegmentIndex++;
      } else {
        const dir = vec2Normalize(vec2Sub(segTarget, wall.endPoint));
        wall.endPoint = vec2Add(wall.endPoint, vec2Scale(dir, remaining));
        remaining = 0;
      }
    }
  }

  const startDone = vec2Distance(wall.startPoint, wall.targetStart) < 1;
  const endDone = vec2Distance(wall.endPoint, wall.targetEnd) < 1;
  if (startDone && endDone) {
    wall.startPoint = { ...wall.targetStart };
    wall.endPoint = { ...wall.targetEnd };
    if (!wall.isComplete) wall.isComplete = true;
  }

  if (wall.isComplete || game.isRecovering) return;

  // Collision check against all growing segments
  const allSegments: { start: typeof wall.startPoint; end: typeof wall.startPoint }[] = [];
  for (let i = 0; i < wall.startSegmentIndex; i++) {
    allSegments.push({ start: wall.startWaypoints[i], end: wall.startWaypoints[i + 1] });
  }
  allSegments.push({ start: wall.startWaypoints[wall.startSegmentIndex], end: wall.startPoint });
  for (let i = 0; i < wall.endSegmentIndex; i++) {
    allSegments.push({ start: wall.endWaypoints[i], end: wall.endWaypoints[i + 1] });
  }
  allSegments.push({ start: wall.endWaypoints[wall.endSegmentIndex], end: wall.endPoint });

  // Fence growing into a mover = lose a life (same consequence as a ball hit)
  for (const mover of game.movers) {
    const verts = mover.polygon.vertices;
    let moverHit = false;
    outer: for (const seg of allSegments) {
      // Fence tip inside mover polygon
      if (pointInPolygon(seg.end, mover.polygon)) { moverHit = true; break; }
      // Fence segment crosses a mover polygon edge
      for (let vi = 0; vi < verts.length; vi++) {
        if (lineSegmentIntersection(seg.start, seg.end, verts[vi], verts[(vi + 1) % verts.length])) {
          moverHit = true; break outer;
        }
      }
    }
    if (!moverHit) continue;

    moverStruckFence(game, level, levelNumber, activeModifiers, callbacks,
      fenceDeath("moverHitFence", game, level));
    return;
  }

  // Ghost Protocol: a young fence phases through balls entirely for its first
  // fenceGraceMs of growth (no bounce either - growing fences never deflect
  // balls, so "ignore" is symmetric).
  //
  // Sourced from the Ghost Protocol upgrade family and from the Hotfix in Prod
  // loadout; it was loadout-only, and this comment used to say "capstone",
  // which it has never been.
  if (
    activeModifiers.fenceGraceMs > 0 &&
    wall.startTime &&
    performance.now() - wall.startTime < activeModifiers.fenceGraceMs
  ) {
    return;
  }

  // Fence Shield ability (#38): the growing fence phases through balls for the
  // ability's window, so a cut through a busy lane survives ball hits.
  if (abilityFenceShieldActive(game)) return;

  for (const ball of balls) {
    let hit = false;
    for (const seg of allSegments) {
      if (circleCapsuleCollision(ball.position, ball.radius, seg.start, seg.end, wall.thickness / 2)) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;

    ballStruckFence(game, ball, level, levelNumber, activeModifiers, callbacks,
      fenceDeath("ballHitFence", game, level));
    return;
  }
}
