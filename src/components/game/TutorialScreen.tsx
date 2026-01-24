import { motion } from 'framer-motion';
import { ArrowLeft, Move, Scissors, Target, AlertTriangle } from 'lucide-react';
import { CRTBackground } from './CRTBackground';

interface TutorialScreenProps {
  onBack: () => void;
  accentColor?: string;
}

const tutorialSteps = [
  {
    icon: Move,
    title: 'Swipe to Cut',
    description: 'Swipe or drag to create a slicing wall. Horizontal or vertical based on your swipe direction.',
  },
  {
    icon: Scissors,
    title: 'Remove Empty Space',
    description: 'When the wall completes, the side WITHOUT the ball is removed and becomes darkness.',
  },
  {
    icon: AlertTriangle,
    title: 'Avoid the Ball',
    description: "Don't let the ball hit the wall while it's still growing — instant game over!",
  },
  {
    icon: Target,
    title: 'Win Condition',
    description: 'Reduce the arena to under 25% of its original size to win. Speed increases with each cut!',
  },
];

export function TutorialScreen({ onBack, accentColor }: TutorialScreenProps) {
  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col bg-background/90 p-6 relative z-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-8"
      >
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-display uppercase tracking-wider text-sm">Back</span>
        </button>
      </motion.div>

      {/* Title */}
      <motion.h1
        className="text-3xl md:text-4xl font-display font-bold text-center mb-12 text-primary"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        How to Play
      </motion.h1>

      {/* Tutorial steps */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full">
        <div className="grid gap-6 w-full">
          {tutorialSteps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.1 }}
              className="flex gap-4 p-4 bg-card/50 border border-border rounded-lg"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                <step.icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-foreground mb-1">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {step.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Controls info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-8 p-4 bg-secondary/30 border border-border rounded-lg w-full"
        >
          <h4 className="font-display text-sm font-semibold text-foreground mb-2">Controls</h4>
          <div className="flex flex-col sm:flex-row gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display">TOUCH</span>
              <span>Swipe to cut</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display">MOUSE</span>
              <span>Click and drag</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Back button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-8 flex justify-center"
      >
        <button
          onClick={onBack}
          className="arcade-button-secondary rounded-lg"
        >
          Got it!
        </button>
      </motion.div>
    </div>
    </>
  );
}
