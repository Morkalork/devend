/**
 * PairGuestGate — the guest's side of a decision only the host makes
 * (TWO_PLAYER_PLAN.md step 6).
 *
 * Every between-map screen in this game decides something about ONE run: what
 * was bought, whether to push, whether to spend a continue. A run cannot be in
 * two states, so one device has to own those decisions, and the host is that
 * device. This is what the other phone shows meanwhile.
 *
 * It BLOCKS rather than mirrors. A read-only shop that showed the host's
 * selection landing live would be nicer and is a much larger change: every
 * screen would have to learn a disabled mode and a way to receive the other
 * player's cursor. Blocking is the honest first version, and it is not a
 * blank: it says which decision is being made and who is making it, so the
 * pause reads as the other player thinking rather than as the app hanging.
 */
import { useTranslation } from "react-i18next";
import { Loader2, Users } from "lucide-react";

interface PairGuestGateProps {
  /** What the host is deciding, as a translation key under `pair.`. */
  what: "shopping" | "deciding" | "pushing" | "continuing";
  remoteName: string;
}

export function PairGuestGate({ what, remoteName }: PairGuestGateProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[60] bg-background/95 flex flex-col items-center justify-center gap-4 p-6"
      // The point of the gate: the guest's taps must not reach the screen
      // underneath, or it makes decisions about a run it does not own.
      onPointerDown={e => e.stopPropagation()}
      role="status"
      aria-live="polite"
    >
      <Users className="w-10 h-10 text-primary" />
      <p className="text-center font-semibold">{t(`pair.host.${what}`, { name: remoteName })}</p>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("pair.waitingFor", { name: remoteName })}
      </div>
    </div>
  );
}
