/**
 * Score a map banked from the Push Your Luck prompt.
 *
 * Lifted out of GameCanvas's Bank handler, unchanged, so the headless bot can
 * bank a push the way a player does. It used to set levelComplete itself and
 * skip this, so every push-banked win the upgrade sweep played paid 0h and
 * the sweep's pay readings were blunted by it.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { engagementProgress } from "@/lib/scoreEngagement";
import { calculateScore, getShipEarlyPercent } from "@/lib/scoring";
import { readLockAxes } from "@/lib/lockCapacity";
import { isTimingExempt } from "@/lib/mapTiming";
import { pushBonusEarned } from "@/lib/pushLuck";
import { missedAreaShare } from "@/lib/coloredAreaShare";

export function scoreBankedPush(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
): ReturnType<typeof calculateScore> & { pushBonus: number } {
  // Pays on the BEST remaining reached, not the current: space creeping back
  // after a good cut must not take an already-earned hour away.
  const pushBonus = pushBonusEarned(
    game.pushStartPercent, game.bestRemainingPercent, activeModifiers.pushBonusMultiplier,
  );
  // Ship Early: the tempo clock froze when the prompt opened, so push time
  // never counts against it (disabled on the tutorial band, levels 1-3).
  const shipEarlyPercent = isTimingExempt(levelNumber)
    ? 0
    : getShipEarlyPercent(game.clearedActiveSeconds, game.balls.length, activeModifiers.shipEarlySecondsPerBall);
  // Fold lock + push in before the cap (issue #43); ship-early pays a percent
  // above the cap. Previously this site added lockBonus + pushBonus AFTER
  // calculateScore, letting a banked push exceed the per-map ceiling.
  // Colored areas carry a share of what the MAP pays (40% by default), in
  // proportion to how many were satisfied.
  //
  // Passed to calculateScore rather than applied to basePoints, which was the
  // first attempt and was nearly invisible: basePoints feeds only the first
  // term of `multipliedBase + axes.total`, so on a level-3 run it was 20h of
  // a 130h payout and withholding 40% of it cost 8h (old hours). The share has to come
  // off the map's pay or it does not mean what the number says.
  const zoneShareMissed = missedAreaShare(level, game.coloredAreas);

  const { levelScore, breakdown, shipEarlyBonus, ...rest } = calculateScore(
    game.wallCount, level.expectedCuts, game.bestRemainingPercent, level.sizeThreshold, level.points, {
      zoneShareMissed,
      scoreMultiplier: activeModifiers.scoreMultiplier,
      locks: readLockAxes(game),
      tempoCeilingMultiplier: activeModifiers.shipEarlyBonusMultiplier,
      greedBonus: pushBonus,
      // The map's own features, as their own axis. It used to ride in on
      // greedBonus above and drown there: Greed's pot is shared with
      // clearing, so on any map where you also cleared it was full.
      engagement: engagementProgress(game),
      spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
      // Comp Time pickups raise THIS map's cap; overtime pickups pay after it.
      // `capRaise`, not `flatBonus`: the two used to share an option, so the
      // raise was paid as hours and never raised anything (#79).
      capRaise: activeModifiers.overtimeCapBonus + game.pickupCapBonus,
      // Bumper hours pay with the pickups, above the cap: a bumper counts
      // down from five in front of the player, so one bump must be one hour.
      postCapBonus: game.pickupOvertime + (game.bouncerOvertime ?? 0),
      // Above the backstop, unlike everything else here.
      qualifiedOvertime: game.qualifiedOvertime ?? 0,
      // Finishing fast pays a percent of the capped overtime, above the cap.
      shipEarlyPercent,
      // Demolition multiplier: chests/breakables smashed before the push.
      payoutMultiplier: game.breakMultiplier ?? 1,
      // What the plunger was pulled to. Multiplies the flat base only.
      launchPower: game.launchPower ?? 1,
    },
  );

  return { levelScore, breakdown, shipEarlyBonus, pushBonus, ...rest };
}
