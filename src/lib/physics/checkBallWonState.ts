import { Vector2, Ball } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import {
  findGridRegions,
  countActiveCells,
  buildGridRegionMap,
  findGridRegionForBall,
} from "@/lib/spaceGrid";
import { lineSegmentIntersection, vec2Length } from "@/lib/polygon";
import { effectiveBallSpeedFactor } from "@/lib/ballTypes";
import { LockDustParticle } from "@/types/game";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import { playBallLockSound } from "@/lib/gameAudio";
import { vibrateBallLock } from "@/lib/gameHaptics";
import { getLockValue } from "@/lib/scoring";

/**
 * MicroManager: each locked ball slows the survivors. Caps every active ball's
 * speed to a fraction of its NORMAL (type) base speed that shrinks as more
 * balls are locked — but never below MIN_BALL_SPEED_FACTOR of normal once the
 * ballSpeedMultiplier is folded in (issue #42). The floor is enforced by
 * effectiveBallSpeedFactor so the cap and the bottom-bar readout agree.
 */
export function applyMicroManagerSpeedCap(
  balls: Ball[],
  activeModifiers: GameModifiers,
  totalLocked: number,
): void {
  if (activeModifiers.microManagerPerLock <= 0 || totalLocked <= 0) return;
  const microFactor = Math.pow(1 - activeModifiers.microManagerPerLock, totalLocked);
  const combined = effectiveBallSpeedFactor(activeModifiers.ballSpeedMultiplier, microFactor);
  // Spawn folded ballSpeedMultiplier (floored) into baseSpeed, so divide it back
  // out to recover the ball's normal type speed before applying the floored cap.
  const spawnScale = effectiveBallSpeedFactor(activeModifiers.ballSpeedMultiplier, 1);
  for (const ball of balls) {
    if (ball.state === 'won' || ball.speed === 0) continue;
    const actualSpeed = vec2Length(ball.velocity);
    const normalSpeed = ball.baseSpeed / spawnScale;
    const cappedSpeed = normalSpeed * combined;
    if (actualSpeed > cappedSpeed && cappedSpeed > 0) {
      const ratio = cappedSpeed / actualSpeed;
      ball.velocity.x *= ratio;
      ball.velocity.y *= ratio;
      ball.speed = cappedSpeed;
    }
  }
}

export function checkAndUpdateBallWonStates(
  game: CanvasGameState,
  activeModifiers: GameModifiers,
  cumulativeLockedBalls: number,
  callbacks: Pick<GameCallbacks, 'setLockedBallsCount' | 'onBallTypeLocked'>,
): boolean {
  if (!game.spaceGrid) return false;

  let anyBallWon = false;
  const prevLockedCount = game.lockedBallsCount;
  const wonThisPass: typeof game.balls = [];
  const gridRegions = findGridRegions(game.spaceGrid);
  const gridRegionMap = buildGridRegionMap(gridRegions);

  // Snapshot the win denominator inputs ONCE before the loop. Computing these
  // per-ball makes the win threshold order-dependent: as earlier balls lock,
  // `activeBalls` shrinks and later balls in the same pass get a different
  // verdict, so two balls in symmetric regions could disagree.
  const currentActive = countActiveCells(game.spaceGrid);
  const activeBalls = game.balls.filter(b => b.state !== 'won' && b.speed > 0).length;
  const denominator = Math.max(currentActive, Math.floor(game.spaceGrid.initialActiveCount / Math.max(1, activeBalls)));

  for (const ball of game.balls) {
    if (ball.state === 'won' || ball.speed === 0) continue;

    // Use neighbour-search fallback: ball may sit in a REMOVED cell (e.g. its grid-cell
    // centre fractionally overlaps a mirror-polygon boundary even though the ball itself
    // is outside the obstacle).
    const ballRegion = findGridRegionForBall(game.spaceGrid, gridRegionMap, ball.position.x, ball.position.y);
    if (!ballRegion) continue;

    // Lock rule (configurable via game-config.yml `lock:`; see GameCanvas):
    // a ball locks when its region is small enough by PERCENT of the win
    // denominator, OR — when the sliver floor is enabled — at/below an absolute
    // cell count (so a ball can't bounce forever in a tiny region just above
    // the %).
    const regionCells = ballRegion.cellIndices.length;
    const threshold = game.lockWinThresholdPercent ?? BALL_WON_REGION_THRESHOLD;
    const minCells = game.lockMinRegionCells ?? 0;
    const percentage = (regionCells / denominator) * 100;
    const lockedByPercent = percentage <= threshold;
    const lockedBySliver = minCells > 0 && regionCells <= minCells;
    if (!lockedByPercent && !lockedBySliver) continue;

    ball.state = 'won';
    ball.wonTime = performance.now();
    ball.velocity = { x: 0, y: 0 };
    ball.speed = 0;

    // Centre the locked ball in its region: its bounce position at the instant
    // of lock is off-centre, which showed up as a misplaced ball once motion
    // stopped (most visibly on the frozen level-clear frame). Physics state
    // snaps immediately; the RENDER position glides there over the lock pulse
    // (see the tween in useGameLoop's interpolation pass, keyed off the
    // assimilation's ballPos = the catch position captured below).
    const catchPos = { x: ball.position.x, y: ball.position.y };
    {
      const c = ballRegion.centroid;
      ball.position = { x: c.x, y: c.y };
      ball.prevPosition = { x: c.x, y: c.y };
      ball.renderPosition = { x: catchPos.x, y: catchPos.y };
    }

    // Track this lock for tutorial ball-type intel: fires once per lock, BEFORE
    // the assimilation state is built below, so a first-time capture can
    // decorate that same lock animation with the "Info Unlocked" flash.
    const isFirstEncounter = callbacks.onBallTypeLocked?.(ball.typeId) ?? false;

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
        ballPos: catchPos,
        ballColor: ball.color,
        particles,
        firstEncounter: isFirstEncounter,
      });
      playBallLockSound();
      vibrateBallLock();
    }

    game.lockedBallsCount += 1;
    wonThisPass.push(ball);

    applyMicroManagerSpeedCap(
      game.balls,
      activeModifiers,
      cumulativeLockedBalls + game.lockedBallsCount,
    );

    callbacks.setLockedBallsCount(game.lockedBallsCount);
    anyBallWon = true;
  }

  // Simultaneous-trap bonus: trapping multiple balls in a single cut multiplies
  // the locking points. 1 ball → ×1, 2 balls → ×2 (double), 3 → ×3 (triple).
  // Each ball contributes its own lock-multiplier (issue #37: e.g. green/yellow
  // ×2, black ×4), and the green "money ball" triples every subsequent lock this
  // map via game.moneyMultiplier.
  const newlyLocked = game.lockedBallsCount - prevLockedCount;
  if (newlyLocked > 0) {
    // Chain Reaction (lock set bonus): every lock pass counts as N balls
    // bigger for the simultaneous-trap multiplier.
    const simultaneousMultiplier = newlyLocked + activeModifiers.simultaneousLockBonus; // 1× / 2× / 3× ...

    // Green "money ball" tripling. It applies to every other lock — including
    // balls trapped in the SAME cut as the green — and to all subsequent locks
    // this map (via game.moneyMultiplier). A green's own lock is never tripled
    // by itself, so each ball is tripled by every green this pass except itself.
    const greensThisPass = wonThisPass.filter(b => b.ability === 'moneyBall').length;
    let points = 0;
    for (const b of wonThisPass) {
      const selfGreen = b.ability === 'moneyBall' ? 1 : 0;
      const mult = game.moneyMultiplier * Math.pow(3, greensThisPass - selfGreen);
      // Frozen Assets: a ball locked while still frozen pays a multiplied lock
      // bonus (wonTime is "now" for this pass, so compare frozenUntil to it).
      const lockedWhileFrozen =
        b.frozenUntil !== undefined && b.frozenUntil > (b.wonTime ?? performance.now());
      const frozenMult =
        lockedWhileFrozen && activeModifiers.frozenLockBonus > 0
          ? 1 + activeModifiers.frozenLockBonus
          : 1;
      points += (b.lockMultiplier ?? 1) * mult * frozenMult;
    }
    // Each lock-multiplier point is worth lockValue overtime hours (the
    // economy's main income; scoring-config.yml). Still folds under the
    // per-map cap with everything else.
    game.lockBonus += Math.round(points * simultaneousMultiplier * getLockValue());

    // Severance Package: flat overtime per locked ball, deliberately outside
    // the money/simultaneous multipliers so it reads as a predictable "+N per
    // lock" (still folded under the per-map cap with the rest of lockBonus).
    if (activeModifiers.overtimePerLock > 0) {
      game.lockBonus += newlyLocked * activeModifiers.overtimePerLock;
    }

    if (greensThisPass > 0) game.moneyMultiplier *= Math.pow(3, greensThisPass);
  }

  return anyBallWon;
}
