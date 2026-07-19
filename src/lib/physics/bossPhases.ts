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
import { BIRTH_START_FRAC } from "@/lib/physics/updateBall";

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

/**
 * The boss spits a minion every `spitIntervalSeconds` of active play (capped at
 * `maxMinions` total this map). Mirrors the rainbow spitter, but minions spawn at
 * NORMAL ball speed/size (the boss's own scale is divided out) so they read as its
 * spawn, not more bosses. Minions are the boss's OWN type (red): the boss is NOT a
 * rainbow ball, so it only spits plain red "bug"/hotfix balls, never random types.
 */
export function tickBossSpit(game: CanvasGameState, level: LevelConfig): void {
  const bb = level.boss?.bossBall;
  if (!bb) return;
  const interval = bb.spitIntervalSeconds ?? 0;
  if (interval <= 0) return;
  const maxMinions = bb.maxMinions ?? 4;
  if ((game.bossMinionCount ?? 0) >= maxMinions) return;

  const bosses = game.balls.filter((b) => b.isBoss && b.state === "active" && b.speed > 0);
  if (bosses.length === 0) return;

  const bossSpeedScale = bb.speedScale ?? 1.2;
  const radiusScale = bb.radiusScale ?? 2;
  for (const boss of bosses) {
    if ((game.bossMinionCount ?? 0) >= maxMinions) break;
    const anchor = boss.spawnActiveSeconds ?? 0;
    const due = Math.floor((game.activePlaySeconds - anchor) / interval);
    if (due <= (boss.rainbowSpawnCount ?? 0)) continue; // reuse the spawn-count field

    // The minion is the boss's own ball type (red), NOT a random spawnable type.
    const minionType = getBallType(boss.typeId);
    if (!minionType || minionType.baseSpeed <= 0) continue;
    // Divide the boss's own speed scale back out so minions are normal-paced.
    const speedScale = (boss.baseSpeed / minionType.baseSpeed) / bossSpeedScale;
    const minionRadius = boss.radius / radiusScale;
    // The daughter cell buds from the boss: it spawns ATTACHED to the parent's
    // body and grows there (updateBall follows the parent), then pinches off and
    // drifts away. Not a separate ball popping in beneath it.
    const angle = Math.random() * Math.PI * 2;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const position = { x: boss.position.x + dir.x * boss.radius * 0.85, y: boss.position.y + dir.y * boss.radius * 0.85 };
    const child = createBall(
      minionType, position, speedScale, minionRadius,
      `${minionType.id}-minion-${++_bossAddCounter}`, performance.now(), game.activePlaySeconds,
    );
    child.bornRadius = minionRadius;                     // full size to grow into
    child.radius = Math.max(3, minionRadius * BIRTH_START_FRAC); // starts as a small bud
    const nowMs = performance.now();
    child.bornAt = nowMs;
    child.birthParentId = boss.id;   // attached to the boss until it pinches off
    child.birthDirX = dir.x;
    child.birthDirY = dir.y;
    child.regionId = boss.regionId;
    game.balls.push(child);
    game.bossMinionCount = (game.bossMinionCount ?? 0) + 1;
    boss.splitAnimAt = nowMs;   // parent decelerates mid-division, then recovers
    boss.rainbowSpawnCount = due;
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
