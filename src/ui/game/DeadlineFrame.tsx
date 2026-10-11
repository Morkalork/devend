/**
 * DeadlineFrame - the map clock, drawn as the board's own frame (canvas port
 * of components/game/DeadlineFrame.tsx).
 *
 * A timed map's countdown lived in a thin bar below the fence slots, where it
 * was easy to miss. The player's eyes are on the board, so the clock goes
 * there: a band traced round the board's frame that sweeps back towards twelve
 * o'clock as time runs out, shading green to amber to red. At the milestone
 * seconds (DEADLINE_MILESTONES) the number flashes once over the board, the
 * same numeral BoardAlert uses for the last ten seconds, so the run-up to that
 * alarm is not silent.
 *
 * Positioned from the frame GameCanvas already computes for the board (see
 * BoardPlaceholder), so it sits exactly on the drawn frame band. Inert: it
 * never takes a tap.
 */
import { useCallback } from "react";
import type { Graphics } from "pixi.js";
import { useReducedMotion } from "framer-motion";
import type { BoardFrameCss } from "@/components/game/BoardPlaceholder";
import { useTween } from "../kit/ui";
import { FlashNumeral, Inert } from "./boardParts";
import { clockRectPoints, deadlineGeometry } from "./overlayModel";
import { cssHex } from "./fxModel";
import { deadlineColor } from "@/lib/deadlineDisplay";

interface DeadlineFrameProps {
  /** Where the board is drawn; null until the canvas has been sized. */
  frame: BoardFrameCss | null;
  /** Whole seconds left on the clock; null hides the frame (no clock, or done). */
  secondsLeft: number | null;
  /** The map's time limit in seconds. */
  limit: number | null;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
}

export function DeadlineFrame({ frame, secondsLeft, limit, origin }: DeadlineFrameProps) {
  const reduceMotion = useReducedMotion();
  const geo = deadlineGeometry(frame, secondsLeft, limit);
  // Ticks arrive once a second; a one-second linear slide keeps the drain a
  // sweep (and the colour slides with it, since it is read from the slid share).
  const shown = useTween(geo?.remaining ?? 1, reduceMotion ? 0 : 1, "linear");
  const color = cssHex(deadlineColor(shown));

  const has = geo != null;
  const x = geo?.x ?? 0, y = geo?.y ?? 0, w = geo?.w ?? 0, h = geo?.h ?? 0, band = geo?.band ?? 0;

  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (!has) return;
    // The spent part of the clock, faint, so the drain reads as a loss rather
    // than as the frame getting shorter for no reason.
    g.rect(x, y, w, h).stroke({ width: band, color: 0xffffff, alpha: 0.1 });
    const pts = clockRectPoints(x, y, w, h, shown);
    if (pts.length < 2) return;
    const path = () => {
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    };
    // A soft halo under the band for the DOM's `drop-shadow(0 0 6px)`: three
    // widening faint strokes, stacked, so it fades outward instead of ending
    // in a hard-edged box.
    for (const spread of [12, 8, 4]) {
      path();
      g.stroke({ width: band + spread, color, alpha: 0.09, cap: "butt", join: "miter" });
    }
    path();
    g.stroke({ width: band, color, cap: "butt", join: "miter" });
  }, [has, x, y, w, h, band, shown, color]);

  if (!frame || !geo) return null;

  return (
    <Inert label="deadline-frame"
      layout={{ position: "absolute", left: origin.x + frame.left, top: origin.y + frame.top, width: frame.width, height: frame.height }}>
      <pixiGraphics draw={draw} />
      {/* Keyed on the milestone, so it plays once per milestone whatever the
          screen re-renders. */}
      {geo.milestone != null && (
        <FlashNumeral key={geo.milestone} value={geo.milestone} color={geo.color} width={frame.width} height={frame.height} />
      )}
    </Inert>
  );
}
