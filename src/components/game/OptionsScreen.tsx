import { motion } from 'framer-motion';
import { ArrowLeft, Settings, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CRTBackground } from './CRTBackground';

interface OptionsScreenProps {
  onBack: () => void;
  onReplayTutorial: () => void;
  onClearHighscores: () => void;
  hasHighscores: boolean;
  accentColor?: string;
}

export function OptionsScreen({ 
  onBack, 
  onReplayTutorial, 
  onClearHighscores,
  hasHighscores,
  accentColor,
}: OptionsScreenProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClearClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmClear = () => {
    onClearHighscores();
    setShowConfirm(false);
  };

  const handleCancelClear = () => {
    setShowConfirm(false);
  };

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center bg-background/90 p-6 relative z-10">
      {/* Background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-64 h-64 rounded-full bg-primary/5 blur-3xl"
          animate={{
            x: [0, 80, 0],
            y: [0, -40, 0],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          style={{ top: '30%', left: '15%' }}
        />
        <motion.div
          className="absolute w-80 h-80 rounded-full bg-accent/5 blur-3xl"
          animate={{
            x: [0, -60, 0],
            y: [0, 50, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          style={{ bottom: '20%', right: '10%' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center gap-8 w-full max-w-sm"
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Settings className="w-8 h-8 text-primary" />
          <h1 className="text-3xl sm:text-4xl font-display font-black tracking-wider text-foreground">
            OPTIONS
          </h1>
        </div>

        {/* Options List */}
        <motion.div
          className="flex flex-col gap-4 w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {/* Replay Interactive Tutorial */}
          <motion.button
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
            onClick={onReplayTutorial}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className="w-5 h-5" />
            Replay Interactive Tutorial
          </motion.button>

          {/* Clear Highscores */}
          {hasHighscores && (
            <motion.button
              className="arcade-button-danger rounded-lg flex items-center justify-center gap-2"
              onClick={handleClearClick}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Trash2 className="w-5 h-5" />
              Clear Highscores
            </motion.button>
          )}

          {/* Back Button */}
          <motion.button
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2 mt-4"
            onClick={onBack}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </motion.button>
        </motion.div>
      </motion.div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-xl"
          >
            <h2 className="text-xl font-display font-bold text-foreground mb-4">
              Clear All Highscores?
            </h2>
            <p className="text-muted-foreground mb-6">
              This will permanently delete all saved highscores. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 arcade-button-secondary rounded-lg py-2"
                onClick={handleCancelClear}
              >
                Cancel
              </button>
              <button
                className="flex-1 arcade-button-danger rounded-lg py-2"
                onClick={handleConfirmClear}
              >
                Clear
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
    </>
  );
}
