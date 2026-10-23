/**
 * The map's Acceptance Criteria, drawn as the map's own ticket (UI_REDO_PLAN.md,
 * the store follow-up): the store's tickets and this one share a look, so the
 * map reads as the next ticket off the board. A type square and a key, the
 * level as the title, the map's id as its branch, then "Acceptance criteria"
 * with each criterion a checklist item under its group.
 *
 * It replaces the generic explainer card for this one modal, because it is the
 * only explainer that is a list, and a list wants rows rather than a
 * monospace paragraph of dashes. Tap anywhere to close, like every explainer.
 * The card itself is AcceptanceTicket, which the Debrief draws again after the
 * map with the rows marked.
 */
import { useTranslation } from "react-i18next";
import type { Criterion } from "@/lib/winConditions";
import { Appear, Label, Pressable, ROLE, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { tutorialCardWidth } from "./TutorialOverlayModel";
import { AcceptanceTicket } from "./AcceptanceTicket";

interface AcceptanceCriteriaModalProps {
  criteria: Criterion[];
  levelNumber: number;
  levelId: string;
  levelName?: string;
  levelPremise?: string;
  accentColor?: string;
  onDismiss: () => void;
}

export function AcceptanceCriteriaModal({ criteria, levelNumber, levelId, levelName, levelPremise, accentColor = "#00ff88", onDismiss }: AcceptanceCriteriaModalProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={60}>
      <Appear duration={0.2} layout={{ width: screen.width, height: screen.height }}>
        {/* "Tap anywhere": the scrim and the ticket are one dismiss target. */}
        <Pressable onTap={onDismiss} pressedAlpha={1} label="criteria-dismiss"
          layout={{ width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: tint(0x000000, 0.75) }}>
          <Appear fromY={12} duration={0.25}>
            <AcceptanceTicket rows={criteria} levelNumber={levelNumber} levelId={levelId} levelName={levelName} levelPremise={levelPremise}
              accent={hex(accentColor)} width={tutorialCardWidth(screen.width)}
              footer={<Label text={t("tutorialOverlay.tapToContinue")} size={TEXT.xs} color={ROLE.muted} layout={{ marginTop: 4 }} />} />
          </Appear>
        </Pressable>
      </Appear>
    </View>
  );
}
