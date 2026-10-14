/**
 * Mid-run Continue grants (the Insurance Policy set bonus, Golden Parachute):
 * when the run's `extraContinues` modifier rises, the difference is credited
 * to the live Continue counter.
 *
 * It credits against a HIGH-WATER MARK, not the last value seen, and a
 * restore re-baselines without crediting. Both were bugs: a resumed save
 * already carries its earned Continues in `continuesRemaining`, but restoring
 * its upgrades took the modifier from 0 back up to N, which read as a fresh
 * grant and credited N again, so every resume refilled them ("the continue
 * replenishes forever"). Likewise a modifier that dipped and recovered within
 * a run was paid twice.
 */

/** `null`: no baseline yet (a run start or a restore), so the next value is taken as already paid. */
export type ExtraContinuesMark = number | null;

export function creditExtraContinues(mark: ExtraContinuesMark, now: number): { credit: number; mark: number } {
  if (mark === null) {
    return { credit: 0, mark: now };
  }
  if (now > mark) {
    return { credit: now - mark, mark: now };
  }
  return { credit: 0, mark };
}
