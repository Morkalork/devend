/**
 * Map beats (LEVELDESIGN.md convention 3, "the Turn") — threshold-triggered
 * one-shot events for ANY map, generalizing boss phases (bossPhases.ts).
 *
 * Runs once per frame OUTSIDE the ball-iteration loop (effects may append to
 * game.balls or queue destroys). Each beat fires ONCE, when its space-remaining
 * or active-seconds threshold is first crossed (recorded in game.firedBeats so
 * it never repeats), then applies any combination of effects:
 *   - spawnAdds:   spill in extra balls (reuses the boss add-spawner)
 *   - breakId:     force-break a destructible (topples supports / reveals sealed
 *                  space / grants a chest) via the normal pendingDestroys path
 *   - speedSpike:  a permanent ball-speed bump folded into creepFactor
 */
import { CanvasGameState } from "@/types/gameState";
import { LevelConfig, MapBeat } from "@/types/level";
import { getRemainingPercent } from "@/lib/spaceGrid";
import { spawnAdds } from "@/lib/physics/bossPhases";

/** Default lead time (ms) for a time-triggered beat's telegraph warning. */
const DEFAULT_LEAD_MS = 1600;

/**
 * @param onWarn called with a beat's `announce` label when its telegraph should
 *   show (once per beat). For time beats this fires `leadMs` before the effect;
 *   for space beats it coincides with the effect (crossings are player-driven).
 */
export function tickMapBeats(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  onWarn?: (announce: string) => void,
): void {
  const beats = level.beats;
  if (!beats || beats.length === 0) return;
  if (!game.firedBeats) game.firedBeats = [];
  if (!game.warnedBeats) game.warnedBeats = [];

  const spaceRemaining = game.spaceGrid ? getRemainingPercent(game.spaceGrid) : 100;

  for (const beat of beats) {
    const bySpace = beat.atSpaceRemaining != null && spaceRemaining <= beat.atSpaceRemaining;
    const byTime = beat.atSeconds != null && game.activePlaySeconds >= beat.atSeconds;

    // Telegraph: warn ahead of a time beat by leadMs; a space beat warns as it
    // fires. Fires once, only when the beat carries an `announce` label.
    if (beat.announce && !game.warnedBeats.includes(beat.id)) {
      const leadSec = (beat.leadMs ?? DEFAULT_LEAD_MS) / 1000;
      const warnByTime = beat.atSeconds != null && game.activePlaySeconds >= beat.atSeconds - leadSec;
      if (warnByTime || bySpace) {
        game.warnedBeats.push(beat.id);
        onWarn?.(beat.announce);
      }
    }

    if (game.firedBeats.includes(beat.id)) continue;
    if (!bySpace && !byTime) continue;

    game.firedBeats.push(beat.id);
    applyBeat(game, beat, levelNumber);
  }
}

function applyBeat(game: CanvasGameState, beat: MapBeat, levelNumber: number): void {
  if (beat.spawnAdds && beat.spawnAdds > 0) {
    spawnAdds(game, levelNumber, beat.spawnAdds);
  }
  if (beat.speedSpike && beat.speedSpike > 0) {
    game.beatSpeedMult = (game.beatSpeedMult ?? 1) * (1 + beat.speedSpike);
  }
  if (beat.breakId) {
    forceBreak(game, beat.breakId);
  }
}

/**
 * Scripted break of a destructible by id: mark it destroyed and queue it, so the
 * normal processDestroys pass topples anything resting on it, reopens sealed
 * space, and grants a chest reward if it is one. No `destroyedBy` (no ball did
 * it), so the mirror/mover lock-multiplier penalty never applies.
 */
function forceBreak(game: CanvasGameState, id: string): void {
  const d = game.destructibles.find(x => x.id === id && !x.destroyed);
  if (!d) return;
  d.hits = d.maxHits;
  d.destroyed = true;
  game.pendingDestroys.push(d);
}
