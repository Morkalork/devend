import { motion } from 'framer-motion';
import { Trophy, Zap, Coins } from 'lucide-react';

interface PushYourLuckOverlayProps {
  remainingPercent: number;
  thresholdPercent: number;
  basePoints: number;
  onBank: () => void;
  onPush: () => void;
}

export function PushYourLuckOverlay({
  remainingPercent,
  thresholdPercent,
  basePoints,
  onBank,
  onPush,
}: PushYourLuckOverlayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
    >
      <div className="bg-card/95 border-2 border-success rounded-xl p-6 shadow-2xl backdrop-blur-sm max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <motion.div
            initial={{ rotate: -180, scale: 0 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300 }}
            className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center"
          >
            <Trophy className="w-5 h-5 text-success" />
          </motion.div>
          <h2 className="text-xl font-display font-bold text-success">Level Cleared!</h2>
        </div>

        {/* Info */}
        <div className="text-center mb-4">
          <p className="text-muted-foreground text-sm mb-2">
            Remaining: <span className="text-foreground font-semibold">{remainingPercent}%</span>
            <span className="text-muted-foreground"> / {thresholdPercent}% target</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Cut more to earn an <span className="text-amber-400 font-medium">Overcut Bonus</span>!
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <motion.button
            onClick={onBank}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 px-4 py-3 rounded-lg bg-secondary text-secondary-foreground font-medium flex items-center justify-center gap-2 border border-border hover:bg-secondary/80 transition-colors"
          >
            <Coins className="w-4 h-4" />
            Bank & Continue
          </motion.button>
          <motion.button
            onClick={onPush}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg hover:from-amber-400 hover:to-orange-400 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Push Your Luck
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
