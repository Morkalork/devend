/**
 * Does the player ask for less motion? The OS / browser setting
 * (`prefers-reduced-motion: reduce`), followed live.
 *
 * The canvas interface's own copy of framer-motion's hook of the same name, so
 * nothing the game draws depends on framer-motion (CANVAS_UI_PLAN.md: it stays
 * for Admin only).
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The setting right now; false where there is no matchMedia (tests, SSR). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduce(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
}
