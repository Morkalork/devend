/**
 * DraftCard — the selectable option card used by the between-maps draft
 * screens (doors, capstones). One source for the selected/hover treatment so
 * every draft in the game reads the same. Mirrors the loadout-draft styling.
 */
import { motion } from 'framer-motion';

interface DraftCardProps {
  /** Position in the row, staggers the entrance animation. */
  index: number;
  accentColor: string;
  selected: boolean;
  onClick: () => void;
  name: string;
  /** Rendered to the right of the name (e.g. an archetype TagChip). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

export function DraftCard({ index, accentColor, selected, onClick, name, headerExtra, children }: DraftCardProps) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 + index * 0.1 }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="text-left rounded-lg p-4 transition-colors"
      style={{
        backgroundColor: selected ? `${accentColor}1a` : 'rgba(255,255,255,0.04)',
        border: `2px solid ${selected ? accentColor : `${accentColor}44`}`,
        boxShadow: selected ? `0 0 24px ${accentColor}66` : 'none',
      }}
    >
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
