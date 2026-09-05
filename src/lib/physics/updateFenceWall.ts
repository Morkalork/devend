import { CanvasGameState } from "@/types/gameState";
import { GrowingWall } from "@/types/game";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import { handleGameOverFn, handlePushFailedFn } from "./handleGameOver";
import { readWinSnapshot } from "./applyCut";
import { resolveWinSpec } from "@/lib/winSpec";
import { mapFailure, type MapFailKind } from "@/lib/mapFailure";
import { circleCapsuleCollision, lineSegmentIntersection, pointInPolygon, vec2Distance, vec2Normalize, vec2Sub, vec2Add, vec2Scale } from "@/lib/polygon";
import { getWallSpeedBase } from "@/lib/gameUtils";
import { abilityFenceRushFactor, abilityFenceShieldActive } from "@/lib/abilityEffects";
import { MINIMUM_WALL_TIME, RECOVERY_WINDOW_MS } from "@/lib/gameConstants";
import { playFenceBreakSound } from "@/lib/gameAudio";
import { vibrateFenceBreak } from "@/lib/gameHaptics";
import { cutSpeedFactor } from "@/lib/physics/fenceZones";

/**
 * How long a post-break freeze may last before the loop lifts it regardless.
 *
 * The shake timer that normally lifts it runs at 400ms. This is comfortably
 * past that, so the ordinary path always wins and this only ever fires when
 * that timer was cancelled by something with no idea a ball was frozen.
 */
export const FREEZE_MAX_MS = 1500;

/**
 * Drop the post-break freeze, whatever state it is in.
 *
 * One function rather than the four copies of the same four assignments that
 * used to be scattered through this file. The copies are exactly how the
 * deadline came to be missing from one of them in the first place, and how the
 * whole freeze came to be missing from the per-map reset: a clear that has to
 * be remembered in N places is a clear that will be forgotten in one.
 */
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

export function clearFreeze(game: CanvasGameState): void {
  game.frozenBallId = null;
  game.frozenBallPosition = null;
  game.frozenBallVelocity = null;
  game.frozenBallReleaseAt = null;
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

    clearFreeze(game);
    playFenceBreakSound(); vibrateFenceBreak();
    const newLives = callbacks.getLives() - 1;
    callbacks.setLivesRef(newLives);
    callbacks.setDisplayLives(newLives);
    callbacks.onLivesChange(newLives);
    game.activeWalls = [];
    if (newLives <= 0) {
      handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks,
        fenceDeath("moverHitFence", game, level));
      return;
    }
    // A life remains and the map goes on, so this says what happened in the one
    // slot under the board rather than stopping play to explain it.
    callbacks.onGameMessage?.("lifeLostMover");
    game.isRecovering = true;
    game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
    callbacks.setIsRecovering(true);
    if (callbacks.flashTimeoutRef.current) clearTimeout(callbacks.flashTimeoutRef.current);
    if (callbacks.shakeTimeoutRef.current) clearTimeout(callbacks.shakeTimeoutRef.current);
    callbacks.setScreenFlash("red");
    callbacks.setIsShaking(true);
    callbacks.flashTimeoutRef.current = setTimeout(() => { callbacks.setScreenFlash("none"); callbacks.flashTimeoutRef.current = null; }, 200);
    callbacks.shakeTimeoutRef.current = setTimeout(() => { callbacks.setIsShaking(false); }, 400);
    setTimeout(() => { game.isRecovering = false; callbacks.setIsRecovering(false); }, RECOVERY_WINDOW_MS);
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

    // Freeze the ball
    game.frozenBallId = ball.id;
    game.frozenBallPosition = { ...ball.position };
    game.frozenBallVelocity = { ...ball.velocity };
    // The deadline the loop falls back on if the shake timer is cancelled by
    // something that does not know about the freeze. Generous: the timer is
    // the normal path and must be allowed to win.
    game.frozenBallReleaseAt = performance.now() + FREEZE_MAX_MS;
    ball.velocity = { x: 0, y: 0 };

    const unfreezeAfterShake = () => {
      // Identity, not an id lookup. Ball ids are `${type.id}-${index}` and are
      // therefore only unique WITHIN a map, while this timer can outlive the
      // map that scheduled it: looking "grey-0" up on the next map finds a
      // different ball and teleports it to the previous map's coordinates. The
      // per-map reset clears the freeze so this should never see a stale one,
      // but the restore is the destructive half and gets its own check.
      if (game.frozenBallId === ball.id && game.balls.includes(ball)) {
        if (game.frozenBallPosition) ball.position = { ...game.frozenBallPosition };
        if (game.frozenBallVelocity) ball.velocity = { ...game.frozenBallVelocity };
      }
      clearFreeze(game);
    };

    // Shield absorbs the hit
    if (game.wallShieldsRemaining > 0) {
      game.wallShieldsRemaining--;
      callbacks.setWallShieldCount(game.wallShieldsRemaining);
      game.activeWalls = [];
      game.isRecovering = true;
      game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
      callbacks.setIsRecovering(true);
      if (callbacks.flashTimeoutRef.current) clearTimeout(callbacks.flashTimeoutRef.current);
      if (callbacks.shakeTimeoutRef.current) clearTimeout(callbacks.shakeTimeoutRef.current);
      callbacks.setScreenFlash("red");
      callbacks.setIsShaking(true);
      callbacks.flashTimeoutRef.current = setTimeout(() => { callbacks.setScreenFlash("none"); callbacks.flashTimeoutRef.current = null; }, 150);
      callbacks.shakeTimeoutRef.current = setTimeout(() => { callbacks.setIsShaking(false); unfreezeAfterShake(); }, 400);
      setTimeout(() => { game.isRecovering = false; callbacks.setIsRecovering(false); }, RECOVERY_WINDOW_MS);
      return;
    }

    // Push mode — fail the push, not the life
    if (game.pushMode === "pushing") {
      game.activeWalls = [];
      if (callbacks.flashTimeoutRef.current) clearTimeout(callbacks.flashTimeoutRef.current);
      if (callbacks.shakeTimeoutRef.current) clearTimeout(callbacks.shakeTimeoutRef.current);
      callbacks.setScreenFlash("red");
      callbacks.setIsShaking(true);
      callbacks.flashTimeoutRef.current = setTimeout(() => { callbacks.setScreenFlash("none"); callbacks.flashTimeoutRef.current = null; }, 200);
      callbacks.shakeTimeoutRef.current = setTimeout(() => { callbacks.setIsShaking(false); unfreezeAfterShake(); }, 400);
      handlePushFailedFn(game, level, levelNumber, activeModifiers, callbacks);
      return;
    }

    // Lose a life
    playFenceBreakSound(); vibrateFenceBreak();
    const newLives = callbacks.getLives() - 1;
    callbacks.setLivesRef(newLives);
    callbacks.setDisplayLives(newLives);
    callbacks.onLivesChange(newLives);
    game.activeWalls = [];

    if (newLives <= 0) {
      clearFreeze(game);
      handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks,
        fenceDeath("ballHitFence", game, level));
      return;
    }

    callbacks.onGameMessage?.("lifeLostBall");
    game.isRecovering = true;
    game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
    callbacks.setIsRecovering(true);
    if (callbacks.flashTimeoutRef.current) clearTimeout(callbacks.flashTimeoutRef.current);
    if (callbacks.shakeTimeoutRef.current) clearTimeout(callbacks.shakeTimeoutRef.current);
    callbacks.setScreenFlash("red");
    callbacks.setIsShaking(true);
    callbacks.flashTimeoutRef.current = setTimeout(() => { callbacks.setScreenFlash("none"); callbacks.flashTimeoutRef.current = null; }, 200);
    callbacks.shakeTimeoutRef.current = setTimeout(() => { callbacks.setIsShaking(false); unfreezeAfterShake(); }, 400);
    setTimeout(() => { game.isRecovering = false; callbacks.setIsRecovering(false); }, RECOVERY_WINDOW_MS);
    return;
  }
}
