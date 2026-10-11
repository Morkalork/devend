/**
 * AbilityInfoModal - the explainer for an ability you are holding (canvas port
 * of components/game/AbilityInfoModal.tsx). Opened by long-pressing an ability
 * button, and auto-shown once the first time an ability is acquired. Shows
 * what it does and how to use it; dismiss on backdrop or X.
 *
 * What it deliberately does NOT say is how the ability was obtained. A footer
 * once claimed "tap the gem within 2 seconds", which was wrong twice over (the
 * reward is banked when the chest breaks, and a chest is not the only source),
 * and it answered a question nobody has here: this card opens off an ability
 * the player is ALREADY holding.
 */
import { useTranslation } from "react-i18next";
import type { AbilityDef } from "@/lib/abilities";
import { COLOR, Label, TEXT, View, useUiScreen } from "../kit/ui";
import { InfoCardModal } from "./modalParts";
import { abilityInfoLines, cssColor, HOW_TO_USE_KEY } from "./bottomModel";

interface AbilityInfoModalProps {
  ability: AbilityDef;
  onClose: () => void;
}

/** `leading-snug` on the card's text-sm copy. */
const SNUG = Math.round(TEXT.sm * 1.375);

export function AbilityInfoModal({ ability, onClose }: AbilityInfoModalProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const color = cssColor(ability.color, 0xffffff);
  const { description, howTo } = abilityInfoLines(ability);
  return (
    <InfoCardModal screen={screen} onClose={onClose} title={ability.name} color={color}>
      {description && <Label text={description} size={TEXT.sm} lineHeight={SNUG} color={COLOR.foreground} wrap />}
      {howTo && (
        <View layout={{ gap: 4 }}>
          <Label text={t(HOW_TO_USE_KEY)} size={10} weight="700" letterSpacing={0.5} color={color} alpha={0.8} />
          <Label text={howTo} size={TEXT.sm} lineHeight={SNUG} color={COLOR.mutedForeground} wrap />
        </View>
      )}
    </InfoCardModal>
  );
}
