/**
 * Boss phases (issue #56) — threshold-triggered escalation for boss maps.
 *
 * Mirrors rainbowSpawner: runs once per frame OUTSIDE the ball-iteration loop
 * (it appends to game.balls). Each phase fires ONCE, when its space-remaining or
 * active-seconds threshold is crossed, and can spawn "add" balls. Phases that
 * spawn need a live active ball to anchor a valid position off (same trick as
 * the rainbow spit-out); if every ball is already locked there is nothing left
 * to make harder, so the spawn is simply skipped (never a deadlock).
 */
import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { getRemainingPercent } from "@/lib/spaceGrid";
import { getBallType, getSpawnableBallTypes } from "@/lib/ballTypes";
import { createBall } from "@/lib/initGame";

let _bossAddCounter = 0;

/**
 * Advance boss phases for one frame. Fires any phase whose threshold is newly
 * crossed (recorded in game.bossFiredPhases so it never repeats) and applies its
 * effect. No-op on non-boss maps or once all phases have fired.
 */
export function tickBossPhases(game: CanvasGameState, level: LevelConfig, levelNumber: number): void {
  const phases = level.boss?.phases;
  if (!phases || phases.length === 0) return;
  if (!game.bossFiredPhases) game.bossFiredPhases = [];

  const spaceRemaining = game.spaceGrid ? getRemainingPercent(game.spaceGrid) : 100;

  for (const phase of phases) {
    if (game.bossFiredPhases.includes(phase.id)) continue;
    const bySpace = phase.atSpaceRemaining != null && spaceRemaining <= phase.atSpaceRemaining;
    const byTime = phase.atSeconds != null && game.activePlaySeconds >= phase.atSeconds;
    if (!bySpace && !byTime) continue;

    game.bossFiredPhases.push(phase.id);
    if (phase.spawnAdds && phase.spawnAdds > 0) spawnAdds(game, levelNumber, phase.spawnAdds);
  }
}

/** Spawn `n` extra balls off live active balls (inherits their region + scale). */
function spawnAdds(game: CanvasGameState, levelNumber: number, n: number): void {
  const spawnable = getSpawnableBallTypes(levelNumber);
  if (spawnable.length === 0) return;
  // Only balls still in play can anchor a valid spawn position.
  const anchors = game.balls.filter((b) => b.state === "active" && b.speed > 0);
  if (anchors.length === 0) return;

  for (let i = 0; i < n; i++) {
    const anchor = anchors[i % anchors.length];
    const anchorType = getBallType(anchor.typeId);
    // Match the run's speed scaling from the anchor (as rainbowSpawner does).
    const speedScale = anchorType && anchorType.baseSpeed > 0 ? anchor.baseSpeed / anchorType.baseSpeed : 1;
    const type = spawnable[Math.floor(Math.random() * spawnable.length)];
    const offset = anchor.radius * 0.75;
    const angle = Math.random() * Math.PI * 2;
    const position = {
      x: anchor.position.x + Math.cos(angle) * offset,
      y: anchor.position.y + Math.sin(angle) * offset,
    };
    const child = createBall(
      type, position, speedScale, anchor.radius,
      `${type.id}-boss-${++_bossAddCounter}`, performance.now(), game.activePlaySeconds,
    );
    child.regionId = anchor.regionId; // born in the anchor's region
    game.balls.push(child);
  }
}
