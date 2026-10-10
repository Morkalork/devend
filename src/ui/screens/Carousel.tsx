/**
 * Carousel - a horizontal strip of cards, one read at a time (canvas port of
 * components/game/Carousel.tsx).
 *
 * WHY THIS EXISTS: every tester said "too much text". Not because any one
 * card said too much, but because five cards said their piece at once, in the
 * smallest type in the game. A grid has to shrink each card until N fit across
 * a phone; a strip lets one card take most of the screen and set its
 * description at a size people actually read.
 *
 * WHAT IT COSTS: a shop is a comparison problem, and side by side is easier.
 * Three things pay that back:
 *   PEEK   the neighbours are visibly half on screen, so the strip reads as a
 *          strip rather than as the only card.
 *   PIPS   one per item, each showing whether that item is already picked:
 *          the "what have I chosen" readout the grid gave for free. That is
 *          why they take a `marks` array, not just the position.
 *   WIDTH  sized from the screen, so a phone shows one card and a desktop a few.
 *
 * The DOM rode CSS scroll-snap; the canvas has no scroller, so the strip is an
 * index that a drag moves (carouselModel.ts holds the arithmetic). A
 * horizontal drag follows the finger and, on release, settles on the nearest
 * card or steps one past a flick. The arrow keys step it too.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FederatedPointerEvent } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { animate } from "motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { COLOR, Icon, Pressable, RADIUS, View, tint, useUiScreen } from "../kit/ui";
import {
  CAROUSEL_GAP, DEFAULT_CARD_WIDTH, canStep, clampIndex, parseCardWidth, pipsFor, releaseIndex, stripOffset,
} from "./carouselModel";

interface CarouselProps {
  /** One node per item. Each is wrapped in a slot of the card width; give the item `flex: 1` to fill its height. */
  items: ReactNode[];
  /**
   * Per-item "already chosen" flags, rendered into the pips.
   *
   * The point of the pips is not position, it is inventory: which of these have
   * I picked. Losing that was the main thing a strip took away from the grid.
   */
  marks?: boolean[];
  /** Accessible name for the strip. */
  label: string;
  prevLabel: string;
  nextLabel: string;
  /** "Offer {{index}} of {{total}}", for the pip buttons' accessible names. */
  positionLabel: (index: number, total: number) => string;
  /** Card width (`Npx`, `Nvw` or `min(a, b)`), relative to the screen so a phone shows one and a desktop a few. */
  cardWidth?: string;
  /** Kept for prop parity with the DOM component; there are no CSS classes on the canvas. */
  className?: string;
}

/** The DOM strip was `w-full max-w-4xl`. */
const MAX_STRIP_WIDTH = 896;
/** Finger travel before a press on the strip is treated as a drag (the kit's press slop). */
const DRAG_START_PX = 10;
/** The arrows were `hidden sm:flex`: the swipe is the gesture on a phone. */
const ARROWS_MIN_SCREEN = 640;

export function Carousel({
  items,
  marks = [],
  label,
  prevLabel,
  nextLabel,
  positionLabel,
  cardWidth = DEFAULT_CARD_WIDTH,
}: CarouselProps) {
  const screen = useUiScreen();
  const viewW = Math.min(screen.width, MAX_STRIP_WIDTH);
  const cardW = parseCardWidth(cardWidth, screen.width);
  const count = items.length;
  const [activeRaw, setActive] = useState(0);
  // The item count changes when the shop restocks; never describe a card that is gone.
  const active = clampIndex(activeRaw, count);

  const rowRef = useRef<LayoutContainer | null>(null);
  // The strip's current translation, so an animation starts from wherever a drag left it.
  const pos = useRef(stripOffset(0, cardW, viewW));
  const drag = useRef<{ x: number; y: number; live: boolean; horizontal: boolean; from: number } | null>(null);

  const place = useCallback((x: number) => {
    pos.current = x;
    const row = rowRef.current;
    // pivot moves the drawn strip without a Yoga relayout per frame.
    if (row && !row.destroyed) row.pivot.x = -x;
  }, []);

  // Settle on the active card whenever it (or the geometry) changes.
  useEffect(() => {
    const target = stripOffset(active, cardW, viewW);
    // Already there (first mount): place it outright, an animation from x to x may never update.
    if (Math.abs(pos.current - target) < 0.5) { place(target); return; }
    const controls = animate(pos.current, target, { duration: 0.3, ease: "easeOut", onUpdate: place });
    return () => controls.stop();
  }, [active, cardW, viewW, place]);

  const step = useCallback((delta: -1 | 1) => {
    setActive(a => clampIndex(clampIndex(a, count) + delta, count));
  }, [count]);

  // The DOM strip was focusable and stepped on the arrow keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // ── Swipe ──
  // The press lands on a card first and bubbles here. Once the finger has
  // moved more than the press slop the card has already let go of its tap, so
  // the strip can take the gesture. A mostly vertical drag is left to the page.
  const onPointerDown = useCallback((e: FederatedPointerEvent) => {
    drag.current = { x: e.global.x, y: e.global.y, live: true, horizontal: false, from: pos.current };
  }, []);
  const onGlobalPointerMove = useCallback((e: FederatedPointerEvent) => {
    const d = drag.current;
    if (!d || !d.live) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (!d.horizontal) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      if (Math.abs(dy) > Math.abs(dx)) { d.live = false; return; }
      d.horizontal = true;
    }
    place(d.from + dx);
  }, [place]);
  const endDrag = useCallback((e?: FederatedPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.horizontal) return;
    const dx = e ? e.global.x - d.x : 0;
    const next = releaseIndex(active, dx, cardW, count);
    if (next !== active) setActive(next);
    else {
      // Same card: spring back to it.
      animate(pos.current, stripOffset(active, cardW, viewW), { duration: 0.25, ease: "easeOut", onUpdate: place });
    }
  }, [active, cardW, viewW, count, place]);

  const pips = useMemo(() => pipsFor(count, active, marks), [count, active, marks]);
  const showArrows = screen.width >= ARROWS_MIN_SCREEN;

  const arrow = (delta: -1 | 1) => (
    <Pressable
      label={delta < 0 ? prevLabel : nextLabel}
      onTap={() => step(delta)}
      disabled={!canStep(active, count, delta)}
      layout={{
        position: "absolute", top: "50%", marginTop: -18, ...(delta < 0 ? { left: 0 } : { right: 0 }),
        width: 36, height: 36, borderRadius: RADIUS.full, alignItems: "center", justifyContent: "center",
        borderWidth: 1, borderColor: tint(COLOR.white, 0.15), backgroundColor: tint(COLOR.black, 0.4),
      }}
      alpha={canStep(active, count, delta) ? 1 : 0.2 / 0.45}
    >
      <Icon icon={delta < 0 ? ChevronLeft : ChevronRight} size={20} color={COLOR.foreground} alpha={0.7} />
    </Pressable>
  );

  return (
    <View layout={{ width: viewW, alignItems: "center", gap: 12 }}>
      <View layout={{ width: viewW }}>
        <layoutContainer
          label={label}
          layout={{ width: viewW, overflow: "hidden" }}
          eventMode="static"
          onPointerDown={onPointerDown}
          onGlobalPointerMove={onGlobalPointerMove}
          onPointerUp={endDrag}
          onPointerUpOutside={endDrag}
          onPointerCancel={() => endDrag()}
        >
          <layoutContainer ref={rowRef} layout={{ flexDirection: "row", gap: CAROUSEL_GAP, alignItems: "stretch", alignSelf: "flex-start" }}>
            {items.map((item, i) => (
              <View key={i} layout={{ width: cardW, flexDirection: "column" }}>
                {item}
              </View>
            ))}
          </layoutContainer>
        </layoutContainer>
        {/* Arrows sit over the strip's edges, only on wide screens. */}
        {showArrows && arrow(-1)}
        {showArrows && arrow(1)}
      </View>

      {/* Pips: position AND inventory. A green pip means that offer is
          already picked, the one thing the old grid told you for free. */}
      {pips.length > 0 && (
        <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {pips.map((pip, i) => (
            <Pressable
              key={i}
              label={positionLabel(i + 1, count)}
              onTap={() => setActive(i)}
              layout={{ padding: 4, margin: -4 }}
            >
              <View layout={{
                width: pip.active ? 20 : 8, height: 8, borderRadius: RADIUS.full,
                backgroundColor: pip.picked ? 0x4ade80 : tint(COLOR.foreground, pip.active ? 0.8 : 0.25),
              }} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
