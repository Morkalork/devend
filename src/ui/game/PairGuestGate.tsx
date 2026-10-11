/**
 * PairGuestGate: the guest's side of a decision only the host makes
 * (TWO_PLAYER_PLAN.md step 6; canvas port of components/game/PairGuestGate.tsx).
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
import { COLOR, Icon, Label, TEXT, View, tint, useUiScreen } from "../kit/ui";
import { SpinIcon, TouchBlocker } from "./modalParts";

interface PairGuestGateProps {
  /** What the host is deciding, as a translation key under `pair.`. */
  what: "shopping" | "deciding" | "pushing" | "continuing";
  remoteName: string;
}

export function PairGuestGate({ what, remoteName }: PairGuestGateProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={60}>
      {/* The point of the gate: the guest's taps must not reach the screen
          underneath, or it makes decisions about a run it does not own. */}
      <TouchBlocker
        screen={screen}
        color={tint(COLOR.background, 0.95)}
        layout={{ alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}
      >
        <Icon icon={Users} size={40} color={COLOR.primary} />
        <Label text={t(`pair.host.${what}`, { name: remoteName })} size={TEXT.base} weight="600"
          color={COLOR.foreground} align="center" wrap />
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <SpinIcon icon={Loader2} size={16} color={COLOR.mutedForeground} />
          <Label text={t("pair.waitingFor", { name: remoteName })} size={TEXT.sm} color={COLOR.mutedForeground} />
        </View>
      </TouchBlocker>
    </View>
  );
}
