/**
 * The ticket filling in: "it is important that the card content is filled in
 * one by one, even if quickly". The card opens with every row an empty box,
 * as it was before the map, then each row takes its mark in reading order.
 *
 * Pure timing (fillCount) plus the hook that drives it, so the schedule can be
 * checked without a canvas.
 */
import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "../reducedMotion";

/** The card's own entrance, before the first mark. */
export const FILL_START_MS = 380;
/** Between one mark and the next: quick, but one at a time. */
export const FILL_STEP_MS = 230;

/** How many rows are marked `elapsed` ms after the card opened. */
export function fillCount(elapsed: number, rows: number, startMs = FILL_START_MS, stepMs = FILL_STEP_MS): number {
  if (elapsed < startMs) return 0;
  return Math.min(rows, 1 + Math.floor((elapsed - startMs) / stepMs));
}

/** When the last row is marked, ms after the card opened. */
export function fillDoneMs(rows: number, startMs = FILL_START_MS, stepMs = FILL_STEP_MS): number {
  return rows <= 0 ? 0 : startMs + (rows - 1) * stepMs;
}

/**
 * The rows marked so far, and a way to finish at once (a tap on the card).
 * Reduced motion marks them all at once.
 */
export function useFillIn(rows: number): { filled: number; done: boolean; finish: () => void } {
  const reduce = useReducedMotion();
  const [filled, setFilled] = useState(() => (reduce ? rows : 0));
  useEffect(() => {
    if (reduce) { setFilled(rows); return; }
    const opened = performance.now();
    let id = 0;
    const tick = () => {
      const n = fillCount(performance.now() - opened, rows);
      setFilled(prev => Math.max(prev, n));
      if (n < rows) id = window.setTimeout(tick, 40);
    };
    id = window.setTimeout(tick, 40);
    return () => window.clearTimeout(id);
  }, [rows, reduce]);
  const finish = useCallback(() => setFilled(rows), [rows]);
  return { filled, done: filled >= rows, finish };
}
