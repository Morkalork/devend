/**
 * The Performance Review: one bar per lane, showing which a run committed to
 * (canvas port of components/game/PerformanceReviewAxes.tsx).
 *
 * This is the half of the axis economy that makes it a CHOICE rather than a
 * formula: a player who cannot see that they filled Craft and left Tempo empty
 * has no basis for playing the next map differently. The itemised hours say
 * what was earned; this says what KIND of run it was.
 *
 * Deliberately shows empty axes too: an axis at zero is the hours that were on
 * the table and left there, and the ring is built so you can never fill all five.
 *
 * The right-hand number is "earned/ceiling". A bare shortfall ("-12h") was only
 * safe while itemised rows below carried the hours banked; those rows were
 * duplicates of these axes and are gone, so the row shows both halves and the
 * deficit is carried by the bar's empty half and the destructive colour. A full
 * axis gets its own copy ("30h ✓"): the tick is what the eye finds when
 * scanning for which lanes landed.
 *
 * There is deliberately NO grand "you missed Nh" total: the tactical axes
 * fight each other, so the sum of all five ceilings is not a score anyone can
 * get, and a deficit against it would make every run look like a failure.
 */
import { useTranslation } from "react-i18next";
import type { BankedAxes } from "@/types/scoring";
import type { PressHandlers } from "../kit/ui";
import { COLOR, Icon, Label, Pressable, ProgressBar, TEXT, View, tint } from "../kit/ui";
import { axisRows, type AxisRow } from "./performanceReviewAxesModel";
import { useGrowFromZero } from "./resultMotion";

interface Props {
  axes: BankedAxes;
  /**
   * Press-and-hold binding from the overlay, so each bar can explain itself.
   * On the canvas it returns the Pressable handlers (`onHold`) for that key.
   */
  hold?: (key: string) => PressHandlers;
}

export function PerformanceReviewAxes({ axes, hold }: Props) {
  const { t } = useTranslation();
  const rows = axisRows(axes, t);
  return (
    <View layout={{ paddingTop: 8, paddingBottom: 8 }}>
      <Label text={t("levelComplete.axes.title")} size={TEXT.xs} color={COLOR.mutedForeground} upper letterSpacing={0.3}
        layout={{ marginBottom: 8 }} />
      <View layout={{ gap: 6 }}>
        {rows.map(row => <AxisBar key={row.name} row={row} handlers={hold?.(`axis_${row.name}`)} />)}
      </View>
      {/* border-b */}
      <View layout={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: COLOR.border }} />
    </View>
  );
}

function AxisBar({ row, handlers }: { row: AxisRow; handlers?: PressHandlers }) {
  // The bar grows in from empty, each row a beat after the one above.
  const fill = useGrowFromZero(row.fill, 0.45, row.delay);
  const labelColor = row.spent ? row.color : COLOR.mutedForeground;
  return (
    <Pressable {...handlers} pressedAlpha={1} layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View layout={{ width: 88, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Icon icon={row.icon} size={12} color={labelColor} />
        <View layout={{ flex: 1, flexShrink: 1, flexDirection: "row" }}>
          <Label text={row.label} size={TEXT.xs} color={labelColor} />
        </View>
      </View>
      <ProgressBar value={fill} color={row.color} track={tint(COLOR.muted, 0.4)} height={6} layout={{ flex: 1 }} />
      <View layout={{ width: 68, flexDirection: "row", justifyContent: "flex-end" }}>
        <Label text={row.valueText} size={TEXT.xs} weight="700" font="mono" color={row.valueColor}
          alpha={row.tone === "short" ? 0.8 : 1} />
      </View>
    </Pressable>
  );
}
