/**
 * PairDecision — Continue or New, for a pair that has met before
 * (TWO_PLAYER_PLAN.md step 6b).
 *
 * Both phones show the same two buttons; only the host's do anything. That is
 * not a slight on the guest, it is what keeps a run in one state: every
 * between-map decision in this game is about ONE run, and a run that is both
 * resumed and restarted is not a run. The guest's side says who it is waiting
 * for, so the pause reads as the other player thinking rather than as the
 * screen being broken.
 */
import { useTranslation } from "react-i18next";
import { Users, Play, RotateCcw, Loader2 } from "lucide-react";
import type { PairSaveOffer } from "@/hooks/usePairRunSave";

interface PairDecisionProps {
  isHost: boolean;
  remoteName: string;
  /** The saves each phone is holding for this pair; null means none. */
  mine: PairSaveOffer | null;
  theirs: PairSaveOffer | null;
  onContinue: () => void;
  onNew: () => void;
  onLeave: () => void;
}

export function PairDecision({
  isHost, remoteName, mine, theirs, onContinue, onNew, onLeave,
}: PairDecisionProps) {
  const { t } = useTranslation();
  // The further-along save is the one Continue would take, and it is the one
  // worth naming: "map 7" when one phone says 7 and the other says 6.
  const best = [mine, theirs].filter(Boolean) as PairSaveOffer[];
  const resumeAt = best.length
    ? Math.max(...best.map(s => s.levelIndex)) + 1
    : null;

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col justify-center gap-6">
        <div className="flex items-center gap-3 justify-center">
          <Users className="w-6 h-6 text-primary" />
          <span className="font-semibold">{remoteName}</span>
        </div>

        {resumeAt !== null ? (
          <>
            <p className="text-sm text-center text-muted-foreground">
              {t("pair.savedRun", { level: resumeAt })}
            </p>
            <div className="grid gap-3">
              <button
                onClick={onContinue}
                disabled={!isHost}
                className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-3 disabled:opacity-40"
              >
                <Play className="w-5 h-5 text-primary" />
                <span className="font-semibold">{t("pair.continueRun")}</span>
              </button>
              <button
                onClick={onNew}
                disabled={!isHost}
                className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-3 disabled:opacity-40"
              >
                <RotateCcw className="w-5 h-5 text-muted-foreground" />
                <span className="font-semibold">{t("pair.newGame")}</span>
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={onNew}
            disabled={!isHost}
            className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center justify-center gap-3 disabled:opacity-40"
          >
            <Play className="w-5 h-5 text-primary" />
            <span className="font-semibold">{t("pair.newGame")}</span>
          </button>
        )}

        {!isHost && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("pair.waitingForPartner")}
          </div>
        )}

        <button onClick={onLeave} className="w-full p-3 rounded-lg bg-muted hover:bg-muted/80 text-sm">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
