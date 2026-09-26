/**
 * BoardPlaceholder — the board's outline, drawn the instant the game screen
 * opens, while the real board is still on its way.
 *
 * The WebGL renderer is a lazily loaded chunk that also has to compile its
 * shaders, so on a phone the first map can take a second or two to present.
 * With nothing but a "Loading" label over the background for that long, the
 * screen read as broken rather than busy. This fills the gap with the thing
 * that is coming: the board's own frame and grid, in exactly the rectangle
 * the canvas will draw into, so the real board replaces it in place instead
 * of popping in somewhere new.
 *
 * The rectangle comes from computeBoardRect, the same function GameCanvas
 * sizes the board with, fed the same surface and bottom inset in CSS pixels.
 * It is scale-free (every term is a share of the surface), so CSS and physical
 * pixels give the same shape.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { computeBoardRect } from '@/lib/boardConstants';
import type { BoardRect } from '@/lib/boardConstants';

interface BoardPlaceholderProps {
  /** False once the real board is presenting; the placeholder fades out. */
  visible: boolean;
  accentColor: string;
  /** Height of the bars pinned under the board, as GameCanvas is given it. */
  bottomInsetPx: number;
}

/** Grid spacing as a share of the board, so it reads the same on any screen. */
const GRID_CELLS = 12;

export function BoardPlaceholder({ visible, accentColor, bottomInsetPx }: BoardPlaceholderProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<BoardRect | null>(null);
  // Kept mounted through the fade, then dropped so it costs nothing in play.
  const [gone, setGone] = useState(false);

  // Layout effect, not a plain one: measured before the first paint, so the
  // outline is there on the very first frame rather than one frame late.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setRect(computeBoardRect(width, height, bottomInsetPx));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bottomInsetPx]);

  useEffect(() => {
    if (visible) {
      setGone(false);
      return;
    }
    const timer = window.setTimeout(() => setGone(true), 500);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (gone) {
    return null;
  }

  const cell = rect ? rect.width / GRID_CELLS : 0;

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-20 pointer-events-none transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
      aria-hidden={!visible}
      data-testid="board-placeholder"
    >
      {rect && (
        <div
          className="absolute overflow-hidden rounded-sm"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            border: `1px solid ${accentColor}88`,
            boxShadow: `0 0 18px ${accentColor}33, inset 0 0 24px ${accentColor}1a`,
            backgroundColor: 'rgba(0,10,5,0.55)',
            backgroundImage:
              `linear-gradient(${accentColor}14 1px, transparent 1px),` +
              `linear-gradient(90deg, ${accentColor}14 1px, transparent 1px)`,
            backgroundSize: `${cell}px ${cell}px`,
          }}
        >
          {/* A scan line sweeping down the board: the one moving thing, so the
              wait reads as work in progress rather than a frozen frame. */}
          {!reduceMotion && (
            <motion.div
              className="absolute left-0 right-0"
              style={{
                height: Math.max(24, rect.height * 0.12),
                background: `linear-gradient(to bottom, transparent, ${accentColor}26, transparent)`,
              }}
              initial={{ y: -rect.height * 0.12 }}
              animate={{ y: rect.height }}
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
      )}
    </div>
  );
}
