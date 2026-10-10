/**
 * The situation an upgrade needs, and whether it holds right now (canvas port
 * of components/game/ConditionChip.tsx).
 *
 * Not optional polish. A conditional upgrade whose condition is not on the card
 * is a trap: the player pays for a number that then does not appear, and
 * concludes the game is broken rather than that they misread it.
 *
 * Showing whether it is LIVE for the map they are about to play is what turns
 * it from a gamble into a decision, which is the entire point of making
 * upgrades conditional. "+45 per superior lock, not on this map" is information
 * you can act on; "+45 per superior lock" that then pays nothing is a bug
 * report.
 */
import { useTranslation } from "react-i18next";
import { Zap, Clock } from "lucide-react";
import type { UpgradeCondition } from "@/lib/upgradeConditions";
import { Icon, Label, RADIUS, View, tint, type Layout } from "../kit/ui";
import { conditionChipLook, conditionChipText, textSizeOfClass } from "./tagChipModel";

interface Props {
  condition: UpgradeCondition;
  /** Does it hold for the map about to be played? */
  live: boolean;
  /** Tailwind text-size class, read for its px size. */
  sizeClass?: string;
  /** Canvas only: placement in the parent (the DOM span was inline). */
  layout?: Layout;
}

export function ConditionChip({ condition, live, sizeClass = "text-[10px]", layout }: Props) {
  const { t } = useTranslation();
  const { text, title } = conditionChipText(t, condition, live);
  const look = conditionChipLook(live);
  const size = textSizeOfClass(sizeClass, 10);
  return (
    <View
      label={title}
      layout={{
        flexDirection: "row", alignItems: "center", gap: 4,
        paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
        borderRadius: RADIUS.base, borderWidth: 1,
        borderColor: tint(look.border, look.borderAlpha),
        backgroundColor: tint(look.background, look.backgroundAlpha),
        alignSelf: "flex-start",
        ...(layout ?? {}),
      }}
    >
      <Icon icon={live ? Zap : Clock} size={10} color={look.color} />
      <Label text={text} size={size} weight="500" color={look.color} />
    </View>
  );
}
