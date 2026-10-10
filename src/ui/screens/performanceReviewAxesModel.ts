/**
 * The Performance Review's rows, worked out from the banked axes (canvas port
 * of components/game/PerformanceReviewAxes.tsx; the long argument for the
 * "earned/ceiling" readout lives at the top of that file and of
 * PerformanceReviewAxes.tsx here).
 */
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import { Lock, Medal, Timer, Scissors, Flame, Hammer } from "lucide-react";
import type { BankedAxes } from "@/types/scoring";
import { AXIS_NAMES, type AxisName } from "@/lib/scoreAxes";
import { COLOR } from "../theme";
import { SUCCESS, TW } from "./levelCompleteModel";

/** Icon and colour per axis. Colours match the itemised rows below the block. */
export const AXIS_STYLE: Record<AxisName, { icon: LucideIcon; color: number }> = {
  delivery: { icon: Lock, color: TW.cyan400 },
  craft: { icon: Medal, color: TW.cyan300 },
  tempo: { icon: Timer, color: TW.teal400 },
  thrift: { icon: Scissors, color: SUCCESS },
  greed: { icon: Flame, color: COLOR.primary },
  engagement: { icon: Hammer, color: TW.amber400 },
};

/** How the right-hand number reads: a landed lane, a short one, or one never offered. */
export type AxisTone = "full" | "short" | "none";

export interface AxisRow {
  name: AxisName;
  label: string;
  icon: LucideIcon;
  /** The lane's colour (the label takes it once anything was banked). */
  color: number;
  /** 0..1 of the bar. */
  fill: number;
  spent: boolean;
  short: number;
  full: boolean;
  valueText: string;
  tone: AxisTone;
  /** The colour of the right-hand number. */
  valueColor: number;
  /** Seconds before this bar starts filling (the rows fill in a ripple). */
  delay: number;
}

export function axisRows(axes: BankedAxes, t: TFunction): AxisRow[] {
  return AXIS_NAMES.filter(name => (
    // A lane the map never offered is not drawn at all. Engagement is the one
    // axis that can be genuinely absent: on a map with no feature on the
    // board, an empty bar would claim hours were left on the table when no
    // play could have banked them, which is false and demoralising.
    name !== "engagement" || axes.ceilings.engagement > 0
  )).map((name, i) => {
    const style = AXIS_STYLE[name];
    const earned = axes[name];
    const ceiling = axes.ceilings[name];
    // A ceiling of zero means the map never offered this axis; show it as
    // empty rather than dividing by nothing.
    const fill = ceiling > 0 ? Math.min(1, earned / ceiling) : 0;
    const spent = earned > 0;
    // Rounded the same way the axis itself is, so the earned and missing
    // hours always add up to the ceiling on screen.
    const short = Math.max(0, ceiling - earned);
    const full = ceiling > 0 && short === 0;
    const tone: AxisTone = full ? "full" : short > 0 ? "short" : "none";
    return {
      name,
      label: t(`levelComplete.axes.${name}`),
      icon: style.icon,
      color: style.color,
      fill,
      spent,
      short,
      full,
      valueText: ceiling <= 0
        ? "-"
        : full
          ? t("levelComplete.axes.full", { hours: earned })
          : t("levelComplete.axes.outOf", { earned, ceiling }),
      tone,
      // A short axis reads as a loss (text-destructive/80), so the eye does
      // not take "18/30h" as a score out of thirty.
      valueColor: tone === "full" ? style.color : tone === "short" ? COLOR.destructive : COLOR.mutedForeground,
      delay: 0.1 + i * 0.07,
    };
  });
}
