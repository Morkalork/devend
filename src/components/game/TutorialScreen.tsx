import { motion } from 'framer-motion';
import { ArrowLeft, Move, Scissors, Target, AlertTriangle, Heart, Flag, Star } from 'lucide-react';
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

const lifeCycleSteps = [
  {
    icon: Heart,
    title: 'Lives',
    description: 'You start each run with a set number of lives. Lose a life every time a ball hits your growing fence. Run out of lives and the run ends.',
  },
  {
    icon: Flag,
    title: 'Checkpoints',
    description: 'Every 5 levels is a checkpoint. When your run ends, your next run always restarts from the highest checkpoint you reached — you never lose all your progress.',
  },
  {
    icon: Star,
    title: 'Head Start Certificates',
    description: 'In the Certificate Store you can unlock Head Start certificates that permanently raise your starting level — so experienced players never have to replay early levels.',
  },
];

export function TutorialScreen({ onBack, accentColor }: TutorialScreenProps) {
  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="h-dvh flex flex-col bg-background/90 p-6 relative z-10 overflow-y-auto">
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
      <div className="flex-1 flex flex-col items-center max-w-2xl mx-auto w-full">
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

        {/* Life Cycle section */}
        <motion.h2
          className="text-xl font-display font-bold text-center mt-10 mb-6 text-primary"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
        >
          Life Cycle
        </motion.h2>
        <div className="grid gap-6 w-full">
          {lifeCycleSteps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.7 + index * 0.1 }}
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

        {/* Progression note */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="mt-8 p-4 bg-secondary/30 border border-border rounded-lg w-full"
        >
          <h4 className="font-display text-sm font-semibold text-foreground mb-2">Achievements &amp; Certificates</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Play more to unlock achievements and certificates. Achievements reward lifetime milestones with permanent run bonuses. Certificates are earned by mastering specific upgrades across multiple runs and can be purchased in the Certificate Store for lasting effects.
          </p>
        </motion.div>

        {/* Controls info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-8 p-4 bg-secondary/30 border border-border rounded-lg w-full"
        >
          <h4 className="font-display text-sm font-semibold text-foreground mb-2">Controls</h4>
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display shrink-0">TOUCH</span>
              <span>Swipe to cut</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display shrink-0">TOUCH</span>
              <span>Second finger while fence is growing cancels it</span>
            </div>
            {!('ontouchstart' in window) && (
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display shrink-0">MOUSE</span>
                <span>Click and drag</span>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Back button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-8 mb-12 flex justify-center"
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
