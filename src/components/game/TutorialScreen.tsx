import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Move, Scissors, Target, AlertTriangle, Heart, Flag, Star } from 'lucide-react';
import { CRTBackground } from './CRTBackground';

interface TutorialScreenProps {
  onBack: () => void;
  accentColor?: string;
}

const tutorialSteps = [
  { icon: Move, key: 'swipeToCut' },
  { icon: Scissors, key: 'removeEmptySpace' },
  { icon: AlertTriangle, key: 'avoidTheBall' },
  { icon: Target, key: 'winCondition' },
];

const lifeCycleSteps = [
  { icon: Heart, key: 'lives' },
  { icon: Flag, key: 'checkpoints' },
  { icon: Star, key: 'headStartCertificates' },
];

export function TutorialScreen({ onBack, accentColor }: TutorialScreenProps) {
  const { t } = useTranslation();
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
          <span className="font-display uppercase tracking-wider text-sm">{t('tutorial.back')}</span>
        </button>
      </motion.div>

      {/* Title */}
      <motion.h1
        className="text-3xl md:text-4xl font-display font-bold text-center mb-12 text-primary"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {t('tutorial.howToPlay')}
      </motion.h1>

      {/* Tutorial steps */}
      <div className="flex-1 flex flex-col items-center max-w-2xl mx-auto w-full">
        <div className="grid gap-6 w-full">
          {tutorialSteps.map((step, index) => (
            <motion.div
              key={step.key}
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
                  {t(`tutorial.steps.${step.key}.title`)}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t(`tutorial.steps.${step.key}.description`)}
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
          {t('tutorial.lifeCycle')}
        </motion.h2>
        <div className="grid gap-6 w-full">
          {lifeCycleSteps.map((step, index) => (
            <motion.div
              key={step.key}
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
                  {t(`tutorial.steps.${step.key}.title`)}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t(`tutorial.steps.${step.key}.description`)}
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
          <h4 className="font-display text-sm font-semibold text-foreground mb-2">{t('tutorial.achievementsCertificatesTitle')}</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('tutorial.achievementsCertificatesBody')}
          </p>
        </motion.div>

        {/* Controls info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-8 p-4 bg-secondary/30 border border-border rounded-lg w-full"
        >
          <h4 className="font-display text-sm font-semibold text-foreground mb-2">{t('tutorial.controlsTitle')}</h4>
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display shrink-0">{t('tutorial.controlTouchLabel')}</span>
              <span>{t('tutorial.controlSwipeToCut')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display shrink-0">{t('tutorial.controlTouchLabel')}</span>
              <span>{t('tutorial.controlSecondFinger')}</span>
            </div>
            {!('ontouchstart' in window) && (
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-card rounded border border-border text-xs font-display shrink-0">{t('tutorial.controlMouseLabel')}</span>
                <span>{t('tutorial.controlClickAndDrag')}</span>
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
          {t('tutorial.gotIt')}
        </button>
      </motion.div>
    </div>
    </>
  );
}
