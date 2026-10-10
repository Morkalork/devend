/**
 * Where a DOM element sits on screen, for the canvas pieces drawn over it.
 *
 * The interface canvas covers the window, so anything it draws in step with a
 * DOM element (the board, the play pane) is placed from that element's box.
 */
import { createContext, useEffect, useState, type RefObject } from "react";

/** A box on screen, in CSS px. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function windowBox(): ScreenBox {
  if (typeof window === "undefined") return { x: 0, y: 0, width: 390, height: 844 };
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

export function sameBox(a: ScreenBox, b: ScreenBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Fired on window when the screen transition (Index's slide) comes to rest,
 * which moves every element on the screen without resizing anything.
 */
export const SCREEN_SETTLED_EVENT = "devend:screen-settled";

/** How long a fresh mount keeps sampling its box, waiting for it to settle. */
const SETTLE_MAX_MS = 3000;
/** Frames in a row the box must hold still to count as settled. */
const SETTLE_FRAMES = 12;

/**
 * The element's box, following window resizes and the element's own. A
 * transform (the screen transition's slide) moves an element without either,
 * so it is re-read when Index says the slide has come to rest, and sampled
 * every frame after mounting until it holds still, for whatever moves it that
 * is not the slide.
 */
export function useScreenBox(ref: RefObject<HTMLElement | null>): ScreenBox {
  const [box, setBox] = useState<ScreenBox>(windowBox);
  useEffect(() => {
    const read = (): ScreenBox | null => {
      const el = ref.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const next = { x: r.left, y: r.top, width: r.width, height: r.height };
      setBox(prev => (sameBox(prev, next) ? prev : next));
      return next;
    };
    const onResize = () => { read(); };
    let last = read();
    let still = 0;
    let raf = 0;
    const started = performance.now();
    const settle = () => {
      const next = read();
      still = next && last && sameBox(next, last) ? still + 1 : 0;
      last = next;
      if (still < SETTLE_FRAMES && performance.now() - started < SETTLE_MAX_MS) raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);
    window.addEventListener("resize", onResize);
    window.addEventListener(SCREEN_SETTLED_EVENT, onResize);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (observer && ref.current) observer.observe(ref.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener(SCREEN_SETTLED_EVENT, onResize);
      observer?.disconnect();
    };
  }, [ref]);
  return box;
}

/**
 * The play pane's box, provided by GameScreen on the DOM side so GameCanvas can
 * frame its full-screen prompts the same way (null: the whole window).
 */
export const PlayFrameContext = createContext<ScreenBox | null>(null);
