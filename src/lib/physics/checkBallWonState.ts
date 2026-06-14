import { Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import {
  findGridRegions,
  countActiveCells,
  worldToGridIndex,
} from "@/lib/spaceGrid";
import { lineSegmentIntersection, vec2Length } from "@/lib/polygon";
import { LockDustParticle } from "@/types/game";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import { playBallLockSound } from "@/lib/gameAudio";
import { vibrateBallLock } from "@/lib/gameHaptics";

export function checkAndUpdateBallWonStates(
  game: CanvasGameState,
  activeModifiers: GameModifiers,
  cumulativeLockedBalls: number,
  callbacks: Pick<GameCallbacks, 'setLockedBallsCount'>,
): boolean {
  if (!game.spaceGrid) return false;

  let anyBallWon = false;
  const prevLockedCount = game.lockedBallsCount;
  const gridRegions = findGridRegions(game.spaceGrid);

  for (const ball of game.balls) {
    if (ball.state === 'won' || ball.speed === 0) continue;

    const ballGridIndex = worldToGridIndex(game.spaceGrid, ball.position.x, ball.position.y);
    if (ballGridIndex < 0) continue;

    let ballRegion = null;
    for (const region of gridRegions) {
      if (region.cellIndices.includes(ballGridIndex)) { ballRegion = region; break; }
    }
    if (!ballRegion) continue;

    const currentActive = countActiveCells(game.spaceGrid);
    const activeBalls = game.balls.filter(b => b.state !== 'won' && b.speed > 0).length;
    const denominator = Math.max(currentActive, Math.floor(game.spaceGrid.initialActiveCount / Math.max(1, activeBalls)));
    const percentage = (ballRegion.cellIndices.length / denominator) * 100;
    if (percentage > BALL_WON_REGION_THRESHOLD) continue;

    ball.state = 'won';
    ball.wonTime = performance.now();
    ball.velocity = { x: 0, y: 0 };
    ball.speed = 0;

    if (ballRegion.cellIndices.length > 0) {
      const centroid = ballRegion.centroid;
      const RAY_COUNT = 360;
      const RAY_LEN = 4000;
      const hitPoints: Array<{ angle: number; pt: Vector2 }> = [];

      for (let ri = 0; ri < RAY_COUNT; ri++) {
        const angle = (ri / RAY_COUNT) * Math.PI * 2;
        const rayEnd = {
          x: centroid.x + Math.cos(angle) * RAY_LEN,
          y: centroid.y + Math.sin(angle) * RAY_LEN,
        };
        let closestDist = Infinity;
        let closestPt: Vector2 | null = null;
        for (const wall of game.walls) {
          const hit = lineSegmentIntersection(centroid, rayEnd, wall.start, wall.end);
          if (hit) {
            const d = (hit.x - centroid.x) ** 2 + (hit.y - centroid.y) ** 2;
            if (d < closestDist) { closestDist = d; closestPt = hit; }
          }
        }
        if (closestPt) hitPoints.push({ angle, pt: closestPt });
      }

      hitPoints.sort((a, b) => a.angle - b.angle);
      const polygon: Vector2[] = [];
      for (const { pt } of hitPoints) {
        const last = polygon[polygon.length - 1];
        if (!last || Math.abs(pt.x - last.x) > 0.5 || Math.abs(pt.y - last.y) > 0.5) {
          polygon.push(pt);
        }
      }

      const PARTICLE_COUNT = 110;
      const particles: LockDustParticle[] = [
        ...Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
          angle: (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.25,
          speed: 12 + Math.random() * 60,
          lifetime: 350 + Math.random() * 550,
          size: 0.6 + Math.random() * 2.0,
          lengthPx: 4 + Math.random() * 10,
        })),
        ...Array.from({ length: 20 }, (_, i) => ({
          angle: (i / 20) * Math.PI * 2 + (Math.random() - 0.5) * 0.15,
          speed: 40 + Math.random() * 80,
          lifetime: 250 + Math.random() * 300,
          size: 1.0,
          lengthPx: 18 + Math.random() * 22,
        })),
      ];

      game.assimilations.set(ball.id, {
        ballId: ball.id,
        cellIndices: [...ballRegion.cellIndices],
        polygon,
        centroid: { ...ballRegion.centroid },
        startTime: performance.now(),
        ballPos: { ...ball.position },
        ballColor: ball.color,
        particles,
      });
      playBallLockSound();
      vibrateBallLock();
    }

    game.lockedBallsCount += 1;

    if (activeModifiers.microManagerPerLock > 0) {
      const totalLocked = cumulativeLockedBalls + game.lockedBallsCount;
      const speedFactor = Math.max(0.30, Math.pow(1 - activeModifiers.microManagerPerLock, totalLocked));
      for (const other of game.balls) {
        if (other.state === 'won' || other.speed === 0) continue;
        const actualSpeed = vec2Length(other.velocity);
        const cappedSpeed = other.baseSpeed * speedFactor;
        if (actualSpeed > cappedSpeed && cappedSpeed > 0) {
          const ratio = cappedSpeed / actualSpeed;
          other.velocity.x *= ratio;
          other.velocity.y *= ratio;
          other.speed = cappedSpeed;
        }
      }
    }

    callbacks.setLockedBallsCount(game.lockedBallsCount);
    anyBallWon = true;
  }

  const newlyLocked = game.lockedBallsCount - prevLockedCount;
  if (newlyLocked > 0) game.lockBonus += newlyLocked * newlyLocked;

  return anyBallWon;
}
