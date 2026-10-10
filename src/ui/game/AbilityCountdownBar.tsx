/**
 * AbilityCountdownBar - a draining bar per active time-based ability (canvas
 * port of components/game/AbilityCountdownBar.tsx; #38). Tinted by the ability
 * colour, showing how long is left. One-shot abilities (Magnet / Shockwave /
 * Clear Fences) have no duration, so they never appear here.
 *
 * It self-animates against the timer's end on the sim clock, re-rendering each
 * frame only while a timer is active, so the bar drains to exactly zero the
 * instant the effect ends. A timer is dropped the moment it hits zero.
 *
 * Fills the shared context lane: exactly HUD.contextLane tall, full width,
 * and still that tall (empty) when there is nothing to show, so the stack
 * never moves. One timer is a single line; several sit side by side
 * (countdownLayout), where the DOM stacked extra rows the lane has no room for.
 */
import type { AbilityTimer } from "@/components/game/GameCanvas";
import { simNow } from "@/lib/simClock";
import { Label, ProgressBar, View, tint, COLOR } from "../kit/ui";
import { HUD } from "./hudMetrics";
import { useFrameTick } from "./bottomHooks";
import { countdownLayout, liveTimers, type LiveTimer } from "./bottomModel";

interface AbilityCountdownBarProps {
  timers: AbilityTimer[];
  visible: boolean;
}

const TRACK = tint(COLOR.white, 0.12);

export function AbilityCountdownBar({ timers, visible }: AbilityCountdownBarProps) {
  const active = visible && timers.length > 0;
  useFrameTick(active);
  const live = active ? liveTimers(timers, simNow()) : [];

  if (live.length === 0) return <View layout={{ height: HUD.contextLane, alignSelf: "stretch" }} />;
  const cells = countdownLayout(live.length) === "cells";

  return (
    <View layout={{ height: HUD.contextLane, alignSelf: "stretch", backgroundColor: tint(COLOR.black, 0.8), alignItems: "center", justifyContent: "center" }}>
      <View layout={{ width: "100%", maxWidth: 896, flexDirection: "row", alignItems: "center", gap: cells ? 10 : 8, paddingLeft: 12, paddingRight: 12 }}>
        {cells
          ? live.map(tmr => <TimerCell key={tmr.kind} tmr={tmr} />)
          : live.map(tmr => <TimerLine key={tmr.kind} tmr={tmr} />)}
      </View>
    </View>
  );
}

/** One timer across the lane: name, draining bar, seconds left. */
function TimerLine({ tmr }: { tmr: LiveTimer }) {
  return (
    <View layout={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Label text={tmr.name} font="display" size={10} weight="700" color={tmr.color} />
      <ProgressBar value={tmr.frac} color={tmr.color} track={TRACK} height={6} layout={{ flex: 1 }} />
      <Label text={`${tmr.secsLeft}s`} font="display" size={12} weight="700" color={tmr.color} glow={8} />
    </View>
  );
}

/** One of several timers sharing the lane: name and seconds over its bar. */
function TimerCell({ tmr }: { tmr: LiveTimer }) {
  return (
    <View layout={{ flex: 1, gap: 3 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <Label text={tmr.name} font="display" size={9} weight="700" color={tmr.color} layout={{ flexShrink: 1 }} />
        <Label text={`${tmr.secsLeft}s`} font="display" size={10} weight="700" color={tmr.color} />
      </View>
      <ProgressBar value={tmr.frac} color={tmr.color} track={TRACK} height={4} />
    </View>
  );
}
