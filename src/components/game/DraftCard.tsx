/**
 * DraftCard — the selectable option card used by the between-maps draft
 * screens (doors, capstones, tier rewards). One source for the selected/hover
 * treatment so every draft in the game reads the same.
 *
 * Sized to match the upgrade shop's cards: p-5, rounded-xl, a large leading
 * glyph and a text-xl name. The shop got there first and everything else stayed
 * small, so a Promotion - a once-per-run reward - was presented in a smaller
 * card than a 40-hour Junior upgrade. The card should carry the weight of the
 * decision, and picking an assignment is a bigger decision than most purchases.
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
  /**
   * Large leading glyph, matching the upgrade card's identity block.
   *
   * The shop's cards lead with a big icon, then the kind, then the name, and
   * that block is most of why they read as cards rather than as list rows. A
   * draft card without one still lays out correctly; it just looks like the
   * smaller thing it used to be.
   */
  icon?: React.ReactNode;
  /** When set, holding the card opens a detail view instead of selecting it. */
  onLongPress?: () => void;
  children: React.ReactNode;
}

/** Hold duration before a press counts as "open details" rather than "select". */
const LONG_PRESS_MS = 450;
/** Finger travel that cancels the hold (treat it as a scroll, not a press). */
const MOVE_CANCEL_PX = 10;

export function DraftCard({ index, accentColor, selected, onClick, name, headerExtra, icon, onLongPress, children }: DraftCardProps) {
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
      className="relative text-left rounded-xl p-5 transition-colors flex flex-col gap-3"
      style={{
        backgroundColor: selected ? `${accentColor}1a` : 'rgba(255,255,255,0.04)',
        border: `2px solid ${selected ? accentColor : `${accentColor}44`}`,
        boxShadow: selected ? `0 0 24px ${accentColor}66` : 'none',
      }}
    >
      {onLongPress && (
        <Info
          className="absolute top-3 right-3 w-4 h-4 opacity-40"
          style={{ color: accentColor }}
          aria-hidden
        />
      )}
      {/* Three rules here, each earned by a way this broke.
          pr-8: the Info glyph is absolutely positioned at right-3 and is 4 units
            wide, so it owns the first 7 units of the right edge and anything in
            `headerExtra` has to clear it.
          flex-wrap + a min width on the name: `min-w-0` let the name's box
            shrink below the width of a single unbreakable word, and the word
            then overflowed its box and painted straight over the tag chip - a
            collision the DOM geometry says is not there, because the boxes do
            not overlap, only the ink does. The name now keeps a floor and the
            chip drops to its own line when the two will not fit.
          shrink-0 on the extra: given the choice, wrap the name and keep the
            tag whole. A clipped tag is unreadable; a wrapped name is not. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 pr-8">
        {icon}
        <p
          className="font-display font-bold text-xl flex-1 min-w-[7rem] leading-tight"
          style={{ color: accentColor, textShadow: selected ? `0 0 12px ${accentColor}88` : 'none' }}
        >
          {name}
        </p>
        {headerExtra && <span className="shrink-0">{headerExtra}</span>}
      </div>
      {children}
    </motion.button>
  );
}
