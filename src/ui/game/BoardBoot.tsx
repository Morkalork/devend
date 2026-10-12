/**
 * BoardBoot - how every map opens (boardBootModel.ts has the why).
 *
 * WAITING, for as long as the renderer takes (its chunk, its shaders, an
 * explainer card over it): the board's own frame and grid, opaque, exactly
 * where the board will be, with corner brackets breathing and the level
 * compiling under a caret. GameCanvas hands it the frame it is about to draw
 * (boardFrameCss), so the stand-in and the board cannot disagree.
 *
 * REVEAL, once `ready`: the frame is traced in light, a scan line sweeps down
 * and leaves the real board behind it, throwing sparks, and the frame flashes
 * as the map goes live. The first map of a run gets a longer cut with the grid
 * compiling cell by cell first. `onRevealed` fires at the end; until then
 * GameCanvas holds the map still.
 *
 * Inert throughout: it covers the board but never takes a touch (and nothing
 * can be cut while the map is held anyway).
 */
import { useCallback, useEffect, useRef } from "react";
import type { Graphics } from "pixi.js";
import { useReducedMotion } from "../reducedMotion";
import { useTranslation } from "react-i18next";
import { COLOR, hex } from "../theme";
import { Label, TEXT } from "../kit/ui";
import { Inert } from "./boardParts";
import { outerGlow } from "./boardDraw";
import { useCycle, useElapsed } from "./fxClock";
import { clockRectPoints, type BoardFrameCss } from "./overlayModel";
import { bootCells, bootFrame, bootGeometry, bootSparks, bootTimeline } from "./boardBootModel";

interface BoardBootProps {
  /** The board has presented and nothing covers it: start the reveal. */
  ready: boolean;
  /** The first map of a run: the longer cut. */
  runStart: boolean;
  accentColor: string;
  /** Where the board will be drawn; null until the canvas has been sized. */
  frame: BoardFrameCss | null;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
  levelNumber: number;
  /** The reveal has finished: the board is live. */
  onRevealed: () => void;
}

/** The stand-in floor: near-black with the faintest green, like the board's own. */
const FLOOR = 0x050d09;

export function BoardBoot({ ready, runStart, accentColor, frame, origin, levelNumber, onRevealed }: BoardBootProps) {
  const { t } = useTranslation();
  const reduceMotion = !!useReducedMotion();
  const tl = bootTimeline(runStart, reduceMotion);
  const revealing = ready && frame != null;
  const elapsed = useElapsed(tl.total, revealing);
  // The waiting loop: brackets breathe, the progress segment slides, the caret blinks.
  const loop = useCycle(1400, !revealing && !reduceMotion);
  const caret = useCycle(1000, !revealing);
  const caretOn = caret < 0.5;

  // Fire once, at the end of the reveal; at once if there is no frame to reveal.
  const fired = useRef(false);
  const revealed = useRef(onRevealed);
  revealed.current = onRevealed;
  const done = revealing && elapsed >= tl.total;
  useEffect(() => {
    if (fired.current) return;
    if (done || (ready && frame == null)) {
      fired.current = true;
      revealed.current();
    }
  }, [done, ready, frame]);

  const accent = hex(accentColor);
  const fw = frame?.width ?? 0, fh = frame?.height ?? 0, band = frame?.frame ?? 0;
  const f = bootFrame(revealing ? elapsed : 0, tl, fh);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (fw <= 0 || fh <= 0) return;
    const { inner, cell } = bootGeometry({ left: 0, top: 0, width: fw, height: fh, frame: band });
    const top = revealing ? f.coverTop : 0;

    // The cover: opaque from `top` down, so nothing of the board shows until the line passes.
    if (top < fh) {
      g.rect(0, top, fw, fh - top).fill({ color: FLOOR, alpha: f.coverAlpha });
      // The frame band, where the outer wall will stand.
      const bandAlpha = 0.28 * f.coverAlpha;
      g.rect(0, Math.max(top, 0), band, fh - Math.max(top, 0)).fill({ color: accent, alpha: bandAlpha });
      g.rect(fw - band, Math.max(top, 0), band, fh - Math.max(top, 0)).fill({ color: accent, alpha: bandAlpha });
      if (top < band) g.rect(band, top, fw - band * 2, band - top).fill({ color: accent, alpha: bandAlpha });
      g.rect(band, fh - band, fw - band * 2, band).fill({ color: accent, alpha: bandAlpha });
      // The grid, on the covered part of the arena only.
      const gy = Math.max(inner.y, top);
      const gh = inner.y + inner.height - gy;
      if (gh > 0) {
        for (let x = 0; x <= inner.width + 0.5; x += cell) g.rect(inner.x + x, gy, 1, gh);
        for (let y = 0; y <= inner.height + 0.5; y += cell) {
          if (inner.y + y >= gy) g.rect(inner.x, inner.y + y, inner.width, 1);
        }
        g.fill({ color: accent, alpha: 0.1 * f.coverAlpha });
      }
      // Run start: the grid compiling, cell by cell, before the sweep.
      if (f.cells > 0) {
        const cols = Math.round(inner.width / cell), rows = Math.round(inner.height / cell);
        for (const c of bootCells(elapsed, f.cells, cols, rows)) {
          const cy = inner.y + c.row * cell;
          if (cy + cell <= top) continue;
          g.rect(inner.x + c.col * cell + 1, Math.max(cy, top) + 1, cell - 1, cell - 1).fill({ color: accent, alpha: c.alpha * 0.35 });
        }
      }
    }

    // Waiting: corner brackets breathing in, and an indeterminate progress segment.
    const bracketAlpha = revealing ? Math.max(0, 1 - f.trace * 1.5) : 0.55 + 0.45 * Math.sin(loop * Math.PI * 2) ** 2;
    if (bracketAlpha > 0) {
      const len = Math.min(fw, fh) * 0.12, w = Math.max(2, band * 0.6), inset = -w / 2;
      const corners: [number, number, number, number][] = [[inset, inset, 1, 1], [fw - inset, inset, -1, 1], [inset, fh - inset, 1, -1], [fw - inset, fh - inset, -1, -1]];
      for (const [x, y, sx, sy] of corners) {
        g.moveTo(x + sx * len, y).lineTo(x, y).lineTo(x, y + sy * len);
      }
      g.stroke({ width: w, color: accent, alpha: bracketAlpha, cap: "square", join: "miter" });
    }
    if (!revealing && !reduceMotion) {
      const bw = inner.width * 0.36, bx = inner.x + (inner.width - bw) / 2, by = inner.y + inner.height / 2 + 34;
      g.rect(bx, by, bw, 2).fill({ color: accent, alpha: 0.15 });
      const seg = bw * 0.3, sx = bx - seg + (bw + seg) * loop;
      const x0 = Math.max(bx, sx), x1 = Math.min(bx + bw, sx + seg);
      if (x1 > x0) g.rect(x0, by - 0.5, x1 - x0, 3).fill({ color: accent, alpha: 0.9 });
    }

    if (!revealing) return;

    // The frame, traced in light from the top middle, clockwise.
    if (f.trace > 0 && f.trace < 1.001) {
      const pts = clockRectPoints(band / 2, band / 2, fw - band, fh - band, f.trace);
      const traceAlpha = 1 - f.flash * 0.3;
      g.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: band * 1.6, color: accent, alpha: 0.18 * traceAlpha, cap: "round", join: "miter" });
      g.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: Math.max(2, band * 0.55), color: accent, alpha: 0.95 * traceAlpha, cap: "round", join: "miter" });
      if (f.trace < 1) {
        const head = pts[pts.length - 1];
        g.circle(head.x, head.y, band * 1.4).fill({ color: COLOR.white, alpha: 0.35 });
        g.circle(head.x, head.y, band * 0.6).fill({ color: COLOR.white, alpha: 0.95 });
      }
    }

    // The scan line: a phosphor trail above it (the freshly drawn board), a
    // short glow below, a white-hot core, running a little past the frame.
    if (f.scanAlpha > 0) {
      const y = f.scanY, over = 6;
      const trail = Math.min(56, fh * 0.12);
      const strips = 14;
      for (let i = 0; i < strips; i++) {
        const k = i / strips;
        const h = trail / strips;
        g.rect(-over, y - trail + i * h, fw + over * 2, h).fill({ color: accent, alpha: 0.32 * k * k });
      }
      for (let i = 0; i < 5; i++) {
        g.rect(-over, y + i * 2, fw + over * 2, 2).fill({ color: accent, alpha: 0.35 * (1 - i / 5) });
      }
      g.rect(-over, y - 1.5, fw + over * 2, 3).fill({ color: accent, alpha: 1 });
      g.rect(0, y - 0.5, fw, 1).fill({ color: COLOR.white, alpha: 0.9 });
    }

    // Sparks thrown off the line.
    for (const s of bootSparks(elapsed, tl, fw, fh)) {
      g.rect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size).fill({ color: s.alpha > 0.6 ? COLOR.white : accent, alpha: s.alpha });
    }

    // The map goes live: the whole frame flashes and a ring of light spreads off it.
    if (f.flash > 0) {
      outerGlow(g, 0, 0, fw, fh, accent, 0.55 * f.flash, 22);
      g.rect(band / 2, band / 2, fw - band, fh - band).stroke({ width: Math.max(2, band * 0.6), color: accent, alpha: f.flash });
    }
    if (f.ring > 0 && f.ring < 1) {
      const spread = 30 * f.ring;
      g.rect(-spread, -spread, fw + spread * 2, fh + spread * 2).stroke({ width: 2, color: accent, alpha: 0.6 * (1 - f.ring) });
    }
  }, [fw, fh, band, accent, revealing, reduceMotion, loop, elapsed, tl, f.coverTop, f.coverAlpha, f.cells, f.trace, f.flash, f.ring, f.scanAlpha, f.scanY]);

  if (!frame || done) return null;
  const inner = bootGeometry(frame).inner;
  const subtitle = `> ${runStart ? t("game.boot.newRun") : t("game.boot.compiling")}${caretOn ? "_" : " "}`;

  return (
    <Inert label="board-boot"
      layout={{ position: "absolute", left: origin.x + frame.left, top: origin.y + frame.top, width: frame.width, height: frame.height }}>
      <pixiGraphics draw={draw} />
      {f.textAlpha > 0 && (
        <Inert alpha={f.textAlpha} layout={{
          position: "absolute", left: inner.x, top: inner.y, width: inner.width, height: inner.height,
          justifyContent: "center", alignItems: "center", gap: 10,
        }}>
          <Label text={t("game.boot.level", { n: levelNumber })} size={TEXT["2xl"]} font="display" weight="700" upper
            letterSpacing={TEXT["2xl"] * 0.25} color={accent} glow={14} />
          <Label text={subtitle} size={TEXT.xs} font="mono" color={accent} alpha={0.75} />
        </Inert>
      )}
    </Inert>
  );
}
