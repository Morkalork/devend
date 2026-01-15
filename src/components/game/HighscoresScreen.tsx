import { motion } from 'framer-motion';
import { Trophy, ArrowLeft, Trash2 } from 'lucide-react';
import { Highscore } from '@/types/highscore';
import { useState } from 'react';

interface HighscoresScreenProps {
  highscores: Highscore[];
  onBack: () => void;
  onClear: () => void;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
}

export function HighscoresScreen({ highscores, onBack, onClear }: HighscoresScreenProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClearClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmClear = () => {
    onClear();
    setShowConfirm(false);
  };

  const handleCancelClear = () => {
    setShowConfirm(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-background p-4 sm:p-6">
      {/* Background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-96 h-96 rounded-full bg-primary/5 blur-3xl"
          animate={{
            x: [0, 50, 0],
            y: [0, -30, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          style={{ top: '10%', right: '10%' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center gap-6 w-full max-w-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-primary" />
          <h1 className="text-3xl sm:text-4xl font-display font-black tracking-wider text-foreground">
            HIGHSCORES
          </h1>
        </div>

        {/* Table */}
        {highscores.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-muted-foreground text-center py-12"
          >
            <p className="text-lg">No highscores yet!</p>
            <p className="text-sm mt-2">Play a game to set your first score.</p>
          </motion.div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-xs tracking-wider">
                  <th className="py-3 px-2 text-center w-12">#</th>
                  <th className="py-3 px-2 text-left">Name</th>
                  <th className="py-3 px-2 text-center">Level</th>
                  <th className="py-3 px-2 text-right">Score</th>
                  <th className="py-3 px-2 text-right hidden sm:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {highscores.map((entry, index) => (
                  <motion.tr
                    key={`${entry.name}-${entry.dateTime}-${index}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className={`border-b border-border/50 ${
                      index < 3 ? 'bg-primary/5' : ''
                    }`}
                  >
                    <td className="py-3 px-2 text-center font-display font-bold">
                      {index < 3 ? (
                        <span className={
                          index === 0 ? 'text-yellow-500' :
                          index === 1 ? 'text-gray-400' :
                          'text-amber-700'
                        }>
                          {index + 1}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{index + 1}</span>
                      )}
                    </td>
                    <td className="py-3 px-2 font-mono font-bold text-foreground">
                      {entry.name}
                    </td>
                    <td className="py-3 px-2 text-center font-display text-foreground">
                      {entry.level}
                    </td>
                    <td className="py-3 px-2 text-right font-display font-bold text-primary">
                      {entry.totalScore.toLocaleString()}
                    </td>
                    <td className="py-3 px-2 text-right text-muted-foreground hidden sm:table-cell">
                      {formatDate(entry.dateTime)}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 mt-4"
        >
          <motion.button
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
            onClick={onBack}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </motion.button>
          {highscores.length > 0 && (
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
  );
}
