/**
 * PairMismatchNotice — the two phones are not set up to play the same game
 * (TWO_PLAYER_PLAN.md step 6).
 *
 * Certificates, achievements and loadout bonuses live in each phone's own
 * storage and none of them travel in the run record. A player holding an
 * unlock their partner lacks computes different fence speeds and lock
 * thresholds from the very first tick, on a board that looks identical.
 *
 * The desync detector would notice within a second and then repair for ever,
 * because the cause is not on the board and no snapshot can carry it away. So
 * this stops instead. Saying "you two are not playing the same game" once is
 * kinder than a map that quietly corrects itself thirty times a minute.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

export function PairMismatchNotice({ remoteName, onLeave }: {
  remoteName: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[70] bg-background/95 flex flex-col items-center justify-center gap-4 p-6">
      <AlertTriangle className="w-10 h-10 text-destructive" />
      <p className="text-center font-semibold">{t("pair.mismatchTitle")}</p>
      <p className="text-center text-sm text-muted-foreground max-w-xs">
        {t("pair.mismatchBody", { name: remoteName })}
      </p>
      <button onClick={onLeave}
        className="w-full max-w-xs p-3 rounded-lg bg-card border border-border hover:border-primary/50 font-semibold">
        {t("common.back")}
      </button>
    </div>
  );
}
