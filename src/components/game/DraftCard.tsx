/**
 * DraftCard — the selectable option card used by the between-maps draft
 * screens (doors, capstones). One source for the selected/hover treatment so
 * every draft in the game reads the same. Mirrors the loadout-draft styling.
 *
 * Optionally supports press-and-hold: pass `onLongPress` and the card opens a
 * detail view on hold (like the shop's upgrade cards), suppressing the select
 * click that would otherwise fire on release.
 */
import { useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';

interface DraftCardProps {
  /** Position in the row, staggers the entrance animation. */
  index: number;
  accentColor: string;
  selected: boolean;
  onClick: () => void;
  name: string;
  /** Rendered to the right of the name (e.g. an archetype TagChip). */
  headerExtra?: React.ReactNode;
  /** When set, holding the card opens a detail view instead of selecting it. */
  onLongPress?: () => void;
  children: React.ReactNode;
}

/** Hold duration before a press counts as "open details" rather than "select". */
const LONG_PRESS_MS = 450;
/** Finger travel that cancels the hold (treat it as a scroll, not a press). */
const MOVE_CANCEL_PX = 10;

export function DraftCard({ index, accentColor, selected, onClick, name, headerExtra, onLongPress, children }: DraftCardProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!onLongPress) return;
    start.current = { x: e.clientX, y: e.clientY };
    fired.current = false;
    cancel();
    timer.current = setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }, [onLongPress, cancel]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    if (s && (Math.abs(e.clientX - s.x) > MOVE_CANCEL_PX || Math.abs(e.clientY - s.y) > MOVE_CANCEL_PX)) {
      cancel();
    }
  }, [cancel]);

  // Clear a pending hold if the card unmounts mid-press.
  useEffect(() => cancel, [cancel]);

  const handleClick = useCallback(() => {
    // A hold already opened the detail view; swallow the click-to-select.
    if (fired.current) {
      fired.current = false;
      return;
    }
    onClick();
  }, [onClick]);

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 + index * 0.1 }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={handleClick}
      onPointerDown={onLongPress ? onPointerDown : undefined}
      onPointerMove={onLongPress ? onPointerMove : undefined}
      onPointerUp={onLongPress ? cancel : undefined}
      onPointerLeave={onLongPress ? cancel : undefined}
      onPointerCancel={onLongPress ? cancel : undefined}
      className="relative text-left rounded-lg p-4 transition-colors"
      style={{
        backgroundColor: selected ? `${accentColor}1a` : 'rgba(255,255,255,0.04)',
        border: `2px solid ${selected ? accentColor : `${accentColor}44`}`,
        boxShadow: selected ? `0 0 24px ${accentColor}66` : 'none',
      }}
    >
      {onLongPress && (
        <Info
          className="absolute top-2 right-2 w-3.5 h-3.5 opacity-40"
          style={{ color: accentColor }}
          aria-hidden
        />
      )}
      <div className="flex items-center gap-2 mb-3">
        <p
          className="font-display font-bold text-base flex-1"
          style={{ color: accentColor, textShadow: selected ? `0 0 12px ${accentColor}88` : 'none' }}
        >
          {name}
        </p>
        {headerExtra}
      </div>
      {children}
    </motion.button>
  );
}
