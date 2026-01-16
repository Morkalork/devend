import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { User, Check } from 'lucide-react';
import { sanitiseName, getLastName, saveLastName } from '@/hooks/useHighscores';

interface NameEntryDialogProps {
  onSubmit: (name: string) => void;
  onSkip: () => void;
  levelReached: number;
  totalScore: number;
}

export function NameEntryDialog({ onSubmit, onSkip, levelReached, totalScore }: NameEntryDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Prefill with last used name
  useEffect(() => {
    const lastName = getLastName();
    if (lastName) {
      setInputValue(lastName);
    }
    // Focus input on mount
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitiseName(e.target.value);
    setInputValue(sanitized);
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const sanitized = sanitiseName(inputValue);
    
    if (sanitized.length === 0) {
      setError('Please enter at least 1 letter');
      return;
    }
    
    // Save for next time
    saveLastName(sanitized);
    onSubmit(sanitized);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
    >
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">
              Enter Your Name
            </h2>
            <p className="text-sm text-muted-foreground">
              Save your highscore!
            </p>
          </div>
        </div>

        {/* Score preview */}
        <div className="flex gap-4 mb-6 p-3 bg-muted/50 rounded-lg">
          <div className="text-center flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Level</p>
            <p className="text-2xl font-display font-bold text-foreground">{levelReached}</p>
          </div>
          <div className="w-px bg-border" />
          <div className="text-center flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Score</p>
            <p className="text-2xl font-display font-bold text-primary">{totalScore.toLocaleString()}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="AAA"
              maxLength={6}
              className="w-full text-center text-3xl font-mono font-bold tracking-[0.3em] 
                         bg-background border-2 border-border rounded-lg py-4 px-6
                         focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
                         placeholder:text-muted-foreground/30 uppercase"
              autoComplete="off"
              autoCapitalize="characters"
            />
            <p className="text-xs text-muted-foreground text-center mt-2">
              1-6 letters (A-Z only)
            </p>
            {error && (
              <p className="text-xs text-destructive text-center mt-1">{error}</p>
            )}
          </div>

          <div className="flex gap-3">
            <motion.button
              type="button"
              onClick={onSkip}
              className="flex-1 py-3 px-4 rounded-lg border border-border text-muted-foreground hover:bg-muted/50 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Nah...
            </motion.button>
            <motion.button
              type="submit"
              className="flex-1 arcade-button-primary rounded-lg flex items-center justify-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Check className="w-5 h-5" />
              Save
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
