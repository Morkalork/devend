/**
 * PairMismatchNotice - the two phones are not set up to play the same game
 * (TWO_PLAYER_PLAN.md step 6; canvas port of components/game/PairMismatchNotice.tsx).
 *
 * Certificates, achievements and loadout bonuses live in each phone's own
 * storage and none of them travel in the run record. A player holding an
 * unlock their partner lacks computes different fence speeds and lock
 * thresholds from the very first tick, on a board that looks identical.
 *
 * The desync detector would notice within a second and then repair for ever,
 * because the cause is not on the board. So this stops instead: saying "you
 * two are not playing the same game" once is kinder than a map that quietly
 * corrects itself thirty times a minute. Full screen, and it takes every touch.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { COLOR, Icon, Label, Pressable, RADIUS, TEXT, tint, useUiScreen, View } from "../kit/ui";
import { WrapText } from "./modalParts";
import { Blocker } from "./boardParts";

export function PairMismatchNotice({ remoteName, onLeave }: {
  remoteName: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const column = Math.min(320, screen.width - 48);
  return (
    <Blocker label="pair-mismatch" zIndex={70} layout={{
      position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height,
      backgroundColor: tint(COLOR.background, 0.95), alignItems: "center", justifyContent: "center", gap: 16, padding: 24,
    }}>
      <Icon icon={AlertTriangle} size={40} color={COLOR.destructive} />
      <View layout={{ width: screen.width - 48 }}>
        <WrapText text={t("pair.mismatchTitle")} size={TEXT.base} weight="600" align="center" />
      </View>
      <View layout={{ width: column }}>
        <WrapText text={t("pair.mismatchBody", { name: remoteName })} size={TEXT.sm} color={COLOR.mutedForeground} align="center" />
      </View>
      <Pressable onTap={onLeave} label="pair-mismatch-back" layout={{
        width: column, padding: 12, borderRadius: RADIUS.lg, backgroundColor: COLOR.card,
        borderWidth: 1, borderColor: COLOR.border, alignItems: "center",
      }}>
        <Label text={t("common.back")} size={TEXT.base} weight="600" />
      </Pressable>
    </Blocker>
  );
}
