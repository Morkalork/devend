/**
 * One goal, in the row of goals (canvas port of components/game/GoalChip.tsx).
 *
 * Replaces WinGateChip and the three bespoke readouts beside it (cuts against
 * par, space counting down, a bare lock tally), which between them gave a
 * player four notations to decode in answer to one question. Everything here
 * reads the same way: an icon, progress, a target, a name.
 *
 * The tiers are NOT cosmetic (see lib/goalTracker.ts). A requirement is
 * something the map demands and can go at risk; a budget is score, never the
 * map; a tally has nothing to reach. Rendering them identically would say the
 * map wants eight cuts, which no map does.
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import type { FederatedPointerEvent } from "pixi.js";
import type { Goal } from "@/lib/goalTracker";
import { goalIcon } from "@/components/game/goalIcons";
import { Icon, Label, PRESS_SLOP_PX, hex, useUiScreen, usePress } from "../kit/ui";
import { claimTap } from "./topBarGestures";
import { goalChipAria, goalChipLabel, goalChipLook } from "./goalChipModel";
import { StatFlash } from "./TopBarFlash";

interface Props {
  goal: Goal;
  accentColor: string;
  /** One ball left and this goal still outstanding: locking it strands the map. */
  atRisk?: boolean;
  /** Tap target: opens the "How to win" text, which carries the full wording. */
  onExplain?: () => void;
  /** Flash key for the count-change animation, if this row animates. */
  flashKey?: number;
  /**
   * Press-and-hold, for a goal that has more to say than a fraction. Only space
   * uses it (exact remaining and cleared numbers, useful mid Push Your Luck
   * when the chip just reads CLEAR), and it brings the project's standard Info
   * hint with it so the chip reads as holdable.
   */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  /**
   * Is every requirement on this map met (goalTracker.everyRequirementMet)?
   *
   * The space chip's "CLEAR" speaks for the whole MAP, not for its own clause,
   * so it needs to know what its siblings are doing. It used to print CLEAR
   * whenever the space goal alone was done, which on level 13 ("clear to 14%
   * AND smash one slab") told the player they had won while the map went on
   * correctly waiting for the slab.
   */
  winMet?: boolean;
}

/** Tailwind's `sm` breakpoint: the name shows beside the number from here up. */
const SHOW_NAME_FROM = 640;

export function GoalChip({
  goal, accentColor, atRisk = false, onExplain, flashKey = 0, onHoldStart, onHoldEnd,
  winMet = false,
}: Props) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const icon = goalIcon(goal);
  const label = goalChipLabel(t, goal);
  const look = goalChipLook(goal, accent, atRisk, winMet, t("topBar.clear"));
  const { pressed, props } = usePress({ onTap: onExplain });

  // The hold callbacks are raw press edges, as in the DOM (the bar runs the
  // 450ms timer). A drag past the tap slop ends the hold, so scrolling the row
  // from this chip never opens the detail.
  const hold = useRef<{ live: boolean; x: number; y: number }>({ live: false, x: 0, y: 0 });
  const endHold = () => {
    if (!hold.current.live) return;
    hold.current.live = false;
    onHoldEnd?.();
  };

  return (
    <layoutContainer
      layout={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}
      alpha={pressed ? 0.7 : 1}
      label={goalChipAria(t, label, look.value, atRisk)}
      {...props}
      onPointerDown={(e: FederatedPointerEvent) => {
        // The row behind expands the Specs panel on a tap: a chip that opened
        // two things at once would be worse than one that opened nothing.
        claimTap(e);
        props.onPointerDown(e);
        hold.current = { live: true, x: e.global.x, y: e.global.y };
        onHoldStart?.();
      }}
      onPointerUp={() => { endHold(); props.onPointerUp(); }}
      onPointerUpOutside={() => { endHold(); props.onPointerUpOutside(); }}
      onPointerCancel={() => { endHold(); props.onPointerCancel(); }}
      onGlobalPointerMove={(e: FederatedPointerEvent) => {
        const h = hold.current;
        if (h.live && Math.hypot(e.global.x - h.x, e.global.y - h.y) > PRESS_SLOP_PX) endHold();
        props.onGlobalPointerMove(e);
      }}
    >
      <Icon icon={icon} size={16} color={look.color} />
      <StatFlash flashKey={flashKey}>
        <Label
          text={look.shown}
          font="display" size={14} weight="700" color={look.color}
          glow={look.glow !== null ? 10 : undefined}
        />
      </StatFlash>
      {/* The name is what teaches the rule, so it is not behind a hold. Only
          from the sm breakpoint up, as in the DOM: this row is one line on a phone. */}
      {screen.width >= SHOW_NAME_FROM && (
        <Label text={label} font="display" size={10} upper letterSpacing={0.5} color={look.color} alpha={0.85} />
      )}
      {onHoldStart && <Icon icon={Info} size={12} color={accent} alpha={0.5} />}
    </layoutContainer>
  );
}
