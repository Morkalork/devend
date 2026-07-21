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
import { LevelConfig, BossBall } from "@/types/level";
import { Ball } from "@/types/game";
import { getRemainingPercent, findGridRegions, gridIndexToWorld } from "@/lib/spaceGrid";
import { getBallType, getSpawnableBallTypes } from "@/lib/ballTypes";
import { createBall } from "@/lib/initGame";
import { BIRTH_START_FRAC } from "@/lib/physics/updateBall";
import { playBossChargeSound } from "@/lib/gameAudio";

let _bossAddCounter = 0;

/** Wind-up (the telegraph) before a minion actually buds out. */
const SPIT_CHARGE_MS = 600;
/** How often the last-life boss lunges at the largest open region (panic). */
const PANIC_DASH_MS = 2500;

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
  const nowMs = performance.now();

  const bosses = game.balls.filter((b) => b.isBoss && b.state === "active" && b.speed > 0);
  if (bosses.length === 0) return;

  for (const boss of bosses) {
    // Airborne (mid break-out leap): don't start a wind-up or a panic lunge - the
    // leap owns its position/velocity and updateBall skips physics until it lands.
    if (boss.bossLeapAt !== undefined) continue;

    // Last-life panic: the boss no longer divides, but periodically LUNGES at the
    // largest open region (a regression attacking your progress).
    if ((boss.bossHp ?? 1) <= 1) {
      maybePanicDash(game, boss, nowMs);
      continue;
    }

    // Wind-up in progress (the telegraph): the boss has already stopped and is
    // swelling. When the charge completes, the daughter cell actually buds out.
    if (boss.spitChargeStart !== undefined) {
      if (nowMs - boss.spitChargeStart >= SPIT_CHARGE_MS) {
        boss.spitChargeStart = undefined;
        spawnMinion(game, bb, boss, nowMs);
      }
      continue;
    }

    if ((game.bossMinionCount ?? 0) >= maxMinions) continue;

    // Phase escalation ("HOTFIX INCOMING"): the spit interval shrinks once the
    // boss has taken a hit, so it divides faster the closer it is to defeat.
    const maxHp = boss.bossMaxHp ?? 1;
    const hpFrac = maxHp > 1 ? Math.max(0, ((boss.bossHp ?? 1) - 1) / (maxHp - 1)) : 1;
    const effInterval = interval * (0.55 + 0.45 * hpFrac);
    const anchor = boss.spawnActiveSeconds ?? 0;
    const due = Math.floor((game.activePlaySeconds - anchor) / effInterval);
    if (due <= (boss.rainbowSpawnCount ?? 0)) continue; // reuse the spawn-count field
    boss.rainbowSpawnCount = due;

    // Begin the telegraph: stop + swell (reuses the division beat) plus a rising
    // charge cue. The spawn itself lands SPIT_CHARGE_MS later, above.
    boss.spitChargeStart = nowMs;
    boss.splitAnimAt = nowMs;
    playBossChargeSound();
  }
}

/** Bud a red minion out of the boss (mitosis): attached, grows, then pinches off. */
function spawnMinion(game: CanvasGameState, bb: BossBall, boss: Ball, nowMs: number): void {
  const minionType = getBallType(boss.typeId);
  if (!minionType || minionType.baseSpeed <= 0) return;
  // Divide the boss's own scale back out so minions are normal-paced/sized.
  // Guard the divisors so a stray `speedScale: 0` / `radiusScale: 0` in YAML
  // can't produce an Infinity speed/radius.
  const speedScale = (boss.baseSpeed / minionType.baseSpeed) / Math.max(0.05, bb.speedScale ?? 1.2);
  const base = boss.splitBaseRadius ?? boss.radius;     // unswollen size
  const minionRadius = base / Math.max(0.1, bb.radiusScale ?? 2);
  const angle = Math.random() * Math.PI * 2;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const position = { x: boss.position.x + dir.x * boss.radius * 0.85, y: boss.position.y + dir.y * boss.radius * 0.85 };
  const child = createBall(
    minionType, position, speedScale, minionRadius,
    `${minionType.id}-minion-${++_bossAddCounter}`, nowMs, game.activePlaySeconds,
  );
  child.bornRadius = minionRadius;                       // full size to grow into
  child.radius = Math.max(3, minionRadius * BIRTH_START_FRAC); // starts as a small bud
  child.bornAt = nowMs;
  child.birthParentId = boss.id;   // attached to the boss until it pinches off
  child.birthDirX = dir.x;
  child.birthDirY = dir.y;
  child.regionId = boss.regionId;
  game.balls.push(child);
  game.bossMinionCount = (game.bossMinionCount ?? 0) + 1;
  boss.splitDirX = dir.x;          // side the bud emerges (drives the birth splash)
  boss.splitDirY = dir.y;
  boss.bornSplashAt = nowMs;       // wet splash starts NOW, not at the charge start
}

/** Last-life lunge: aim the boss at the centroid of the largest active region. */
function maybePanicDash(game: CanvasGameState, boss: Ball, nowMs: number): void {
  if (!game.spaceGrid) return;
  if (nowMs - (boss.lastPanicAt ?? 0) < PANIC_DASH_MS) return;
  boss.lastPanicAt = nowMs;
  const regions = findGridRegions(game.spaceGrid);
  if (regions.length === 0) return;
  let biggest = regions[0];
  for (const r of regions) if (r.cellIndices.length > biggest.cellIndices.length) biggest = r;
  // Sampled centroid of the biggest region (avoid scanning every cell).
  let sx = 0, sy = 0, n = 0;
  const stride = Math.max(1, Math.floor(biggest.cellIndices.length / 40));
  for (let i = 0; i < biggest.cellIndices.length; i += stride) {
    const w = gridIndexToWorld(game.spaceGrid, biggest.cellIndices[i]);
    sx += w.x; sy += w.y; n++;
  }
  if (n === 0) return;
  const dx = sx / n - boss.position.x, dy = sy / n - boss.position.y;
  const len = Math.hypot(dx, dy) || 1;
  const spd = (Math.hypot(boss.velocity.x, boss.velocity.y) || boss.baseSpeed) * 1.35;
  boss.velocity = { x: (dx / len) * spd, y: (dy / len) * spd };
  boss.speed = spd;
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
