/**
 * Par: the fence budget a map is scored against.
 *
 * Two things key off it, and they are wildly different in weight. The under-par
 * BONUS caps at 4h (scoring-config `fenceEfficiency`), which against an 80h map
 * cap is close to noise. The over-par PENALTY is the real mechanic: one fence
 * over multiplies the map's base by 0.6, two by 0.4, and three or more by 0.2
 * while disabling the space bonus entirely.
 *
 * So an upgrade that raises par is not selling a bigger bonus. It is selling
 * slack before a cliff, which is CONSISTENCY rather than multiplier - the one
 * kind of payoff a per-map overtime cap leaves room for.
 *
 * parBonus is an integer on purpose. The penalty brackets are exact equality
 * checks (`fencesOverPar === 1`), so a fractional par would land 0.5 over and
 * fall straight through to the 3-or-more branch, quietly handing out the
 * harshest penalty instead of the mildest.
 */
import type { GameModifiers } from "@/hooks/useActiveModifiers";

/** A map's par after Padded Estimate. Never below 1: a par of 0 would make
 *  every possible clear over par, which is not a difficulty, it is a wall. */
export function effectivePar(
  expectedCuts: number,
  modifiers?: Pick<GameModifiers, "parBonus">,
): number {
  const base = Number.isFinite(expectedCuts) ? expectedCuts : 0;
  const bonus = Math.floor(Math.max(0, modifiers?.parBonus ?? 0));
  return Math.max(1, Math.round(base) + bonus);
}
