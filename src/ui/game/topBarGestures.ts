/**
 * The top bar's two free shortcuts to the Specs panel: tap either row, or
 * swipe down on it. They take no room at all, which is why they survived the
 * Specs button moving to the control row.
 *
 * A goal chip inside a row has its own tap ("How to win"), and a chip that
 * opened two things at once would be worse than one that opened nothing. The
 * DOM chip stopped its pointerdown reaching the row; here it CLAIMS the press
 * instead, so the row still sees it for a swipe but never reads it as a tap.
 */
import { useCallback, useRef } from "react";
import type { FederatedPointerEvent } from "pixi.js";
import { PRESS_SLOP_PX } from "../kit/press";

/** How far down a drag must end to count as "pull the panel down". */
export const SWIPE_EXPAND_PX = 30;

export interface SwipeState {
  live: boolean;
  y: number;
  x: number;
  /** Moved past the tap slop: a drag (scroll, swipe), never a tap. */
  moved: boolean;
  /** The press began on something with its own tap (a goal chip). */
  claimed: boolean;
}

export const IDLE: SwipeState = { live: false, x: 0, y: 0, moved: false, claimed: false };

export function swipeDown(x: number, y: number, claimed: boolean): SwipeState {
  return { live: true, x, y, moved: false, claimed };
}

export function swipeMove(s: SwipeState, x: number, y: number): SwipeState {
  if (!s.live || s.moved) return s;
  return Math.hypot(x - s.x, y - s.y) > PRESS_SLOP_PX ? { ...s, moved: true } : s;
}

/**
 * What a release means. `inside` is false for a release off the bar (a swipe
 * usually ends over the board), which can still be a swipe but never a tap.
 */
export function swipeUp(s: SwipeState, y: number, inside: boolean): "expand" | null {
  if (!s.live) return null;
  if (y - s.y > SWIPE_EXPAND_PX) return "expand";
  if (inside && !s.moved && !s.claimed) return "expand";
  return null;
}

// The native event behind the press a chip claimed. Pixi pools its federated
// events, so the identity of the browser's own event is what is unique.
let claimedNative: unknown = null;

/** Called by a chip on pointerdown: this press is mine, not the row's. */
export function claimTap(e: FederatedPointerEvent): void {
  claimedNative = e.nativeEvent;
}

/** Pointer props for the container holding both rows. */
export function useTapOrSwipeDown(onExpand: (() => void) | undefined) {
  const state = useRef<SwipeState>(IDLE);
  const expand = useRef(onExpand);
  expand.current = onExpand;

  const onPointerDown = useCallback((e: FederatedPointerEvent) => {
    const claimed = claimedNative === e.nativeEvent;
    claimedNative = null;
    state.current = swipeDown(e.global.x, e.global.y, claimed);
  }, []);
  const onGlobalPointerMove = useCallback((e: FederatedPointerEvent) => {
    // A mouse moves with no button held; that is not a drag of anything.
    if (e.buttons === 0 && e.pointerType === "mouse") { state.current = IDLE; return; }
    state.current = swipeMove(state.current, e.global.x, e.global.y);
  }, []);
  const release = useCallback((e: FederatedPointerEvent, inside: boolean) => {
    const verdict = swipeUp(state.current, e.global.y, inside);
    state.current = IDLE;
    if (verdict === "expand") expand.current?.();
  }, []);
  const onPointerUp = useCallback((e: FederatedPointerEvent) => release(e, true), [release]);
  const onPointerUpOutside = useCallback((e: FederatedPointerEvent) => release(e, false), [release]);
  const onPointerCancel = useCallback(() => { state.current = IDLE; }, []);

  return {
    eventMode: onExpand ? ("static" as const) : ("passive" as const),
    cursor: onExpand ? "pointer" : "default",
    onPointerDown,
    onPointerUp,
    onPointerUpOutside,
    onPointerCancel,
    onGlobalPointerMove,
  };
}
