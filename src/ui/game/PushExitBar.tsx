/**
 * The way out of a push (canvas port of components/game/PushExitBar.tsx; the
 * reasoning there still holds). Solid accent fill, full width, and it says what
 * the player is about to walk away with.
 */
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide";
import { HUD } from "./hudMetrics";
import { hex } from "../theme";
import { Icon, Label, Pressable, RADIUS, TEXT, View } from "../kit/ui";

interface Props {
  /** Hours this push has banked so far. */
  bonusSoFar: number;
  onBank: () => void;
  accentColor: string;
}

export function PushExitBar({ bonusSoFar, onBank, accentColor }: Props) {
  const { t } = useTranslation();
  const accent = hex(accentColor);
  // Dark ink on the accent: light text on a bright board colour vanishes in sunlight.
  const ink = 0x04140b;
  return (
    <View layout={{ height: HUD.pushExitRow, paddingLeft: 12, paddingRight: 12, paddingBottom: 8, justifyContent: "flex-end" }}>
      <Pressable
        onTap={onBank}
        pressedAlpha={0.85}
        layout={{
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.lg, backgroundColor: accent,
        }}
      >
        <Icon icon={Landmark} size={20} color={ink} />
        <Label text={t("pushYourLuck.bankAndContinue")} size={TEXT.base} weight="700" color={ink} />
        {/* Only once there is something to show: "+0h" reads as "this pays nothing". */}
        {bonusSoFar > 0 && (
          <Label text={t("pushYourLuck.bankedSoFar", { hours: bonusSoFar })} size={TEXT.base} weight="700" color={ink} font="mono" />
        )}
      </Pressable>
    </View>
  );
}
