/**
 * PairLinkBanner - what the board says when the other phone goes quiet
 * (TWO_PLAYER_PLAN.md step 7; canvas port of components/game/PairLinkBanner.tsx).
 *
 * Two states worth showing, and no others:
 *
 *   - STALLED. The partner's commands for this tick have not arrived, so the
 *     board is not moving. It usually clears within a frame or two, so this
 *     waits out a short grace period first. A board that has genuinely stopped,
 *     with nothing on screen to say why, reads as a crash.
 *   - DROPPED. The link is gone for good. WebRTC cannot be revived without a
 *     fresh offer and answer, so the honest options are to pair again or to
 *     carry on alone, and both are offered rather than one being chosen for
 *     the player.
 *
 * Index hands this to GameScreen as an element, so its props are the DOM
 * one's; `region` is optional for that reason. GameScreen drew it inside the
 * play region, so a dropped link covers the board rather than the whole app:
 * pass that region (clone the element with it) to keep that. Without one it
 * covers the whole screen.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, WifiOff } from "lucide-react";
import { COLOR, Icon, Label, Pressable, RADIUS, TEXT, tint, useUiScreen, View } from "../kit/ui";
import { WrapText } from "./modalParts";
import { Blocker, Region, SpinningIcon } from "./boardParts";

interface PairLinkBannerProps {
  /** True while the lockstep is waiting on the other device. */
  stalled: boolean;
  /** True once the link is gone and will not come back by itself. */
  dropped: boolean;
  remoteName: string;
  onRepair: () => void;
  onContinueSolo: () => void;
  /** The play region on screen, in CSS px; the whole screen when omitted. */
  region?: { x: number; y: number; width: number; height: number };
}

/** How long a stall may last before it is worth mentioning. */
const GRACE_MS = 600;

export function PairLinkBanner({
  stalled, dropped, remoteName, onRepair, onContinueSolo, region,
}: PairLinkBannerProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const [showStall, setShowStall] = useState(false);
  const r = region ?? { x: 0, y: 0, width: screen.width, height: screen.height };

  useEffect(() => {
    if (!stalled) { setShowStall(false); return; }
    const timer = setTimeout(() => setShowStall(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [stalled]);

  if (dropped) {
    const buttons = Math.min(320, r.width - 48);
    return (
      <Blocker label="pair-dropped" layout={{
        position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height,
        backgroundColor: tint(COLOR.background, 0.9), alignItems: "center", justifyContent: "center", gap: 16, padding: 24,
      }}>
        <Icon icon={WifiOff} size={40} color={COLOR.destructive} />
        <View layout={{ width: r.width - 48 }}>
          <WrapText text={t("pair.partnerLeft")} size={TEXT.base} weight="600" align="center" />
        </View>
        <View layout={{ width: buttons, gap: 12 }}>
          <Pressable onTap={onRepair} layout={{
            padding: 12, borderRadius: RADIUS.lg, backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.border,
            alignItems: "center",
          }}>
            <Label text={t("pair.tryAgain")} size={TEXT.base} weight="600" />
          </Pressable>
          <Pressable onTap={onContinueSolo} layout={{
            padding: 12, borderRadius: RADIUS.lg, backgroundColor: COLOR.muted, alignItems: "center",
          }}>
            <Label text={t("pair.continueSolo")} size={TEXT.base} weight="600" />
          </Pressable>
        </View>
      </Blocker>
    );
  }

  if (!showStall) return null;

  return (
    <Region layout={{ position: "absolute", left: r.x, top: r.y + 8, width: r.width, flexDirection: "row", justifyContent: "center" }}>
      <Blocker label="pair-stalled" layout={{
        flexDirection: "row", alignItems: "center", gap: 8, borderRadius: RADIUS.full,
        backgroundColor: tint(COLOR.background, 0.9), borderWidth: 1, borderColor: COLOR.border,
        paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
      }}>
        <SpinningIcon icon={Loader2} size={16} color={COLOR.primary} />
        <Label text={t("pair.waitingFor", { name: remoteName })} size={TEXT.sm} />
      </Blocker>
    </Region>
  );
}
