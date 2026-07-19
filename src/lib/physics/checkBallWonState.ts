import { Ball } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import {
  findGridRegions,
  countActiveCells,
  buildGridRegionMap,
  findGridRegionForBall,
  isRegionTrulySealed,
  floodRemovedEnclosure,
  gridIndexToWorld,
  isPositionActive,
  CellState,
} from "@/lib/spaceGrid";
import { vec2Length, lineSegmentIntersection, pointInPolygon, polygonBounds } from "@/lib/polygon";
import { traceContours, snapContoursToWalls } from "@/lib/rendering/regionContour";
import { effectiveBallSpeedFactor } from "@/lib/ballTypes";
import { LockDustParticle } from "@/types/game";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import { playBallLockSound } from "@/lib/gameAudio";
import { vibrateBallLock } from "@/lib/gameHaptics";
import { getLockValue, getLockQuality } from "@/lib/scoring";
import { claimPickupsInPocket } from "@/lib/pickups";

// ── Boss ball helpers (issue #56) ────────────────────────────────────────────

/** True when trapping this boss should merely DAMAGE it (HP to spare), not lock it. */
export function bossTrapIsDamage(ball: Ball): boolean {
  return !!ball.isBoss && (ball.bossHp ?? 1) > 1;
}

/** Escalate a boss after a hit: faster and smaller (a felt phase change). Pure. */
export function escalateBoss(ball: Ball): void {
  const up = 1.12, shrink = 0.88, minR = 12;
  ball.speed *= up;
  ball.baseSpeed *= up;
  ball.topSpeed *= up;
  ball.minimumSpeed = (ball.minimumSpeed ?? 0) * up;
  ball.velocity = { x: ball.velocity.x * up, y: ball.velocity.y * up };
  ball.radius = Math.max(minR, ball.radius * shrink);
}

/**
 * A boss got trapped but still has HP: break it out. Escalate it, then reposition
 * to a comfortably-open active spot (never a soon-to-lock sliver) and reassign its
 * region so the ownership invariant holds (regionOwnership reconciles the rest).
 */
function breakBossOut(
  game: CanvasGameState,
  ball: Ball,
  gridRegionMap: ReturnType<typeof buildGridRegionMap>,
  denominator: number,
): void {
  escalateBoss(ball);
  if (!game.spaceGrid || !game.boardPolygon) return;
  const b = polygonBounds(game.boardPolygon);
  const threshold = game.lockWinThresholdPercent ?? BALL_WON_REGION_THRESHOLD;
  for (let i = 0; i < 100; i++) {
    const p = { x: b.minX + Math.random() * (b.maxX - b.minX), y: b.minY + Math.random() * (b.maxY - b.minY) };
    if (!pointInPolygon(p, game.boardPolygon)) continue;
    if (!isPositionActive(game.spaceGrid, p)) continue;
    const region = findGridRegionForBall(game.spaceGrid, gridRegionMap, p.x, p.y);
    if (!region) continue;
    // Land only in a region well above the lock threshold, so it can't re-lock at once.
    const pct = (region.cellIndices.length / Math.max(1, denominator)) * 100;
    if (pct <= threshold * 2) continue;
    ball.position = { x: p.x, y: p.y };
    ball.prevPosition = { x: p.x, y: p.y };
    ball.renderPosition = { x: p.x, y: p.y };
    const owner = game.regions.find((r) => pointInPolygon(p, r.polygon));
    if (owner) ball.regionId = owner.id;
    return;
  }
}

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
  callbacks: Pick<GameCallbacks, 'setLockedBallsCount' | 'onBallTypeLocked' | 'onBallCountChanged' | 'onBossState'>,
  /**
   * Grid cell states from before this cut's reachability capture. When present,
   * a ball only locks in a REALLY sealed pocket (isRegionTrulySealed) — never
   * one closed off purely by severing a gap too narrow for the ball. Null skips
   * the check (locks as before).
   */
  preCaptureCells: Uint8Array | null = null,
): boolean {
  if (!game.spaceGrid) return false;

  let anyBallWon = false;
  const prevLockedCount = game.lockedBallsCount;
  const wonThisPass: typeof game.balls = [];
  /** Balls whose lock graded SUPERIOR this pass (tight pocket). */
  const superiorIds = new Set<string>();
  const lockQuality = getLockQuality();
  const gridRegions = findGridRegions(game.spaceGrid);
  const gridRegionMap = buildGridRegionMap(gridRegions);

  // Snapshot the win denominator inputs ONCE before the loop. Computing these
  // per-ball makes the win threshold order-dependent: as earlier balls lock,
  // `activeBalls` shrinks and later balls in the same pass get a different
  // verdict, so two balls in symmetric regions could disagree.
  const currentActive = countActiveCells(game.spaceGrid);
  const activeBalls = game.balls.filter(b => b.state !== 'won' && b.speed > 0).length;
  const denominator = Math.max(currentActive, Math.floor(game.spaceGrid.initialActiveCount / Math.max(1, activeBalls)));

  // Snapshot: a claimed Fork pickup appends a new ball mid-loop; the clone
  // spawns in a live region and must not be lock-checked in this same pass.
  for (const ball of [...game.balls]) {
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

    // Require a REAL seal: a small region that only became small because the
    // capture severed a sub-ball-width gap still opens onto living space, so the
    // ball must keep playing until the player actually closes it off. (Skipped
    // when no snapshot was passed.)
    if (preCaptureCells && !isRegionTrulySealed(game.spaceGrid, preCaptureCells, ballRegion.cellIndices)) {
      continue;
    }

    // Grade the lock: a pocket at most superiorThresholdFraction of the BASE
    // threshold is a SUPERIOR lock and pays superiorMultiplier below. Graded
    // against the config's base threshold, not the upgrade-widened one, so
    // lockThresholdBonus never also widens the superior bar. A sliver-floor
    // lock is by definition tiny and always grades superior.
    const baseThreshold = game.lockBaseThresholdPercent ?? threshold;
    const isSuperior = lockedBySliver
      || percentage <= baseThreshold * lockQuality.superiorThresholdFraction;
    if (isSuperior) superiorIds.add(ball.id);

    // Boss ball (issue #56): a trap is a HIT, not an instant win. While it has HP
    // to spare the boss BREAKS OUT (repositions to open space, faster and smaller)
    // instead of locking; only its final HP actually locks and marks it defeated.
    // It never counts as a normal lock (no lockedBallsCount bump, no lock bonus).
    if (bossTrapIsDamage(ball)) {
      ball.bossHp = (ball.bossHp ?? 1) - 1;
      game.bossHp = ball.bossHp;
      game.bossHitAt = performance.now();
      breakBossOut(game, ball, gridRegionMap, denominator);
      callbacks.onBossState?.(ball.bossHp, ball.bossMaxHp ?? ball.bossHp, false);
      playBallLockSound();
      vibrateBallLock();
      continue;
    }
    if (ball.isBoss) {
      game.bossDefeated = true;
      game.bossHp = 0;
      game.bossActive = false;
      game.bossHitAt = performance.now();
      callbacks.onBossState?.(0, ball.bossMaxHp ?? 0, true);
    }

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
      // Smooth outline of the locked pocket for the flash fill: trace contour
      // loops (Chaikin-rounded) around the pocket cells. Built once here, not
      // per frame. Loops may include hole loops (an obstacle enclosed by the
      // pocket); fill them even-odd. Interior movers are punched out at render
      // (they aren't grid cells, so they fall inside a loop).
      //
      // The ACTIVE cells alone are NOT enough: the cut rasterizer removes every
      // cell whose centre is within half a cell (+ half the wall thickness) of
      // the fence line, stranding a REMOVED band up to a cell wide between the
      // pocket and the fence. Tracing only ACTIVE cells undershoots the fence
      // by that band - most visibly as 15px stair-steps along a diagonal fence
      // (the recurring "pixelated lock flash"). Reclaim the pocket's side of
      // the band the same way the persistent tint does (applyCut's lockCaptured
      // flood): expand across REMOVED cells, stopping at real wall segments
      // (fences, board edges, obstacle edges), and trace the union - flush with
      // every bounding line, still incapable of crossing one.
      const grid = game.spaceGrid;
      const gw = grid.width;
      const cellSet = new Set(ballRegion.cellIndices);
      const seeds: number[] = [];
      for (const idx of ballRegion.cellIndices) {
        const a = gridIndexToWorld(grid, idx);
        const row = (idx / gw) | 0;
        const col = idx % gw;
        const consider = (nIdx: number) => {
          if (grid.cells[nIdx] !== CellState.REMOVED) return;
          const b = gridIndexToWorld(grid, nIdx);
          // Only seed band cells on OUR side of the fence: a step that crosses
          // a wall segment is the far side's territory.
          for (const w of game.walls) {
            if (lineSegmentIntersection(a, b, w.start, w.end)) return;
          }
          seeds.push(nIdx);
        };
        if (row > 0) consider(idx - gw);
        if (row < grid.height - 1) consider(idx + gw);
        if (col > 0) consider(idx - 1);
        if (col < gw - 1) consider(idx + 1);
      }
      for (const idx of floodRemovedEnclosure(grid, seeds, game.walls)) cellSet.add(idx);
      // Snap the lattice contour onto the pocket's bounding walls so the flash
      // fills flush with the fence line (same treatment as the persistent tint).
      const contours = snapContoursToWalls(
        traceContours(grid, (col, row) => cellSet.has(row * gw + col)),
        game.walls,
        grid.cellSize * 1.05,
      );

      // Pickups: a token sealed in with this lock is claimed (the whole point
      // of the mechanic — lead the ball to the token, then lock them together).
      // Uses the flood-expanded set so a token flush against the fence counts.
      claimPickupsInPocket(game, cellSet, callbacks, activeModifiers.pickupPayoutLevel);

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
        contours,
        centroid: { ...ballRegion.centroid },
        startTime: performance.now(),
        ballPos: catchPos,
        ballColor: ball.color,
        particles,
        firstEncounter: isFirstEncounter,
        superior: isSuperior,
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
    let standardPoints = 0;
    let superiorPoints = 0;
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
      const ballPoints = (b.lockMultiplier ?? 1) * mult * frozenMult;
      if (superiorIds.has(b.id)) superiorPoints += ballPoints;
      else standardPoints += ballPoints;
    }
    // Each lock-multiplier point is worth lockValue overtime hours (the
    // economy's main income; scoring-config.yml), and a SUPERIOR lock's points
    // pay superiorMultiplier on top. Rounded per tier so the results screen's
    // Locks / Superior Locks split always sums to what was actually paid.
    // Still folds under the per-map cap with everything else.
    const lockValue = getLockValue();
    const standardPay = Math.round(standardPoints * simultaneousMultiplier * lockValue);
    const superiorPay = Math.round(superiorPoints * simultaneousMultiplier * lockValue * lockQuality.superiorMultiplier);
    const superiorCountThisPass = wonThisPass.filter(b => superiorIds.has(b.id)).length;
    game.lockBonus += standardPay + superiorPay;
    game.superiorLockBonus += superiorPay;
    game.superiorLockCount += superiorCountThisPass;

    // Severance Package: flat overtime per locked ball, deliberately outside
    // the money/simultaneous/quality multipliers so it reads as a predictable
    // "+N per lock" (still folded under the per-map cap with the rest of
    // lockBonus; a superior ball's share lands in the superior split).
    if (activeModifiers.overtimePerLock > 0) {
      game.lockBonus += newlyLocked * activeModifiers.overtimePerLock;
      game.superiorLockBonus += superiorCountThisPass * activeModifiers.overtimePerLock;
    }

    // Severance Package (Equity Package): extra flat overtime paid only on
    // SUPERIOR locks, on top of overtimePerLock. Lands wholly in the superior
    // split; rewards sealing balls into tight pockets.
    if (activeModifiers.overtimePerSuperiorLock > 0 && superiorCountThisPass > 0) {
      const superiorExtra = superiorCountThisPass * activeModifiers.overtimePerSuperiorLock;
      game.lockBonus += superiorExtra;
      game.superiorLockBonus += superiorExtra;
    }

    if (greensThisPass > 0) game.moneyMultiplier *= Math.pow(3, greensThisPass);
  }

  return anyBallWon;
}
