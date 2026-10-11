/**
 * BoardPlaceholder - the board's outline, drawn the instant the game screen
 * opens, while the real board is still on its way (canvas port of
 * components/game/BoardPlaceholder.tsx).
 *
 * The WebGL renderer is a lazily loaded chunk that also has to compile its
 * shaders, so on a phone the first map can take a second or two to present.
 * With nothing but a "Loading" label for that long, the screen read as broken
 * rather than busy. This fills the gap with the thing that is coming: the
 * board's own frame and grid, so the real board replaces it in place.
 *
 * It does not measure anything itself. GameCanvas hands it the frame it is
 * about to draw (boardFrameCss), worked out from the same boardRect and arena
 * the renderer uses, so the two cannot disagree.
 */
import { useCallback, useEffect, useState } from "react";
import type { Graphics } from "pixi.js";
import { useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { hex } from "../theme";
import { Label, TEXT, usePulse, useTween } from "../kit/ui";
import { Inert } from "./boardParts";
import { useCycle } from "./fxClock";
import { outerGlow } from "./boardDraw";
import { PLACEHOLDER_FADE_MS, placeholderGeometry, type BoardFrameCss } from "./overlayModel";

export type { BoardFrameCss };

interface BoardPlaceholderProps {
  /** False once the real board is presenting; the placeholder fades out. */
  visible: boolean;
  accentColor: string;
  /** Where the board will be drawn; null until the canvas has been sized. */
  frame: BoardFrameCss | null;
  /** GameCanvas's container's top-left on screen, in CSS px. */
  origin: { x: number; y: number };
}

export function BoardPlaceholder({ visible, accentColor, frame, origin }: BoardPlaceholderProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  // Kept mounted through the fade, then dropped so it costs nothing in play.
  const [gone, setGone] = useState(false);
  const opacity = useTween(visible ? 1 : 0, PLACEHOLDER_FADE_MS / 1000);
  const live = !gone && frame != null;
  const scan = useCycle(1600, live && !reduceMotion);
  const pulse = usePulse(2000, live);

  useEffect(() => {
    if (visible) {
      setGone(false);
      return;
    }
    const timer = window.setTimeout(() => setGone(true), PLACEHOLDER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  const accent = hex(accentColor);
  const geo = frame ? placeholderGeometry(frame) : null;
  const fw = frame?.width ?? 0, fh = frame?.height ?? 0, band = frame?.frame ?? 0;

  // The frame band, its glow, the arena's tint and grid: static, drawn once per size.
  const drawFrame = useCallback((g: Graphics) => {
    g.clear();
    if (fw <= 0) return;
    const { inner, cell } = placeholderGeometry({ left: 0, top: 0, width: fw, height: fh, frame: band });
    outerGlow(g, 0, 0, fw, fh, accent, 0x26 / 255, 18);
    // The frame band, the same thickness the renderer gives the outer wall.
    g.rect(band / 2, band / 2, fw - band, fh - band).stroke({ width: band, color: accent, alpha: 0x33 / 255 });
    g.rect(inner.x, inner.y, inner.width, inner.height).fill({ color: 0x000a05, alpha: 0.55 });
    for (let x = 0; x < inner.width; x += cell) g.rect(inner.x + x, inner.y, 1, inner.height);
    for (let y = 0; y < inner.height; y += cell) g.rect(inner.x, inner.y + y, inner.width, 1);
    g.fill({ color: accent, alpha: 0x14 / 255 });
    // The arena's 1px outline, just outside it.
    g.rect(inner.x - 0.5, inner.y - 0.5, inner.width + 1, inner.height + 1).stroke({ width: 1, color: accent, alpha: 0x66 / 255 });
  }, [fw, fh, band, accent]);

  // A scan line sweeping down the arena: the one moving thing, so the wait
  // reads as work in progress rather than a frozen frame. A soft band
  // (transparent, accent, transparent), clipped to the arena by hand.
  const drawScan = useCallback((g: Graphics) => {
    g.clear();
    if (fw <= 0 || reduceMotion) return;
    const { inner, scanHeight, scanFrom, scanTo } = placeholderGeometry({ left: 0, top: 0, width: fw, height: fh, frame: band });
    const top = scanFrom + (scanTo - scanFrom) * scan;
    const strips = 16;
    const sh = scanHeight / strips;
    for (let i = 0; i < strips; i++) {
      const y0 = Math.max(0, top + i * sh);
      const y1 = Math.min(inner.height, top + (i + 1) * sh);
      if (y1 <= y0) continue;
      const mid = (i + 0.5) / strips;
      const a = (0x26 / 255) * (1 - Math.abs(mid - 0.5) * 2);
      g.rect(inner.x, inner.y + y0, inner.width, y1 - y0).fill({ color: accent, alpha: a });
    }
  }, [fw, fh, band, scan, accent, reduceMotion]);

  if (gone || !frame || !geo) return null;

  return (
    <Inert label="board-placeholder" alpha={opacity}
      layout={{ position: "absolute", left: origin.x + frame.left, top: origin.y + frame.top, width: frame.width, height: frame.height }}>
      <pixiGraphics draw={drawFrame} />
      <pixiGraphics draw={drawScan} />
      <Inert layout={{
        position: "absolute", left: geo.inner.x, top: geo.inner.y, width: geo.inner.width, height: geo.inner.height,
        justifyContent: "center", alignItems: "center",
      }}>
        <Label text={t("common.loading")} size={TEXT.xl} font="display" weight="700" upper letterSpacing={TEXT.xl * 0.35}
          color={accent} glow={12} alpha={0.6 + 0.4 * pulse} />
      </Inert>
    </Inert>
  );
}
