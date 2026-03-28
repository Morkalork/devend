import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface CheckpointPickerProps {
  /** The latest checkpoint level — picker shows levels 1 to maxLevel-1 */
  maxLevel: number;
  onSelect: (level: number) => void;
  onClose: () => void;
  accentColor?: string;
}

export function CheckpointPicker({ maxLevel, onSelect, onClose, accentColor = '#00ff88' }: CheckpointPickerProps) {
  const levels = Array.from({ length: maxLevel - 1 }, (_, i) => i + 1).reverse();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.7)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          className="relative w-full max-w-xs rounded-xl p-6 flex flex-col gap-3 max-h-[70vh] overflow-y-auto"
          style={{
            background: '#0a0f0a',
            border: `2px solid ${accentColor}`,
            boxShadow: `0 0 32px ${accentColor}44, 0 0 64px ${accentColor}22`,
            fontFamily: "'JetBrains Mono', monospace",
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <h2
              className="text-lg font-black tracking-widest uppercase"
              style={{ fontFamily: 'Orbitron, sans-serif', color: accentColor }}
            >
              Start From…
            </h2>
            <button
              onClick={onClose}
              className="transition-colors"
              style={{ color: `${accentColor}66` }}
              onMouseEnter={e => (e.currentTarget.style.color = accentColor)}
              onMouseLeave={e => (e.currentTarget.style.color = `${accentColor}66`)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {levels.map((level, i) => (
            <motion.button
              key={level}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => onSelect(level)}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center justify-between rounded-lg px-4 py-3 text-left transition-colors"
              style={{
                background: 'transparent',
                border: `1px solid ${accentColor}22`,
              }}
            >
              <span className="font-bold text-base" style={{ color: `${accentColor}cc` }}>
                Level {level}
              </span>
            </motion.button>
          ))}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
