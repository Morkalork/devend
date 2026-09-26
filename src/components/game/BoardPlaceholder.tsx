/**
 * BoardPlaceholder — the board's outline, drawn the instant the game screen
 * opens, while the real board is still on its way.
 *
 * The WebGL renderer is a lazily loaded chunk that also has to compile its
 * shaders, so on a phone the first map can take a second or two to present.
 * With nothing but a "Loading" label over the background for that long, the
 * screen read as broken rather than busy. This fills the gap with the thing
 * that is coming: the board's own frame and grid, so the real board replaces
 * it in place instead of popping in somewhere new.
 *
 * It does not measure anything itself. GameCanvas renders it inside its own
 * container and hands it the frame it is about to draw (see boardFrameCss),
 * worked out from the same boardRect and arena the renderer uses, so the two
 * cannot disagree. A first version measured its own box and re-ran
 * computeBoardRect on it; that box was not the canvas's, and it sized the
 * whole world rather than the arena, so the outline came out larger than the
 * board and offset from it.
 */
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/** The drawn board in CSS pixels, relative to the canvas container. */
export interface BoardFrameCss {
  /** Outer edge of the frame. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** How thick the frame band is, so the arena sits exactly inside it. */
  frame: number;
}

interface BoardPlaceholderProps {
  /** False once the real board is presenting; the placeholder fades out. */
  visible: boolean;
  accentColor: string;
  /** Where the board will be drawn; null until the canvas has been sized. */
  frame: BoardFrameCss | null;
}

/** Grid spacing as a share of the arena, so it reads the same on any screen. */
const GRID_CELLS = 12;

export function BoardPlaceholder({ visible, accentColor, frame }: BoardPlaceholderProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  // Kept mounted through the fade, then dropped so it costs nothing in play.
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (visible) {
      setGone(false);
      return;
    }
    const timer = window.setTimeout(() => setGone(true), 500);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (gone || !frame) {
    return null;
  }

  const arena = frame.width - frame.frame * 2;
  const cell = arena / GRID_CELLS;

  return (
    <div
      className={`absolute inset-0 z-20 pointer-events-none transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
      aria-hidden={!visible}
      data-testid="board-placeholder"
    >
      <div
        data-testid="board-placeholder-frame"
        className="absolute"
        style={{
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          // The frame band, the same thickness the renderer gives the outer wall.
          border: `${frame.frame}px solid ${accentColor}33`,
          boxShadow: `0 0 18px ${accentColor}26`,
        }}
      >
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            outline: `1px solid ${accentColor}66`,
            backgroundColor: 'rgba(0,10,5,0.55)',
            backgroundImage:
              `linear-gradient(${accentColor}14 1px, transparent 1px),` +
              `linear-gradient(90deg, ${accentColor}14 1px, transparent 1px)`,
            backgroundSize: `${cell}px ${cell}px`,
          }}
        >
          {/* A scan line sweeping down the arena: the one moving thing, so the
              wait reads as work in progress rather than a frozen frame. */}
          {!reduceMotion && (
            <motion.div
              className="absolute left-0 right-0"
              style={{
                height: Math.max(24, arena * 0.12),
                background: `linear-gradient(to bottom, transparent, ${accentColor}26, transparent)`,
              }}
              initial={{ y: -arena * 0.12 }}
              animate={{ y: arena }}
              transition={{ duration: 1.6, ease: 'linear', repeat: Infinity }}
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="font-display text-xl font-bold tracking-[0.35em] uppercase animate-pulse"
              style={{ color: accentColor, textShadow: `0 0 18px ${accentColor}` }}
            >
              {t('common.loading')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
