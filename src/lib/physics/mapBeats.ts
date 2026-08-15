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

/** Default lead time (ms) for a beat's telegraph warning. */
const DEFAULT_LEAD_MS = 1600;

/**
 * First level on which a beat may duplicate a ball.
 *
 * The add lands as a visible cell division: the ball stops, swells and buds a
 * daughter cell that pinches off. That is the level-10 boss's signature move,
 * so an ordinary map only borrows it once the boss has taught it. Before that
 * the same event is just a ball becoming two for no stated reason, which is
 * precisely how it was read on level 2.
 */
export const DUPLICATION_MIN_LEVEL = 11;

/** One consequence of a beat, as an i18n key the banner can render. */
export interface BeatEffectLine {
  key: string;
  /** Interpolation values, including `count` for plural selection. */
  values?: Record<string, number>;
}

/**
 * How many balls this beat actually duplicates here, after the level gate.
 *
 * One function so the banner and the effect can never disagree: a beat whose
 * duplication is gated out must not announce a ball that never arrives.
 */
export function beatSpawnCount(beat: MapBeat, levelNumber: number): number {
  const wanted = beat.spawnAdds ?? 0;
  if (wanted <= 0) return 0;
  return levelNumber >= DUPLICATION_MIN_LEVEL ? wanted : 0;
}

/**
 * What a beat is about to DO, in words.
 *
 * The `announce` label is a flavour name ("Standup Interrupt"), which telegraphs
 * that SOMETHING is coming but not what, so an extra ball still arrived
 * unexplained. Derived from the beat's own fields rather than written per map,
 * so a beat added later says what it does without anyone remembering to write
 * the copy.
 */
export function beatEffectLines(beat: MapBeat, levelNumber: number): BeatEffectLine[] {
  const lines: BeatEffectLine[] = [];
  const adds = beatSpawnCount(beat, levelNumber);
  if (adds > 0) lines.push({ key: "game.beatEffectBalls", values: { count: adds } });
  if (beat.speedSpike && beat.speedSpike > 0) {
    lines.push({ key: "game.beatEffectSpeed", values: { percent: Math.round(beat.speedSpike * 100) } });
  }
  if (beat.breakId) lines.push({ key: "game.beatEffectBreak" });
  return lines;
}

/**
 * @param onWarn called with a beat's `announce` label when its telegraph should
 *   show (once per beat), `leadMs` before the effect lands, along with what the
 *   beat is about to do.
 */
export function tickMapBeats(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  onWarn?: (announce: string, effects: BeatEffectLine[]) => void,
): void {
  const beats = level.beats;
  if (!beats || beats.length === 0) return;
  if (!game.firedBeats) game.firedBeats = [];
  if (!game.warnedBeats) game.warnedBeats = [];
  if (!game.pendingBeats) game.pendingBeats = [];

  // Telegraphed beats scheduled earlier, now due. Their lead runs on
  // activePlaySeconds, so a pause or a hold never eats the warning.
  if (game.pendingBeats.length > 0) {
    const due = game.pendingBeats.filter(p => game.activePlaySeconds >= p.dueActiveSeconds);
    if (due.length > 0) {
      game.pendingBeats = game.pendingBeats.filter(p => game.activePlaySeconds < p.dueActiveSeconds);
      for (const pending of due) {
        const beat = beats.find(b => b.id === pending.id);
        if (beat) applyBeat(game, beat, levelNumber);
      }
    }
  }

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
        onWarn?.(beat.announce, beatEffectLines(beat, levelNumber));
      }
    }

    if (game.firedBeats.includes(beat.id)) continue;
    if (!bySpace && !byTime) continue;

    game.firedBeats.push(beat.id);

    // A space beat is crossed by the player's own cut, so its warning used to
    // fire in the SAME tick as the effect: the banner appeared at the top of
    // the screen at the instant the ball appeared mid-board, while the player
    // was watching their fence. That is an ambush, whatever the map comment
    // promises. Give the telegraph its lead, exactly as a time beat gets one,
    // and land the effect after it. (Time beats already warned `leadMs` early,
    // so they fire on schedule; a beat with nothing to announce has no
    // telegraph to wait for and lands at once.)
    if (bySpace && !byTime && beat.announce) {
      game.pendingBeats.push({
        id: beat.id,
        dueActiveSeconds: game.activePlaySeconds + (beat.leadMs ?? DEFAULT_LEAD_MS) / 1000,
      });
      continue;
    }

    applyBeat(game, beat, levelNumber);
  }
}

function applyBeat(game: CanvasGameState, beat: MapBeat, levelNumber: number): void {
  // "mitosis": the anchor visibly divides, the level-10 boss's move. Gated to
  // level 11+ by beatSpawnCount, so the boss teaches it first.
  const adds = beatSpawnCount(beat, levelNumber);
  if (adds > 0) spawnAdds(game, levelNumber, adds, "mitosis");
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
