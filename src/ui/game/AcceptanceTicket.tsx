/**
 * The map's Acceptance Criteria as its ticket (UI_REDO_PLAN.md): a type
 * stripe in the band's accent, a key hashed from the map id, "Level N" with
 * the map id as its branch, then each criterion a checklist row under its
 * group.
 *
 * Drawn twice for every map: before it, as the explainer (AcceptanceCriteria-
 * Modal), and after it as the Debrief, where the same rows come back marked.
 * Unmarked, a row shows its group's glyph (a box to tick, a fork, a trade, a
 * failure); marked, a green check for a criterion met (a failure avoided
 * counts) and a red cross for one missed.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, SquareKanban } from "lucide-react";
import { criteriaSections } from "@/lib/winConditions";
import { Appear, Icon, Label, RADIUS, ROLE, TEXT, View, tint } from "../kit/ui";
import { rowLook, type TicketRow } from "./AcceptanceTicketModel";
import { ticketKey } from "../screens/storeBoardModel";

interface AcceptanceTicketProps {
  rows: TicketRow[];
  levelNumber: number;
  levelId: string;
  accent: number;
  width: number;
  /** Under the criteria, inside the card ("Tap anywhere to continue"). */
  footer?: ReactNode;
  /**
   * Head the failures "Failure, avoided" when every one was. On for the
   * Debrief; off on the failed screen, where the map DID fail (by a rule the
   * list may not name, like a ball into a growing fence).
   */
  sayAvoided?: boolean;
  /**
   * How many rows (in reading order) show their mark; the rest show the empty
   * glyph they had before the map. Absent: all of them (fillIn.ts).
   */
  filled?: number;
  /** The figure in the key row's corner, the way a store ticket shows its estimate: the hours earned. */
  estimate?: string;
}

export function AcceptanceTicket({ rows, levelNumber, levelId, accent, width, footer, sayAvoided = true, filled, estimate }: AcceptanceTicketProps) {
  const { t } = useTranslation();
  // Marked, a failure row's green check means it did NOT happen; the heading
  // says so, or "Failure" over a check reads as "yes, the timer ran out".
  const failsAvoided = sayAvoided && (filled == null || filled >= rows.length) && rows.some(r => r.group === "fail") && rows.every(r => r.group !== "fail" || r.met === true);
  const sections = criteriaSections(rows, (group, count) => (group === "required" && count > 1
    ? t("winConditions.groupRequiredAll")
    : group === "fail" && failsAvoided ? t("winConditions.groupFailAvoided")
    : t(`winConditions.group.${group}`)));
  // Where each group's rows start in reading order.
  const order0: Record<string, number> = {};
  sections.reduce((n, sec) => { order0[sec.group] = n; return n + sec.items.length; }, 0);

  return (
    <View label="acceptance-criteria" layout={{
      width, flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
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
          {/* Pushes the estimate to the corner; the key stays beside its square. */}
          <View layout={{ flex: 1 }} />
          {estimate && (
            <Appear fromScale={1.3} duration={0.2}>
              <Label text={estimate} size={TEXT.base} font="display" weight="700" color={ROLE.hours} />
            </Appear>
          )}
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
        {sections.map(section => (
          <View key={section.group} label={`criteria-${section.group}`} layout={{ gap: 8 }}>
            <Label text={section.heading} size={TEXT.sm} font="display" weight="600" color={section.group === "fail" ? ROLE.cost : ROLE.ink} />
            {section.items.map((item, i) => {
              // Reading order across the groups, so the marks go down the card.
              const order = order0[section.group] + i;
              const shown = filled == null || order < filled;
              const look = rowLook(shown ? item : { ...item, met: undefined }, accent);
              return (
                <View key={i} label={`criterion-${look.label}`} layout={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  {/* A mark lands with a small pop; keyed so it replays when the box is ticked. */}
                  <Appear key={shown && item.met != null ? "marked" : "open"} fromScale={shown && item.met != null && filled != null ? 1.7 : 1} duration={0.18}
                    layout={{ marginTop: 2 }}>
                    <Icon icon={look.icon} size={16} color={look.color} />
                  </Appear>
                  <View layout={{ flex: 1 }}>
                    <Label text={item.text} size={TEXT.base} lineHeight={22} color={ROLE.ink} wrap />
                  </View>
                </View>
              );
            })}
          </View>
        ))}

        {footer}
      </View>
    </View>
  );
}
