/**
 * PanView: a box whose content is dragged about in two axes, for a thing
 * bigger than the screen in both directions (the ball tree). The ScrollView
 * next door is one axis with a fling; this is two axes with none, because a
 * map is placed, not thrown.
 *
 * Same plumbing as the ScrollView: Yoga lays the content out at its own size
 * under `overflow: "scroll"`, the library's own scroller is unhooked, and the
 * content container is moved by hand. A drag claims the pointer once it has
 * moved past a small slop in ANY direction, so the ScrollView around it does
 * not scroll the page and a Pressable under the finger does not fire; a tap
 * that never moves is left to the node it landed on.
 */
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Ticker, type FederatedPointerEvent } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import type { Layout } from "./core";
import { beginPointer, claimPointer, claimedByOther, releasePointer } from "./gesture";

const LIBRARY_SCROLL_EVENTS = ["pointerdown", "pointerup", "pointerupoutside", "pointermove", "pointercancel", "wheel"] as const;
/** Movement before a press becomes a pan, in CSS px. Under the ScrollView's, so the pan wins a diagonal. */
const PAN_SLOP_PX = 6;

export interface PanViewProps {
  layout: Layout & { width: number; height: number };
  /** The content's size; the pan is clamped so it never leaves the box empty. */
  contentWidth: number;
  contentHeight: number;
  /** Where the content starts, in content px at the box's top-left. */
  initialX?: number;
  initialY?: number;
  children?: ReactNode;
}

interface PanDrag {
  pointerId: number;
  startX: number;
  startY: number;
  fromX: number;
  fromY: number;
  claimed: boolean;
}

export function PanView({ layout, contentWidth, contentHeight, initialX = 0, initialY = 0, children }: PanViewProps) {
  const boxRef = useRef<LayoutContainer | null>(null);
  const owner = useRef(Symbol("PanView"));
  const drag = useRef<PanDrag | null>(null);
  const pos = useRef({ x: -initialX, y: -initialY });

  const clamp = useCallback((x: number, y: number) => {
    const minX = Math.min(0, layout.width - contentWidth);
    const minY = Math.min(0, layout.height - contentHeight);
    return { x: Math.max(minX, Math.min(0, x)), y: Math.max(minY, Math.min(0, y)) };
  }, [layout.width, layout.height, contentWidth, contentHeight]);

  const place = useCallback((x: number, y: number) => {
    const c = clamp(x, y);
    pos.current = c;
    const box = boxRef.current;
    if (!box || box.destroyed) {
      return;
    }
    box.overflowContainer.x = c.x;
    box.overflowContainer.y = c.y;
  }, [clamp]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const libraryStep = (box as unknown as { update: () => void }).update;
    Ticker.shared.remove(libraryStep, box);
    for (const type of LIBRARY_SCROLL_EVENTS) {
      box.removeAllListeners(type);
    }
    place(pos.current.x, pos.current.y);
  }, [place]);

  const onPointerDown = useCallback((e: FederatedPointerEvent) => {
    beginPointer(e.pointerId, e.nativeEvent);
    drag.current = {
      pointerId: e.pointerId, startX: e.global.x, startY: e.global.y,
      fromX: pos.current.x, fromY: pos.current.y, claimed: false,
    };
  }, []);

  const onGlobalPointerMove = useCallback((e: FederatedPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) {
      return;
    }
    const dx = e.global.x - d.startX;
    const dy = e.global.y - d.startY;
    if (!d.claimed) {
      if (claimedByOther(e.pointerId, owner.current)) {
        drag.current = null;
        return;
      }
      if (Math.hypot(dx, dy) < PAN_SLOP_PX) {
        return;
      }
      if (!claimPointer(e.pointerId, owner.current)) {
        drag.current = null;
        return;
      }
      d.claimed = true;
      d.fromX = pos.current.x - dx;
      d.fromY = pos.current.y - dy;
    }
    place(d.fromX + dx, d.fromY + dy);
  }, [place]);

  const endDrag = useCallback((e: FederatedPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) {
      return;
    }
    drag.current = null;
    if (d.claimed) {
      releasePointer(e.pointerId, owner.current);
    }
  }, []);

  return (
    <layoutContainer
      ref={boxRef}
      layout={{ overflow: "scroll", flexDirection: "column", ...layout }}
      eventMode="static"
      onPointerDown={onPointerDown}
      onGlobalPointerMove={onGlobalPointerMove}
      onPointerUp={endDrag}
      onPointerUpOutside={endDrag}
      onPointerCancel={endDrag}
    >
      {children}
    </layoutContainer>
  );
}
