/**
 * Which map a pair's Continue would resume at (canvas port of
 * components/game/PairDecision.tsx).
 */
import type { PairSaveOffer } from "@/hooks/usePairRunSave";

/**
 * The further-along save is the one Continue would take, and it is the one
 * worth naming: "map 7" when one phone says 7 and the other says 6. 1-based;
 * null when neither phone holds a save.
 */
export function pairResumeLevel(mine: PairSaveOffer | null, theirs: PairSaveOffer | null): number | null {
  const saves = [mine, theirs].filter(Boolean) as PairSaveOffer[];
  return saves.length ? Math.max(...saves.map(s => s.levelIndex)) + 1 : null;
}
