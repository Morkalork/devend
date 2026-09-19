/**
 * PairLinkBanner — what the board says when the other phone goes quiet
 * (TWO_PLAYER_PLAN.md step 7).
 *
 * Two states worth showing, and no others:
 *
 *   - STALLED. The partner's commands for this tick have not arrived, so the
 *     board is not moving. It usually clears within a frame or two and saying
 *     anything about it would be noise, so this waits out a short grace period
 *     first. A board that has genuinely stopped, with nothing on screen to say
 *     why, reads as a crash.
 *   - DROPPED. The link is gone for good. WebRTC cannot be revived without a
 *     fresh offer and answer, so the honest options are to pair again or to
 *     carry on alone, and both are offered rather than one being chosen for
 *     the player.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, WifiOff } from "lucide-react";

interface PairLinkBannerProps {
  /** True while the lockstep is waiting on the other device. */
  stalled: boolean;
  /** True once the link is gone and will not come back by itself. */
  dropped: boolean;
  remoteName: string;
  onRepair: () => void;
  onContinueSolo: () => void;
}

/** How long a stall may last before it is worth mentioning. */
const GRACE_MS = 600;

export function PairLinkBanner({
  stalled, dropped, remoteName, onRepair, onContinueSolo,
}: PairLinkBannerProps) {
  const { t } = useTranslation();
  const [showStall, setShowStall] = useState(false);

  useEffect(() => {
    if (!stalled) { setShowStall(false); return; }
    const timer = setTimeout(() => setShowStall(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [stalled]);

  if (dropped) {
    return (
      <div className="absolute inset-0 z-50 bg-background/90 flex flex-col items-center justify-center gap-4 p-6">
        <WifiOff className="w-10 h-10 text-destructive" />
        <p className="text-center font-semibold">{t("pair.partnerLeft")}</p>
        <div className="grid gap-3 w-full max-w-xs">
          <button onClick={onRepair}
            className="w-full p-3 rounded-lg bg-card border border-border hover:border-primary/50 font-semibold">
            {t("pair.tryAgain")}
          </button>
          <button onClick={onContinueSolo}
            className="w-full p-3 rounded-lg bg-muted hover:bg-muted/80 font-semibold">
            {t("pair.continueSolo")}
          </button>
        </div>
      </div>
    );
  }

  if (!showStall) return null;

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full bg-background/90 border border-border px-3 py-1.5 text-sm">
      <Loader2 className="w-4 h-4 animate-spin text-primary" />
      <span>{t("pair.waitingFor", { name: remoteName })}</span>
    </div>
  );
}
