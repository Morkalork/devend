import { motion } from 'framer-motion';
import { Trophy, Skull, RotateCcw, Home, Sparkles, Hexagon, Clock } from 'lucide-react';
import { GameResult } from '@/types/game';
import { Augment } from '@/types/augment';
import { CRTBackground } from './CRTBackground';

interface ResultScreenProps {
  result: GameResult;
  onPlayAgain: () => void;
  onBackToWelcome: () => void;
  accentColor?: string;
  ownedAugments?: { augment: Augment; stacks: number }[];
  runPointsAwarded?: number;
  runLevelsCompleted?: number;
}

export function ResultScreen({ 
  result, 
  onPlayAgain, 
  onBackToWelcome,
  accentColor,
  ownedAugments = [],
  runPointsAwarded = 0,
  runLevelsCompleted = 0,
}: ResultScreenProps) {
  const { isWin, remainingPercent, levelId, levelNumber, completedAllLevels, totalScore } = result;

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center bg-background/90 p-6 relative z-10">
      {/* Background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className={`absolute w-[600px] h-[600px] rounded-full blur-3xl ${
            isWin ? 'bg-success/10' : 'bg-danger/10'
          }`}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1 }}
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center gap-8"
      >
        {/* Icon */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
          className={`w-24 h-24 rounded-full flex items-center justify-center ${
            isWin 
              ? 'bg-success/20 border-2 border-success' 
              : 'bg-danger/20 border-2 border-danger'
          }`}
          style={{
            boxShadow: isWin 
              ? '0 0 60px hsl(var(--success) / 0.4)' 
              : '0 0 60px hsl(var(--danger) / 0.4)',
          }}
        >
          {isWin ? (
            <Trophy className="w-12 h-12 text-success" />
          ) : (
            <Skull className="w-12 h-12 text-danger" />
          )}
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={`text-4xl md:text-5xl font-display font-black tracking-wider ${
            isWin ? 'text-success' : 'text-danger'
          }`}
          style={{
            textShadow: isWin 
              ? '0 0 30px hsl(var(--success) / 0.5)' 
              : '0 0 30px hsl(var(--danger) / 0.5)',
          }}
        >
          {isWin ? 'YOU WIN!' : 'GAME OVER'}
        </motion.h1>

        {/* Completed all levels message */}
        {completedAllLevels && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="text-2xl font-display text-primary"
          >
            🎉 Completed all levels! 🎉
          </motion.div>
        )}

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center flex flex-col gap-4"
        >
          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-wider mb-1">
              {isWin ? 'Completed Level' : 'Failed at Level'}
            </p>
            <p className="text-3xl font-display font-bold text-foreground">
              {levelNumber}
            </p>
            <p className="text-muted-foreground text-xs mt-1">{levelId}</p>
          </div>

          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-wider mb-1">
              Arena Remaining
            </p>
            <p className="text-5xl font-display font-bold text-foreground">
              {remainingPercent}%
            </p>
          </div>

          {/* Augment Points Earned */}
          {runLevelsCompleted > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.45 }}
              className="mt-4 pt-4 border-t border-border"
            >
              <p className="text-muted-foreground text-sm uppercase tracking-wider mb-1">
                Levels Completed
              </p>
              <p className="text-3xl font-display font-bold text-foreground mb-2">
                {runLevelsCompleted}
              </p>
              {runPointsAwarded > 0 && (
                <div className="flex items-center justify-center gap-2">
                  <Hexagon className="w-6 h-6 text-white fill-white/20" />
                  <p className="text-2xl font-display font-bold text-white">
                    +{runPointsAwarded} Augment Point{runPointsAwarded > 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Active Augments indicator */}
          {ownedAugments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="mt-4 p-3 rounded-lg bg-white/10 border border-white/30"
              style={{ boxShadow: '0 0 15px rgba(255,255,255,0.1)' }}
            >
              <div className="flex items-center gap-2 text-white mb-2">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-display font-bold">
                  {ownedAugments.length} Augment{ownedAugments.length > 1 ? 's' : ''} Active
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {ownedAugments.slice(0, 3).map(({ augment, stacks }) => (
                  <span key={augment.id} className="text-xs text-muted-foreground bg-white/5 px-2 py-0.5 rounded">
                    {augment.name} x{stacks}
                  </span>
                ))}
                {ownedAugments.length > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{ownedAugments.length - 3} more
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="flex flex-col sm:flex-row gap-4 mt-4"
        >
          <motion.button
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
            onClick={onPlayAgain}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RotateCcw className="w-5 h-5" />
            Play Again
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
            onClick={onBackToWelcome}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Home className="w-5 h-5" />
            Menu
          </motion.button>
        </motion.div>
      </motion.div>
      </div>
    </>
  );
}
