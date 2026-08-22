/**
 * Firing the sporadic board tilt (issue #77).
 *
 * The rules live in boardTiltRoll (which tiers, what chance, which maps); this
 * is only the bookkeeping that turns a cleared-space reading into at most one
 * turn, and it exists as its own module so applyCut does not grow another
 * paragraph of state juggling.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import { getRunRng } from "@/lib/runRng";
import { forcedTilts } from "@/lib/devFlags";
import { beginTilt, NO_TILT } from "@/lib/boardTilt";
import {
  mapCanTilt, newTiers, rollTilts, rollTiltDirection, rollTiltChance,
  authoredTiltChance,
} from "@/lib/boardTiltRoll";

/**
 * Roll the tiers newly crossed at `clearedPercent`, and turn the board if any
 * of them come up.
 *
 * Several tiers can be crossed by one big capture, and each gets its own roll,
 * but they only ever produce ONE turn: two quarter-turns landing in the same
 * frame would be a half-turn nobody could follow, and the second would be
 * invisible anyway since the first has not finished easing.
 */
export function tickBoardTilt(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  clearedPercent: number,
): void {
  if (!mapCanTilt(levelNumber, game.gravityWells)) return;

  const fired = game.firedTiltTiers ?? (game.firedTiltTiers = []);
  const crossed = newTiers(clearedPercent, fired);
  if (crossed.length === 0) return;
  fired.push(...crossed);

  // Drawn once per map, lazily, and seeded: a Daily plays the same tilts for
  // everyone, and a normal run gets a fresh band each map so the cadence cannot
  // be learned across runs.
  // Resolved once per map and recorded on the state, so everything downstream
  // sees one consistent number instead of a flag it has to know about.
  //
  // Precedence: the debug flag beats an authored value beats the random draw.
  // `?tilt=1` outranks authoring because its whole job is to make a map that
  // rarely turns turn every time, which an authored 0.05 would otherwise veto.
  if (game.tiltChance == null) {
    game.tiltChance = forcedTilts()
      ? 1
      : authoredTiltChance(level) ?? rollTiltChance(getRunRng(`tiltChance:${level.id}`));
  }

  const rng = getRunRng(`tilt:${level.id}:${crossed.join(",")}`);
  if (rollTilts(crossed, game.tiltChance, rng) === 0) return;

  game.boardTilt = beginTilt(
    game.boardTilt ?? NO_TILT,
    rollTiltDirection(rng),
    game.activePlaySeconds,
  );
}
