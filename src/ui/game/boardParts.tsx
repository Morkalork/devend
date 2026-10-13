/**
 * Containers for what is drawn over the board, by how they treat a touch.
 *
 * The board asks the interface whether anything interactive is under a finger
 * before starting a fence (hitGate), so whatever is drawn over it must answer
 * no unless it really is a control. A plain box is passive (ui/setup.ts), but
 * passive only means "not a target itself": its children are still hit-tested,
 * so one static descendant anywhere under a decorative frame would make the
 * board refuse the cut there. So an overlay says what it is, explicitly:
 *
 *  - Inert: decoration (the DOM's `pointer-events-none`). It and everything in
 *    it is skipped by the hit test, so the board gets the touch.
 *  - Region: a box positioning interactive children (a Pass button, a clear
 *    button) that is itself transparent to touch, like a click-through wrapper
 *    with `pointer-events-auto` children.
 *  - Blocker: takes the touch and does nothing with it, like a DOM element
 *    with pointer events that has no handler (a backdrop, a panel).
 */
import { useCallback, type ReactNode } from "react";
import type { Graphics } from "pixi.js";
import { useReducedMotion } from "../reducedMotion";
import { insetGlow, outerGlow } from "./boardDraw";
import type { Layout } from "../kit/ui";
import { Icon, Label, useUiScreen } from "../kit/ui";
import type { IconSource } from "../kit/icons";
import { useCycle, useElapsed } from "./fxClock";
import { DEADLINE_FLASH, flashNumeralSize, sampleKeyframes } from "./fxModel";

interface BoxProps {
  layout?: Layout;
  children?: ReactNode;
  alpha?: number;
  zIndex?: number;
  label?: string;
}

/** Decoration over the board: never takes a touch, nor does anything inside it. */
export function Inert({ layout, children, alpha, zIndex, label }: BoxProps) {
  return (
    <layoutContainer layout={layout ?? {}} eventMode="none" interactiveChildren={false}
      alpha={alpha ?? 1} zIndex={zIndex ?? 0} label={label}>
      {children}
    </layoutContainer>
  );
}

/** Positions interactive children without being a target itself. */
export function Region({ layout, children, alpha, zIndex, label }: BoxProps) {
  return (
    <layoutContainer layout={layout ?? {}} eventMode="passive" alpha={alpha ?? 1} zIndex={zIndex ?? 0} label={label}>
      {children}
    </layoutContainer>
  );
}

/** Swallows a touch over its box and does nothing with it. */
export function Blocker({ layout, children, alpha, zIndex, label }: BoxProps) {
  return (
    <layoutContainer layout={layout ?? {}} eventMode="static" alpha={alpha ?? 1} zIndex={zIndex ?? 0} label={label}>
      {children}
    </layoutContainer>
  );
}

/**
 * The big countdown numeral, flashed once over the board (DeadlineFrame's
 * milestones, BoardAlert's last ten): the index.css `deadline-flash`. Key it
 * on the number so each new one replays rather than queueing.
 */
export function FlashNumeral({ value, color, width, height, duration = DEADLINE_FLASH.duration }: {
  value: number;
  color: number;
  /** The box it is centred in. */
  width: number;
  height: number;
  duration?: number;
}) {
  const screen = useUiScreen();
  const reduceMotion = useReducedMotion();
  const t = useElapsed(duration);
  const k = sampleKeyframes(reduceMotion ? DEADLINE_FLASH.still : DEADLINE_FLASH.frames, t / duration);
  return (
    <Inert layout={{ position: "absolute", left: 0, top: 0, width, height, justifyContent: "center", alignItems: "center" }}>
      <layoutContainer layout={{}} alpha={k.alpha} scale={k.scale}>
        <Label text={String(value)} size={flashNumeralSize(screen.width)} font="display" weight="900" color={color} glow={20} />
      </layoutContainer>
    </Inert>
  );
}

/**
 * A coloured edge round a box with a glow inside and out: the DOM's
 * `border: Npx solid c; box-shadow: inset 0 0 <in> c<a>, 0 0 <out> c<a>`.
 */
export function GlowFrame({ width, height, color, border, inner, outer }: {
  width: number;
  height: number;
  color: number;
  /** Edge thickness in px. */
  border: number;
  /** Inside glow: blur px and alpha. */
  inner?: { blur: number; alpha: number };
  /** Outside glow: blur px and alpha. */
  outer?: { blur: number; alpha: number };
}) {
  const ib = inner?.blur ?? 0, ia = inner?.alpha ?? 0;
  const ob = outer?.blur ?? 0, oa = outer?.alpha ?? 0;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (width <= 0 || height <= 0) return;
    if (oa > 0) outerGlow(g, 0, 0, width, height, color, oa, ob);
    if (ia > 0) insetGlow(g, width, height, color, ia, ib);
    g.rect(border / 2, border / 2, width - border, height - border).stroke({ width: border, color });
  }, [width, height, color, border, ib, ia, ob, oa]);
  return <pixiGraphics draw={draw} />;
}

/** An icon turning once a second: Tailwind's `animate-spin`. */
export function SpinningIcon({ icon, size, color }: { icon: IconSource; size: number; color: number }) {
  const turn = useCycle(1000);
  return (
    // Turned about its centre: @pixi/layout's transform origin defaults to 50%.
    <layoutContainer layout={{ width: size, height: size, flexShrink: 0 }} rotation={turn * Math.PI * 2}>
      <Icon icon={icon} size={size} color={color} />
    </layoutContainer>
  );
}
