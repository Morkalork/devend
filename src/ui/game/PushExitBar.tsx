/**
 * The way out of a push (canvas port of components/game/PushExitBar.tsx; the
 * reasoning there still holds). Solid accent fill, full width, and it says what
 * the player is about to walk away with.
 */
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Icon, Label, Pressable, RADIUS, TEXT, View, hex } from "../kit/ui";
import { HUD } from "./hudMetrics";

interface Props {
  /** Hours this push has banked so far. */
  bonusSoFar: number;
  onBank: () => void;
  accentColor: string;
}

/**
 * Dark ink on the accent, matching the prompt's own Bank button: the accent is
 * a bright board colour and light text on it disappears in sunlight.
 */
const INK = 0x04140b;

export function PushExitBar({ bonusSoFar, onBank, accentColor }: Props) {
  const { t } = useTranslation();
  const accent = hex(accentColor);
  const label = t("pushYourLuck.bankAndContinue");
  return (
    <View layout={{ height: HUD.pushExitRow, paddingLeft: 12, paddingRight: 12, paddingBottom: 8, justifyContent: "flex-end", alignItems: "center" }}>
      <Pressable
        label={label}
        onTap={onBank}
        pressedAlpha={0.85}
        layout={{
          width: "100%", maxWidth: 896,
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.lg, backgroundColor: accent,
        }}
      >
        <Icon icon={Landmark} size={20} color={INK} />
        <Label text={label} size={TEXT.base} weight="700" color={INK} />
        {/* Only once there is something to show: "+0h" reads as "this pays nothing". */}
        {bonusSoFar > 0 && (
          <Label text={t("pushYourLuck.bankedSoFar", { hours: bonusSoFar })} size={TEXT.base} weight="700" color={INK} />
        )}
      </Pressable>
    </View>
  );
}
