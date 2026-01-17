import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import { CRTBackground } from './CRTBackground';

interface WelcomeScreenProps {
  onStartGame: () => void;
  onTutorial: () => void;
  onOptions: () => void;
  onHighscores: () => void;
  onAdmin?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function WelcomeScreen({ onStartGame, onTutorial, onOptions, onHighscores, onAdmin, isLoading, error }: WelcomeScreenProps) {
  return (
    <>
      <CRTBackground />
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10" style={{ backgroundColor: 'hsl(var(--background) / 0.85)' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-64 h-64 rounded-full bg-primary/5 blur-3xl"
          animate={{
            x: [0, 100, 0],
            y: [0, -50, 0],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          style={{ top: '20%', left: '10%' }}
        />
        <motion.div
          className="absolute w-96 h-96 rounded-full bg-accent/5 blur-3xl"
          animate={{
            x: [0, -80, 0],
            y: [0, 60, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          style={{ bottom: '10%', right: '5%' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 flex flex-col items-center gap-12"
      >
        {/* Title */}
        <motion.div
          className="text-center"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
        <h1 className="game-title animate-pulse-glow">
            Dev/End
          </h1>
          <motion.p
            className="mt-4 text-muted-foreground text-lg tracking-wide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            Slice. Trap. Survive.
          </motion.p>
        </motion.div>

        {/* Animated ball preview */}
        <motion.div
          className="w-16 h-16 rounded-full bg-primary animate-float"
          style={{
            boxShadow: '0 0 40px hsl(var(--primary) / 0.6), 0 0 80px hsl(var(--primary) / 0.3)',
          }}
        />

        {/* Error state */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </motion.div>
        )}

        {/* Buttons */}
        <motion.div
          className="flex flex-col gap-4 w-full max-w-xs"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <motion.button
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
            onClick={onStartGame}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading...
              </>
            ) : (
              'Start Game'
            )}
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg"
            onClick={onTutorial}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Tutorial
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg"
            onClick={onOptions}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Options
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg"
            onClick={onHighscores}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            Highscores
          </motion.button>
          {import.meta.env.DEV && onAdmin && (
            <motion.button
              className="arcade-button-secondary rounded-lg opacity-70"
              onClick={onAdmin}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Admin
            </motion.button>
          )}
        </motion.div>
      </motion.div>
    </div>
    </>
  );
}
