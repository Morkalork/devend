/**
 * PairDecision - Continue or New, for a pair that has met before
 * (TWO_PLAYER_PLAN.md step 6b; canvas port of components/game/PairDecision.tsx).
 *
 * Both phones show the same two buttons; only the host's do anything. That is
 * not a slight on the guest, it is what keeps a run in one state: every
 * between-map decision in this game is about ONE run, and a run that is both
 * resumed and restarted is not a run. The guest's side says who it is waiting
 * for, so the pause reads as the other player thinking rather than as the
 * screen being broken.
 */
import { useTranslation } from "react-i18next";
import { Users, Play, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PairSaveOffer } from "@/hooks/usePairRunSave";
import { COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, useUiScreen } from "../kit/ui";
import { Spinner } from "./welcomeParts";
import { pairResumeLevel } from "./PairDecisionModel";

interface PairDecisionProps {
  isHost: boolean;
  remoteName: string;
  /** The saves each phone is holding for this pair; null means none. */
  mine: PairSaveOffer | null;
  theirs: PairSaveOffer | null;
  onContinue: () => void;
  onNew: () => void;
  onLeave: () => void;
}

export function PairDecision({
  isHost, remoteName, mine, theirs, onContinue, onNew, onLeave,
}: PairDecisionProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const resumeAt = pairResumeLevel(mine, theirs);
  const width = Math.min(448, screen.width - 32);

  // A card-row button; the guest sees it, disabled, so both phones match.
  const choice = (icon: LucideIcon, iconColor: number, text: string, onTap: () => void, center = false) => (
    <Pressable
      onTap={onTap}
      disabled={!isHost}
      label={text}
      layout={{
        flexDirection: "row", alignItems: "center", gap: 12, padding: 16,
        justifyContent: center ? "center" : "flex-start",
        borderRadius: RADIUS.lg, backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.border,
      }}
    >
      <Icon icon={icon} size={20} color={iconColor} />
      <Label text={text} size={TEXT.base} weight="600" />
    </Pressable>
  );

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: COLOR.background }}>
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ minHeight: screen.height, padding: 16, alignItems: "center", justifyContent: "center" }}>
          <View layout={{ width, gap: 24 }}>
            <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <Icon icon={Users} size={24} color={COLOR.primary} />
              <Label text={remoteName} size={TEXT.base} weight="600" />
            </View>

            {resumeAt !== null ? (
              <>
                <Label text={t("pair.savedRun", { level: resumeAt })} size={TEXT.sm} color={COLOR.mutedForeground} align="center" wrap />
                <View layout={{ gap: 12 }}>
                  {choice(Play, COLOR.primary, t("pair.continueRun"), onContinue)}
                  {choice(RotateCcw, COLOR.mutedForeground, t("pair.newGame"), onNew)}
                </View>
              </>
            ) : (
              choice(Play, COLOR.primary, t("pair.newGame"), onNew, true)
            )}

            {!isHost && (
              <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Spinner size={16} color={COLOR.mutedForeground} />
                <Label text={t("pair.waitingForPartner")} size={TEXT.sm} color={COLOR.mutedForeground} />
              </View>
            )}

            <Pressable onTap={onLeave} label={t("common.cancel")} layout={{ padding: 12, borderRadius: RADIUS.lg, backgroundColor: COLOR.muted, alignItems: "center" }}>
              <Label text={t("common.cancel")} size={TEXT.sm} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
