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
 */
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, CircleX, GitBranch, Square, SquareKanban, Split } from "lucide-react";
import { criteriaSections, type Criterion, type CriterionGroup } from "@/lib/winConditions";
import { Appear, Icon, Label, Pressable, RADIUS, ROLE, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import type { IconSource } from "../kit/icons";
import { ticketKey } from "../screens/storeBoardModel";
import { tutorialCardWidth } from "./TutorialOverlayModel";

interface AcceptanceCriteriaModalProps {
  criteria: Criterion[];
  levelNumber: number;
  levelId: string;
  accentColor?: string;
  onDismiss: () => void;
}

/** Each group's checklist mark and ink: a box to tick, a fork, a trade, a failure. */
function groupLook(group: CriterionGroup, accent: number): { icon: IconSource; color: number } {
  switch (group) {
    case "either": return { icon: Split, color: accent };
    case "trade": return { icon: ArrowLeftRight, color: ROLE.hours };
    case "fail": return { icon: CircleX, color: ROLE.cost };
    default: return { icon: Square, color: accent };
  }
}

export function AcceptanceCriteriaModal({ criteria, levelNumber, levelId, accentColor = "#00ff88", onDismiss }: AcceptanceCriteriaModalProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const sections = criteriaSections(criteria, (group, count) => (group === "required" && count > 1
    ? t("winConditions.groupRequiredAll")
    : t(`winConditions.group.${group}`)));

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={60}>
      <Appear duration={0.2} layout={{ width: screen.width, height: screen.height }}>
        {/* "Tap anywhere": the scrim and the ticket are one dismiss target. */}
        <Pressable onTap={onDismiss} pressedAlpha={1} label="criteria-dismiss"
          layout={{ width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: tint(0x000000, 0.75) }}>
          <Appear fromY={12} duration={0.25}>
            <View label="acceptance-criteria" layout={{
              width: tutorialCardWidth(screen.width), flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
              backgroundColor: ROLE.raised, borderWidth: 1, borderColor: ROLE.edge,
            }}>
              {/* The type stripe, in the band's accent: this is the map's ticket. */}
              <View layout={{ width: 4, backgroundColor: accent }} />

              <View layout={{ flex: 1, padding: 18, gap: 14 }}>
                {/* Type square and key. */}
                <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View layout={{ width: 22, height: 22, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: tint(accent, 0.2) }}>
                    <Icon icon={SquareKanban} size={14} color={accent} />
                  </View>
                  <Label text={ticketKey(levelId)} size={TEXT.xs} font="mono" color={ROLE.muted} />
                </View>

                {/* Title and branch. */}
                <View layout={{ gap: 4 }}>
                  <Label text={t("pipeline.level", { level: levelNumber })} size={TEXT["2xl"]} font="display" weight="700" color={ROLE.ink} wrap />
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Icon icon={GitBranch} size={13} color={ROLE.muted} />
                    <Label text={levelId} size={TEXT.xs} font="mono" color={ROLE.muted} />
                  </View>
                </View>

                <View layout={{ height: 1, alignSelf: "stretch", backgroundColor: ROLE.edge }} />

                {/* The field itself. */}
                <Label text={t("winConditions.title")} size={TEXT.xs} weight="700" upper letterSpacing={1} color={ROLE.muted} />
                {sections.map(section => {
                  const look = groupLook(section.group, accent);
                  return (
                    <View key={section.group} label={`criteria-${section.group}`} layout={{ gap: 8 }}>
                      <Label text={section.heading} size={TEXT.sm} font="display" weight="600" color={section.group === "fail" ? ROLE.cost : ROLE.ink} />
                      {section.items.map((item, i) => (
                        <View key={i} layout={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                          <Icon icon={look.icon} size={16} color={look.color} layout={{ marginTop: 2 }} />
                          <View layout={{ flex: 1 }}>
                            <Label text={item.text} size={TEXT.base} lineHeight={22} color={ROLE.ink} wrap />
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })}

                <Label text={t("tutorialOverlay.tapToContinue")} size={TEXT.xs} color={ROLE.muted} layout={{ marginTop: 4 }} />
              </View>
            </View>
          </Appear>
        </Pressable>
      </Appear>
    </View>
  );
}
