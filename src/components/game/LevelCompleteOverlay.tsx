import { motion } from 'framer-motion';
import { Trophy, ArrowRight } from 'lucide-react';
import { LevelScoreData } from '@/types/game';

interface LevelCompleteOverlayProps {
  scoreData: LevelScoreData;
  totalScore: number;
  onContinue: () => void;
}

export function LevelCompleteOverlay({ scoreData, totalScore, onContinue }: LevelCompleteOverlayProps) {
  const { levelNumber, levelId, cutCount, expectedCuts, basePoints, levelScore, remainingPercent } = scoreData;
  
  const bonusOrPenalty = cutCount <= expectedCuts 
    ? expectedCuts - cutCount 
    : -(cutCount - expectedCuts);
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 20 }}
        className="bg-card border border-border rounded-xl p-8 max-w-sm w-full mx-4 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <motion.div
            initial={{ rotate: -180, scale: 0 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ delay: 0.2, type: 'spring' }}
            className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center"
          >
            <Trophy className="w-6 h-6 text-success" />
          </motion.div>
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground">Level Complete!</h2>
            <p className="text-muted-foreground text-sm">{levelId}</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="space-y-4 mb-6">
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground">Level</span>
            <span className="font-bold text-foreground">{levelNumber}</span>
          </div>
          
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-bold text-foreground">{remainingPercent}%</span>
          </div>
          
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground">Cuts Made</span>
            <span className="font-bold text-foreground">{cutCount}</span>
          </div>
          
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground">Expected Cuts</span>
            <span className="font-bold text-foreground">{expectedCuts}</span>
          </div>
          
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground">Base Points</span>
            <span className="font-bold text-foreground">{basePoints}</span>
          </div>
          
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground">
              {bonusOrPenalty >= 0 ? 'Bonus' : 'Penalty'}
            </span>
            <span className={`font-bold ${bonusOrPenalty >= 0 ? 'text-success' : 'text-destructive'}`}>
              {bonusOrPenalty >= 0 ? '+' : ''}{bonusOrPenalty}
            </span>
          </div>
          
          <div className="flex justify-between items-center py-3 bg-primary/10 rounded-lg px-3">
            <span className="font-semibold text-foreground">Level Score</span>
            <span className="text-2xl font-bold text-primary">{levelScore}</span>
          </div>
          
          <div className="flex justify-between items-center py-3 bg-accent/10 rounded-lg px-3">
            <span className="font-semibold text-foreground">Total Score</span>
            <span className="text-2xl font-bold text-accent-foreground">{totalScore}</span>
          </div>
        </div>

        {/* Continue Button */}
        <motion.button
          className="arcade-button-primary w-full rounded-lg flex items-center justify-center gap-2"
          onClick={onContinue}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Next Level
          <ArrowRight className="w-5 h-5" />
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
