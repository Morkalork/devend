/**
 * FenceTypeInfoModal - the explainer for a fence type (canvas port of
 * components/game/FenceTypeInfoModal.tsx; FENCE_TYPES_PLAN.md).
 *
 * Opened by long-pressing a slot, and auto-shown once the first time a type is
 * acquired. Deliberately built like AbilityInfoModal rather than sharing it:
 * a fence type has a build speed and no charges, and one component taking a
 * union of both is how a modal ends up saying "x0" over a thing with no charges.
 * (They share only the card, InfoCardModal.)
 */
import { useTranslation } from "react-i18next";
import { Hand } from "lucide-react";
import type { FenceTypeDef } from "@/lib/fences";
import { COLOR, Icon, Label, RADIUS, TEXT, View, tint, useUiScreen } from "../kit/ui";
import { InfoCardModal } from "./modalParts";
import { cssColor, fenceSpeedLine, FENCE_INFO_FOOTER_KEY, HOW_TO_USE_KEY } from "./bottomModel";

interface Props {
  fence: FenceTypeDef;
  onClose: () => void;
}

/** `leading-snug` on the card's text-sm and text-xs copy. */
const SNUG = Math.round(TEXT.sm * 1.375);
const SNUG_XS = Math.round(TEXT.xs * 1.375);

export function FenceTypeInfoModal({ fence, onClose }: Props) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const color = cssColor(fence.color, 0xffffff);
  // The one line that says what a type COSTS: every special fence is paid for
  // in build speed, invisible on the board until a ball is racing your cut.
  const speed = fenceSpeedLine(fence.buildSpeed);
  const box = {
    borderRadius: RADIUS.md, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8,
    backgroundColor: tint(color, 0x14 / 255), borderColor: tint(color, 0x33 / 255), borderWidth: 1,
  };
  return (
    <InfoCardModal screen={screen} onClose={onClose} title={fence.name} color={color}>
      {fence.description && (
        <Label text={fence.description} size={TEXT.sm} lineHeight={SNUG} color={COLOR.foreground} wrap />
      )}
      {speed && (
        <View layout={box}>
          <Label text={t(speed.key, { percent: speed.percent })} size={TEXT.xs} lineHeight={SNUG_XS} color={color} wrap />
        </View>
      )}
      {fence.howTo && (
        <View layout={{ gap: 4 }}>
          <Label text={t(HOW_TO_USE_KEY)} size={10} weight="700" letterSpacing={0.5} color={color} alpha={0.8} />
          <Label text={fence.howTo} size={TEXT.sm} lineHeight={SNUG} color={COLOR.mutedForeground} wrap />
        </View>
      )}
      <View layout={{ ...box, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <Icon icon={Hand} size={16} color={color} layout={{ marginTop: 1 }} />
        <View layout={{ flex: 1 }}>
          <Label text={t(FENCE_INFO_FOOTER_KEY)} size={TEXT.xs} lineHeight={SNUG_XS} color={COLOR.mutedForeground} wrap />
        </View>
      </View>
    </InfoCardModal>
  );
}
