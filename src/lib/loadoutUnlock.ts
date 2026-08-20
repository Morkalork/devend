/**
 * Win-based loadout unlocks.
 *
 * A loadout is available in the run-start draft once the player has enough
 * UNIQUE wins — runs beaten (final level cleared) with distinct run-start
 * loadouts. `uniqueWins` is simply the number of distinct loadout ids the
 * player has won with (see useMetaProgression `wonLoadoutIds`).
 */
import { LoadoutConfig } from '@/types/loadout';

/** Is this loadout unlocked for the run-start draft at the given win count? */
export const isLoadoutUnlocked = (loadout: LoadoutConfig, uniqueWins: number): boolean =>
  !loadout.neverDrafted &&
  (loadout.uniqueWinsRequired == null || uniqueWins >= loadout.uniqueWinsRequired);

/**
 * Loadouts the Ascension draft may offer. That draft ignores win-gating (it
 * always showed the full catalogue) but must still skip imposed loadouts, or
 * the ladder's forced curse would turn up as one of three "rewards".
 */
export const draftableAtAscension = (loadouts: LoadoutConfig[]): LoadoutConfig[] =>
  loadouts.filter(l => !l.neverDrafted);

/** Loadouts offered in the run-start draft at the given unique-win count. */
export const unlockedForStart = (loadouts: LoadoutConfig[], uniqueWins: number): LoadoutConfig[] =>
  loadouts.filter(l => isLoadoutUnlocked(l, uniqueWins));

/**
 * Loadouts that cross from locked to unlocked as the win count rises from
 * `prevWins` to `newWins` — used to celebrate fresh unlocks on the result screen.
 */
export const newlyUnlocked = (
  loadouts: LoadoutConfig[],
  prevWins: number,
  newWins: number,
): LoadoutConfig[] =>
  loadouts.filter(
    l => l.uniqueWinsRequired != null
      && l.uniqueWinsRequired > prevWins
      && l.uniqueWinsRequired <= newWins,
  );
