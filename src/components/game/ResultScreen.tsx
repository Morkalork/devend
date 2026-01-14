import { motion } from 'framer-motion';
import { Trophy, Skull, RotateCcw, Home } from 'lucide-react';

interface ResultScreenProps {
  isWin: boolean;
  remainingPercent: number;
  onPlayAgain: () => void;
  onBackToWelcome: () => void;
}

export function ResultScreen({ isWin, remainingPercent, onPlayAgain, onBackToWelcome }: ResultScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
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

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center"
        >
          <p className="text-muted-foreground text-sm uppercase tracking-wider mb-2">
            Arena Remaining
          </p>
          <p className="text-5xl font-display font-bold text-foreground">
            {remainingPercent}%
          </p>
        </motion.div>

        {/* Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
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
  );
}
