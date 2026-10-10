import { useCallback, useEffect, useRef, useState } from "react";
import type { FederatedPointerEvent } from "pixi.js";

/** How long a press must last to count as a hold: the game's explainer gesture (CLAUDE.md). */
export const HOLD_MS = 450;
/** How far a finger may wander before a press stops being a tap or a hold. */
export const PRESS_SLOP_PX = 10;

export interface PressHandlers {
  onTap?: () => void;
  onHold?: () => void;
  disabled?: boolean;
}

/**
 * Tap and tap-and-hold on one element, the way every DOM element in the game
 * wired them by hand: a hold fires at HOLD_MS and swallows the tap that would
 * follow; moving more than a few pixels cancels both, so a scroll that starts
 * on a card does not press it.
 */
export function usePress({ onTap, onHold, disabled }: PressHandlers) {
  const [pressed, setPressed] = useState(false);
  const state = useRef<{ x: number; y: number; timer: number | null; held: boolean; live: boolean }>(
    { x: 0, y: 0, timer: null, held: false, live: false });
  const handlers = useRef({ onTap, onHold });
  handlers.current = { onTap, onHold };

  const cancel = useCallback(() => {
    const s = state.current;
    if (s.timer !== null) window.clearTimeout(s.timer);
    s.timer = null;
    s.live = false;
    setPressed(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback((e: FederatedPointerEvent) => {
    if (disabled) return;
    const s = state.current;
    s.x = e.global.x; s.y = e.global.y; s.held = false; s.live = true;
    setPressed(true);
    if (handlers.current.onHold) {
      s.timer = window.setTimeout(() => {
        s.timer = null;
        if (!s.live) return;
        s.held = true;
        setPressed(false);
        handlers.current.onHold?.();
      }, HOLD_MS);
    }
  }, [disabled]);

  const onGlobalPointerMove = useCallback((e: FederatedPointerEvent) => {
    const s = state.current;
    if (!s.live) return;
    if (Math.hypot(e.global.x - s.x, e.global.y - s.y) > PRESS_SLOP_PX) cancel();
  }, [cancel]);

  const onPointerUp = useCallback(() => {
    const s = state.current;
    const fire = s.live && !s.held;
    cancel();
    if (fire && !disabled) handlers.current.onTap?.();
  }, [cancel, disabled]);

  return {
    pressed,
    props: {
      // Still a touch target while disabled, like a disabled DOM button: it
      // swallows the tap rather than letting it through to what is under it
      // (the board would take it as the start of a fence).
      eventMode: "static" as const,
      cursor: disabled ? "default" : "pointer",
      onPointerDown,
      onPointerUp,
      onPointerUpOutside: cancel,
      onGlobalPointerMove,
      onPointerCancel: cancel,
    },
  };
}

