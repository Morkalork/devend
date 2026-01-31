import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X, Check, Sparkles, Lock } from 'lucide-react';
import { SuperUpgrade } from '@/types/superUpgrade';
import { CRTBackground } from './CRTBackground';

interface SuperUpgradeOfferProps {
  superUpgrades: SuperUpgrade[];
  currentScore: number;
  onPurchase: (upgrade: SuperUpgrade, newScore: number) => void;
  onSkip: () => void;
  accentColor?: string;
}

export function SuperUpgradeOffer({
  superUpgrades,
  currentScore,
  onPurchase,
  onSkip,
  accentColor,
}: SuperUpgradeOfferProps) {
  const [selectedUpgrade, setSelectedUpgrade] = useState<SuperUpgrade | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleSelect = (upgrade: SuperUpgrade) => {
    if (upgrade.cost > currentScore) return;
    setSelectedUpgrade(upgrade);
    setConfirming(true);
  };

  const handleConfirmPurchase = () => {
    if (!selectedUpgrade) return;
    const newScore = currentScore - selectedUpgrade.cost;
    onPurchase(selectedUpgrade, newScore);
  };

  const handleCancelConfirm = () => {
    setConfirming(false);
    setSelectedUpgrade(null);
  };

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="w-full max-w-lg flex flex-col gap-6"
        >
          {/* Header */}
          <div className="text-center">
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="flex items-center justify-center gap-3 mb-2"
            >
              <Sparkles className="w-8 h-8 text-primary" />
              <h1 className="text-3xl md:text-4xl font-display font-black tracking-wider text-primary"
                style={{ textShadow: '0 0 20px hsl(var(--primary) / 0.5)' }}
              >
                SUPER UPGRADE
              </h1>
              <Sparkles className="w-8 h-8 text-primary" />
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-muted-foreground text-sm"
            >
              Power up your next run — or keep your score for glory
            </motion.p>
          </div>

          {/* Current Score */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="text-center"
          >
            <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Your Score</p>
            <p className="text-4xl font-display font-bold text-foreground">{currentScore}</p>
          </motion.div>

          {/* Upgrade List */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-1"
          >
            {superUpgrades.map((upgrade, index) => {
              const canAfford = upgrade.cost <= currentScore;
              const isSelected = selectedUpgrade?.id === upgrade.id;
              
              return (
                <motion.button
                  key={upgrade.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + index * 0.05 }}
                  onClick={() => handleSelect(upgrade)}
                  disabled={!canAfford}
                  className={`
                    relative p-4 rounded-lg border-2 text-left transition-all
                    ${canAfford 
                      ? 'border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10 cursor-pointer' 
                      : 'border-muted/20 bg-muted/5 opacity-50 cursor-not-allowed'
                    }
                    ${isSelected ? 'border-primary bg-primary/15 ring-2 ring-primary/30' : ''}
                  `}
                  style={{
                    boxShadow: canAfford ? '0 0 15px hsl(var(--primary) / 0.1)' : 'none',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className={`w-4 h-4 ${canAfford ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className={`font-display font-bold text-lg ${canAfford ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {upgrade.name}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-snug">
                        {upgrade.description}
                      </p>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className={`text-lg font-display font-bold ${canAfford ? 'text-primary' : 'text-muted-foreground'}`}>
                        {upgrade.cost}
                      </span>
                      <span className="text-xs text-muted-foreground">pts</span>
                      {!canAfford && (
                        <Lock className="w-4 h-4 text-muted-foreground mt-1" />
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          {/* Skip Button */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            onClick={onSkip}
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2 w-full"
          >
            <X className="w-5 h-5" />
            Skip — Keep Full Score
          </motion.button>
        </motion.div>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {confirming && selectedUpgrade && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-10"
              onClick={handleCancelConfirm}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-background border-2 border-primary rounded-xl p-6 max-w-sm w-full"
                style={{ boxShadow: '0 0 30px hsl(var(--primary) / 0.3)' }}
              >
                <h2 className="text-xl font-display font-bold text-primary mb-4 text-center">
                  Confirm Purchase
                </h2>
                
                <div className="bg-primary/10 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-5 h-5 text-primary" />
                    <span className="font-display font-bold text-foreground">{selectedUpgrade.name}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedUpgrade.description}</p>
                </div>

                <div className="flex justify-between items-center mb-6 px-2">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase">Cost</p>
                    <p className="text-xl font-display font-bold text-danger">-{selectedUpgrade.cost}</p>
                  </div>
                  <div className="text-2xl text-muted-foreground">→</div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase">New Score</p>
                    <p className="text-xl font-display font-bold text-foreground">
                      {currentScore - selectedUpgrade.cost}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleCancelConfirm}
                    className="arcade-button-secondary rounded-lg flex-1 flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmPurchase}
                    className="arcade-button-primary rounded-lg flex-1 flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Buy
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
