/**
 * ShipEarlyBar - the map countdown bar (canvas port of
 * components/game/ShipEarlyBar.tsx), filling the shared context lane: exactly
 * HUD.contextLane tall, full width, and still that tall (empty) when hidden.
 *
 * It drains over the map's hard time limit and shades green -> red as it
 * empties, so it doubles as the deadline warning. The Ship Early fast-finish
 * bonus lives in the EARLY part of the same bar: white ticks mark where each
 * payout rung expires, and a chip shows the bonus still attainable; once every
 * window has passed the chip becomes a plain seconds-left readout. Hidden on
 * the tutorial band, which has neither a time limit nor Ship Early. Ticks arrive
 * at 1Hz; the fill eases over a second so the drain stays smooth.
 */
import { useTranslation } from "react-i18next";
import { Timer } from "lucide-react";
import { COLOR, Icon, Label, View, tint, useTween } from "../kit/ui";
import { HUD } from "./hudMetrics";
import { shipEarlyChip, shipEarlyView } from "./bottomModel";

interface ShipEarlyBarProps {
  /** Whole active-play seconds elapsed this map (1Hz from the loop). */
  seconds: number;
  /** Balls spawned on this map: the Ship Early windows are per ball (15s/ball etc.). */
  ballCount: number;
  /** The map's hard time limit in active-play seconds; the bar drains over this. */
  timeLimit: number;
  /** Deadline Extension: extra seconds per ball added to every Ship Early window. */
  extraSecondsPerBall?: number;
  /** Hard Deadline door: scales the payout shown in the value chip. */
  bonusMultiplier?: number;
  /** False hides the bar (win condition met, prompt open, tutorial band). */
  visible: boolean;
}

const BAR_H = 6;

export function ShipEarlyBar({ seconds, ballCount, timeLimit, extraSecondsPerBall = 0, bonusMultiplier = 1, visible }: ShipEarlyBarProps) {
  const { t } = useTranslation();
  const view = visible ? shipEarlyView({ seconds, ballCount, timeLimit, extraSecondsPerBall, bonusMultiplier }) : null;
  // Linear, like the DOM's `width 1s linear`: the clock ticks once a second
  // and the bar drains steadily between ticks instead of stepping.
  const fill = useTween(view?.remaining ?? 0, 1, "linear");
  const color = view?.color ?? COLOR.primary;
  if (!view) return <View layout={{ height: HUD.contextLane, alignSelf: "stretch" }} />;
  const chip = shipEarlyChip(view);

  return (
    <View layout={{
      height: HUD.contextLane, alignSelf: "stretch", justifyContent: "center", alignItems: "center",
      backgroundColor: tint(COLOR.black, 0.8),
    }}>
      {/* The top edge in the drain colour (a one-sided Yoga border is not drawn). */}
      <View layout={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: tint(color, 0x55 / 255) }} />
      <View layout={{ width: "100%", maxWidth: 896, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12 }}>
        <Icon icon={Timer} size={14} color={color} />
        <View layout={{ flex: 1, height: BAR_H, flexDirection: "row", borderRadius: BAR_H / 2, backgroundColor: tint(COLOR.white, 0.12) }}>
          <View layout={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%`, height: BAR_H, borderRadius: BAR_H / 2, backgroundColor: color }} />
          {/* Divider ticks where each payout rung expires: white and a touch
              taller than the bar so they read against both the fill and the
              track. Only rungs inside the time limit. */}
          {view.ticks.map(tk => (
            <View key={tk.key} layout={{
              position: "absolute", left: `${tk.at * 100}%`, marginLeft: -1, top: -2,
              width: 2, height: BAR_H + 4, borderRadius: 1, backgroundColor: tint(COLOR.white, 0.85),
            }} />
          ))}
        </View>
        <Label
          text={t(chip.key, chip.values)}
          font="display" size={12} weight="700" color={color} glow={8}
        />
      </View>
    </View>
  );
}
