import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import { handleGameOverFn, handlePushFailedFn } from "./handleGameOver";
import { circleCapsuleCollision, lineSegmentIntersection, pointInPolygon, vec2Distance, vec2Normalize, vec2Sub, vec2Add, vec2Scale } from "@/lib/polygon";
import { getWallSpeedBase } from "@/lib/gameUtils";
import { MINIMUM_WALL_TIME, RECOVERY_WINDOW_MS } from "@/lib/gameConstants";
import { playFenceBreakSound } from "@/lib/gameAudio";

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
): void {
  const { activeWall: wall, regions, balls } = game;
  if (!wall || wall.isComplete) return;

  const activeRegion = regions.find(r => r.id === wall.activeRegionId);
  if (!activeRegion) { game.activeWall = null; return; }

  const wallSpeedBase = getWallSpeedBase(levelNumber, fenceSpeedBase, fenceSpeedMin, fenceSpeedPerLevel);
  const wallSpeedEffective = wallSpeedBase * activeModifiers.fenceGenerationSpeedMultiplier;

  let totalStartPath = 0;
  for (let i = 0; i < wall.startWaypoints.length - 1; i++) {
    totalStartPath += vec2Distance(wall.startWaypoints[i], wall.startWaypoints[i + 1]);
  }
  let totalEndPath = 0;
  for (let i = 0; i < wall.endWaypoints.length - 1; i++) {
    totalEndPath += vec2Distance(wall.endWaypoints[i], wall.endWaypoints[i + 1]);
  }
  const longestHalf = Math.max(totalStartPath, totalEndPath);
  const wallSpeedFinal = Math.min(wallSpeedEffective, longestHalf / MINIMUM_WALL_TIME);

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

    game.frozenBallId = null;
    game.frozenBallPosition = null;
    game.frozenBallVelocity = null;
    playFenceBreakSound();
    const newLives = callbacks.getLives() - 1;
    callbacks.setLivesRef(newLives);
    callbacks.setDisplayLives(newLives);
    callbacks.onLivesChange(newLives);
    game.activeWall = null;
    if (newLives <= 0) {
      handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks);
      return;
    }
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
    ball.velocity = { x: 0, y: 0 };

    const unfreezeAfterShake = () => {
      const frozen = game.balls.find(b => b.id === game.frozenBallId);
      if (frozen) {
        if (game.frozenBallPosition) frozen.position = game.frozenBallPosition;
        if (game.frozenBallVelocity) frozen.velocity = game.frozenBallVelocity;
      }
      game.frozenBallId = null;
      game.frozenBallPosition = null;
      game.frozenBallVelocity = null;
    };

    // Shield absorbs the hit
    if (game.wallShieldsRemaining > 0) {
      game.wallShieldsRemaining--;
      callbacks.setWallShieldCount(game.wallShieldsRemaining);
      game.activeWall = null;
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
      game.activeWall = null;
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
    playFenceBreakSound();
    const newLives = callbacks.getLives() - 1;
    callbacks.setLivesRef(newLives);
    callbacks.setDisplayLives(newLives);
    callbacks.onLivesChange(newLives);
    game.activeWall = null;

    if (newLives <= 0) {
      game.frozenBallId = null;
      game.frozenBallPosition = null;
      game.frozenBallVelocity = null;
      handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks);
      return;
    }

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
