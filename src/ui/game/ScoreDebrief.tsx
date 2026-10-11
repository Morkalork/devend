/**
 * ScoreDebrief - what scored, boxed on the board, as the map ends
 * (lib/scoreDebrief.ts builds it; scoreDebriefModel.ts places and times it).
 *
 * Once the lock flashes settle, each thing that earned overtime gets corner
 * brackets that slam in and blink as they lock on, a leader, and a tag plate
 * that types out what it paid and why; one box after the next. What paid
 * without a place on the board (the clock, the win, an objective) is listed in
 * a small panel in the corner. It fades as the board shatters into the results
 * card, or stays up while the Playground holds the board.
 *
 * Inert: it covers the board but takes no touch (the map is over).
 */
import { useCallback, useMemo } from "react";
import type { Graphics } from "pixi.js";
import { useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { DebriefText, ScoreDebrief as Debrief } from "@/types/debrief";
import { DEBRIEF_STAGGER_MS } from "@/lib/scoreDebrief";
import { COLOR, hex } from "../theme";
import { Label } from "../kit/ui";
import { Inert } from "./boardParts";
import { useElapsed } from "./fxClock";
import {
  FADE_MS, hoursText, itemFrame, notesRect, overlayAlpha, placeDebrief, tagWidth, typedText,
  type DebriefCanvas, type Rect,
} from "./scoreDebriefModel";

interface ScoreDebriefProps extends DebriefCanvas {
  debrief: Debrief;
  /** ms before the first box: the lock flashes still playing. */
  delayMs: number;
  /** The Playground's freeze: stay up instead of fading. */
  hold?: boolean;
  accentColor: string;
  /** GameCanvas's container's top-left on screen, CSS px. */
  origin: { x: number; y: number };
  /** The arena inside the board's frame, relative to the container; tags stay inside it. */
  bounds: Rect;
}

const PLATE = 0x040a08;

export function ScoreDebrief({ debrief, delayMs, hold = false, accentColor, origin, bounds, ...canvas }: ScoreDebriefProps) {
  const { t } = useTranslation();
  const reduceMotion = !!useReducedMotion();
  const { items, notes, durationMs } = debrief;
  const total = (delayMs + durationMs + FADE_MS) / 1000;
  const elapsed = useElapsed(hold ? Infinity : total, true, debrief);
  const now = elapsed * 1000 - delayMs;

  const noteBox = notesRect(bounds, notes.length);
  const placed = useMemo(
    () => placeDebrief(items, canvas, bounds, noteBox),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, canvas.canvasWidth, canvas.canvasHeight, canvas.canvasOffsetLeft, canvas.canvasOffsetTop, bounds.x, bounds.y, bounds.w, bounds.h, noteBox?.h],
  );
  const accent = hex(accentColor);
  const colors = useMemo(() => items.map(i => (i.color ? hex(i.color) : accent)), [items, accent]);
  const frames = items.map((_, i) => itemFrame(now, i, DEBRIEF_STAGGER_MS, reduceMotion));
  const noteFrame = itemFrame(now, items.length, DEBRIEF_STAGGER_MS, reduceMotion);
  const text = (d: DebriefText) => t(d.key, d.values ?? {});

  const draw = useCallback((g: Graphics) => {
    g.clear();
    placed.forEach((p, i) => {
      const f = frames[i];
      if (f.alpha <= 0) return;
      const color = colors[i];
      const { box, tag, leader } = p;
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const w = box.w * f.scale, h = box.h * f.scale, x = cx - w / 2, y = cy - h / 2;
      const len = Math.max(6, Math.min(18, Math.min(w, h) * 0.28));
      // A faint wash, then the brackets.
      g.rect(x, y, w, h).fill({ color, alpha: 0.07 * f.alpha });
      for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
        g.moveTo(px + sx * len, py).lineTo(px, py).lineTo(px, py + sy * len);
      }
      g.stroke({ width: 2, color, alpha: f.alpha, cap: "square", join: "miter" });
      if (f.typed <= 0) return;
      // The leader and the plate.
      g.moveTo(leader[0].x, leader[0].y).lineTo(leader[1].x, leader[1].y)
        .stroke({ width: 1, color, alpha: 0.8 * f.alpha });
      g.rect(tag.x, tag.y, tag.w, tag.h).fill({ color: PLATE, alpha: 0.86 * f.alpha })
        .stroke({ width: 1, color, alpha: 0.9 * f.alpha, alignment: 1 });
      g.rect(tag.x, tag.y, 3, tag.h).fill({ color, alpha: f.alpha });
    });
    if (noteBox && noteFrame.alpha > 0) {
      g.rect(noteBox.x, noteBox.y, noteBox.w, noteBox.h).fill({ color: PLATE, alpha: 0.86 * noteFrame.alpha })
        .stroke({ width: 1, color: accent, alpha: 0.9 * noteFrame.alpha, alignment: 1 });
      g.rect(noteBox.x, noteBox.y, 3, noteBox.h).fill({ color: accent, alpha: noteFrame.alpha });
    }
  }, [placed, frames, colors, noteBox, noteFrame.alpha, accent]);

  const alpha = overlayAlpha(now, durationMs, hold);
  if (alpha <= 0) return null;
  const tw = tagWidth(bounds);

  return (
    <Inert label="score-debrief" alpha={alpha}
      layout={{ position: "absolute", left: origin.x, top: origin.y, width: bounds.x + bounds.w, height: bounds.y + bounds.h }}>
      <pixiGraphics draw={draw} />
      {placed.map((p, i) => {
        const f = frames[i];
        if (f.typed <= 0) return null;
        const item = items[i];
        const color = colors[i];
        return (
          <Inert key={i} alpha={f.alpha} layout={{
            position: "absolute", left: p.tag.x + 8, top: p.tag.y + 4, width: tw - 13, height: p.tag.h - 8,
            flexDirection: "column", justifyContent: "space-between",
          }}>
            <Inert layout={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              {/* Cut rather than overrun the figure, should a title outgrow the plate. */}
              <Label text={typedText(text(item.title), f.typed)} size={9} lineHeight={14} font="display" weight="700"
                upper letterSpacing={0.8} color={color} truncate layout={{ flex: 1 }} />
              {item.hours != null && (
                <Label text={typedText(hoursText(item.hours), f.typed)} size={12} lineHeight={14} font="mono" weight="700" color={COLOR.white} glow={6} />
              )}
            </Inert>
            <Label text={typedText(text(item.detail), f.typed)} size={10} lineHeight={13} font="mono" color={COLOR.white} alpha={0.72} truncate />
          </Inert>
        );
      })}
      {noteBox && noteFrame.typed > 0 && (
        <Inert alpha={noteFrame.alpha} layout={{
          position: "absolute", left: noteBox.x + 8, top: noteBox.y + 5, width: noteBox.w - 14,
          flexDirection: "column", gap: 2,
        }}>
          <Label text={typedText(t("debrief.notes"), noteFrame.typed)} size={9} lineHeight={13} font="display" weight="700"
            upper letterSpacing={1.2} color={accent} />
          {notes.map((n, i) => (
            <Inert key={i} layout={{ flexDirection: "row", justifyContent: "space-between", height: 14, gap: 6 }}>
              <Label text={typedText(text(n.title), noteFrame.typed)} size={10} lineHeight={14} font="mono" color={COLOR.white} alpha={0.8} />
              <Label text={typedText(hoursText(n.hours), noteFrame.typed)} size={11} lineHeight={14} font="mono" weight="700" color={COLOR.white} />
            </Inert>
          ))}
        </Inert>
      )}
    </Inert>
  );
}
