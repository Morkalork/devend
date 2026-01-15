import { motion } from 'framer-motion';
import { Trophy, ArrowRight, Sparkles } from 'lucide-react';
import { LevelScoreData } from '@/types/game';

interface LevelCompleteOverlayProps {
  scoreData: LevelScoreData;
  totalScore: number;
  onContinue: () => void;
}

export function LevelCompleteOverlay({ scoreData, totalScore, onContinue }: LevelCompleteOverlayProps) {
  const { levelNumber, levelId, cutCount, expectedCuts, basePoints, levelScore, remainingPercent, overcutBonus = 0 } = scoreData;
  
  const bonusOrPenalty = cutCount <= expectedCuts 
    ? expectedCuts - cutCount 
    : -(cutCount - expectedCuts);
  
  // Calculate base level score without overcut bonus for display
  const baseLevelScore = levelScore - overcutBonus;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm overflow-y-auto"
    >
      <div className="min-h-full w-full flex items-start sm:items-center justify-center py-4 px-4 box-border">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.2 }}
          className="bg-card border border-border rounded-xl p-4 sm:p-6 w-full max-w-sm shadow-2xl"
        >
        {/* Header */}
        <div className="flex items-center justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
          <motion.div
            initial={{ rotate: -180, scale: 0 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ delay: 0.2, type: 'spring' }}
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-success/20 flex items-center justify-center"
          >
            <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-success" />
          </motion.div>
          <div>
            <h2 className="text-xl sm:text-2xl font-display font-bold text-foreground">Level Complete!</h2>
            <p className="text-muted-foreground text-xs sm:text-sm">{levelId}</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 text-sm sm:text-base">
          <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
            <span className="text-muted-foreground">Level</span>
            <span className="font-bold text-foreground">{levelNumber}</span>
          </div>
          
          <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-bold text-foreground">{remainingPercent}%</span>
          </div>
          
          <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
            <span className="text-muted-foreground">Cuts Made</span>
            <span className="font-bold text-foreground">{cutCount}</span>
          </div>
          
          <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
            <span className="text-muted-foreground">Expected Cuts</span>
            <span className="font-bold text-foreground">{expectedCuts}</span>
          </div>
          
          <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
            <span className="text-muted-foreground">Base Points</span>
            <span className="font-bold text-foreground">{basePoints}</span>
          </div>
          
          <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
            <span className="text-muted-foreground">
              {bonusOrPenalty >= 0 ? 'Par Bonus' : 'Par Penalty'}
            </span>
            <span className={`font-bold ${bonusOrPenalty >= 0 ? 'text-success' : 'text-destructive'}`}>
              {bonusOrPenalty >= 0 ? '+' : ''}{bonusOrPenalty}
            </span>
          </div>
          
          {overcutBonus > 0 && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="flex justify-between items-center py-1.5 sm:py-2 border-b border-amber-500/30 bg-amber-500/10 rounded px-2"
            >
              <span className="text-amber-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 sm:w-4 sm:h-4" />
                Overcut Bonus
              </span>
              <span className="font-bold text-amber-400">+{overcutBonus}</span>
            </motion.div>
          )}
          
          <div className="flex justify-between items-center py-2 sm:py-3 bg-primary/10 rounded-lg px-2 sm:px-3">
            <span className="font-semibold text-foreground">Level Score</span>
            <span className="text-xl sm:text-2xl font-bold text-primary">{levelScore}</span>
          </div>
          
          <div className="flex justify-between items-center py-2 sm:py-3 bg-accent/10 rounded-lg px-2 sm:px-3">
            <span className="font-semibold text-foreground">Total Score</span>
            <span className="text-xl sm:text-2xl font-bold text-accent-foreground">{totalScore}</span>
          </div>
        </div>

        {/* Continue Button */}
        <motion.button
          className="arcade-button-primary w-full rounded-lg flex items-center justify-center gap-2 text-sm sm:text-base py-2 sm:py-3"
          onClick={onContinue}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Next Level
          <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
        </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}
