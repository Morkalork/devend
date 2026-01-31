import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowLeft, Check, Lock, Crown } from 'lucide-react';
import { Augment } from '@/types/augment';
import { MetaProgressionStats } from '@/types/metaProgression';
import { CRTBackground } from './CRTBackground';
import { SvgIcon } from '@/components/ui/SvgIcon';
import { Progress } from '@/components/ui/progress';

interface AugmentStoreProps {
  augments: Augment[];
  totalScoreBalance: number;
  ownedAugmentIds: string[];
  unlockedIds: string[];
  metaStats: MetaProgressionStats;
  onPurchase: (augment: Augment) => void;
  onBack: () => void;
  accentColor?: string;
}

export function AugmentStore({
  augments,
  totalScoreBalance,
  ownedAugmentIds,
  unlockedIds,
  metaStats,
  onPurchase,
  onBack,
  accentColor,
}: AugmentStoreProps) {
  const [selectedAugment, setSelectedAugment] = useState<Augment | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isAugmentOwned = (id: string) => ownedAugmentIds.includes(id);
  const isAugmentUnlocked = (augment: Augment) => !augment.locked || unlockedIds.includes(augment.id);
  const canAfford = (augment: Augment) => totalScoreBalance >= augment.cost;

  const getUnlockProgress = (augment: Augment) => {
    if (!augment.locked || !augment.unlockCondition) return null;
    const current = metaStats[augment.unlockCondition.type];
    return {
      current,
      threshold: augment.unlockCondition.threshold,
      description: augment.unlockCondition.description,
    };
  };

  const handleSelect = (augment: Augment) => {
    if (isAugmentOwned(augment.id)) return;
    if (!isAugmentUnlocked(augment)) return;
    if (!canAfford(augment)) return;
    setSelectedAugment(augment);
    setConfirming(true);
  };

  const handleConfirmPurchase = () => {
    if (!selectedAugment) return;
    onPurchase(selectedAugment);
    setConfirming(false);
    setSelectedAugment(null);
  };

  const handleCancelConfirm = () => {
    setConfirming(false);
    setSelectedAugment(null);
  };

  // Sort: owned first, then unlocked, then locked
  const sortedAugments = [...augments].sort((a, b) => {
    const aOwned = isAugmentOwned(a.id);
    const bOwned = isAugmentOwned(b.id);
    if (aOwned !== bOwned) return aOwned ? -1 : 1;
    
    const aUnlocked = isAugmentUnlocked(a);
    const bUnlocked = isAugmentUnlocked(b);
    if (aUnlocked !== bUnlocked) return aUnlocked ? -1 : 1;
    
    return a.cost - b.cost;
  });

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center bg-background/90 p-4 sm:p-6 relative z-10">
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
            <Sparkles className="w-8 h-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-display font-black tracking-wider text-foreground">
              AUGMENTS
            </h1>
          </div>

          {/* Score Balance */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-primary/10 border border-primary/30 rounded-xl px-6 py-3 text-center"
            style={{ boxShadow: '0 0 20px hsl(var(--primary) / 0.2)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Total Score Balance
            </p>
            <p className="text-4xl font-display font-bold text-primary">
              {totalScoreBalance.toLocaleString()}
            </p>
          </motion.div>

          {/* Augment Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full flex flex-col gap-3 max-h-[55vh] overflow-y-auto pr-1"
          >
            {sortedAugments.map((augment, index) => {
              const owned = isAugmentOwned(augment.id);
              const unlocked = isAugmentUnlocked(augment);
              const affordable = canAfford(augment);
              const canPurchase = !owned && unlocked && affordable;
              const unlockProgress = getUnlockProgress(augment);

              return (
                <motion.button
                  key={augment.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + index * 0.03 }}
                  onClick={() => handleSelect(augment)}
                  disabled={!canPurchase}
                  className={`
                    relative p-4 rounded-lg border-2 text-left transition-all
                    ${owned
                      ? 'border-primary/50 bg-primary/15 cursor-default'
                      : !unlocked
                        ? 'border-muted/30 bg-muted/5 opacity-60 cursor-not-allowed'
                        : canPurchase 
                          ? 'border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10 cursor-pointer' 
                          : 'border-muted/20 bg-muted/5 opacity-50 cursor-not-allowed'
                    }
                  `}
                  style={{
                    boxShadow: owned ? '0 0 20px hsl(var(--primary) / 0.15)' : canPurchase ? '0 0 15px hsl(var(--primary) / 0.1)' : 'none',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {augment.icon ? (
                          <SvgIcon 
                            src={augment.icon} 
                            className={`w-5 h-5 ${owned ? 'text-primary' : !unlocked ? 'text-muted-foreground/50' : canPurchase ? 'text-primary' : 'text-muted-foreground'}`}
                          />
                        ) : (
                          <Sparkles className={`w-4 h-4 ${owned ? 'text-primary' : !unlocked ? 'text-muted-foreground/50' : canPurchase ? 'text-primary' : 'text-muted-foreground'}`} />
                        )}
                        <span className={`font-display font-bold text-lg ${owned ? 'text-primary' : !unlocked ? 'text-muted-foreground/70' : canPurchase ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {augment.name}
                        </span>
                        {owned && <Crown className="w-4 h-4 text-primary" />}
                        {!unlocked && <Lock className="w-4 h-4 text-muted-foreground/50" />}
                      </div>
                      <p className="text-sm text-muted-foreground leading-snug">
                        {augment.description}
                      </p>
                      
                      {/* Unlock progress */}
                      {!unlocked && unlockProgress && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>{unlockProgress.description}</span>
                            <span>{unlockProgress.current} / {unlockProgress.threshold}</span>
                          </div>
                          <Progress 
                            value={(unlockProgress.current / unlockProgress.threshold) * 100} 
                            className="h-1.5 bg-muted/30"
                          />
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-end shrink-0">
                      {owned ? (
                        <div className="flex items-center gap-1 text-primary">
                          <Check className="w-5 h-5" />
                          <span className="text-sm font-bold">OWNED</span>
                        </div>
                      ) : (
                        <>
                          <span className={`text-lg font-display font-bold ${canPurchase ? 'text-primary' : 'text-muted-foreground'}`}>
                            {augment.cost.toLocaleString()}
                          </span>
                          <span className="text-xs text-muted-foreground">pts</span>
                        </>
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          {/* Back Button */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={onBack}
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </motion.button>
        </motion.div>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {confirming && selectedAugment && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
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
                  Purchase Augment?
                </h2>
                
                <div className="bg-primary/10 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    {selectedAugment.icon ? (
                      <SvgIcon src={selectedAugment.icon} className="w-5 h-5 text-primary" />
                    ) : (
                      <Sparkles className="w-5 h-5 text-primary" />
                    )}
                    <span className="font-display font-bold text-foreground">{selectedAugment.name}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedAugment.description}</p>
                </div>

                <div className="flex justify-between items-center mb-6 px-2">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase">Cost</p>
                    <p className="text-xl font-display font-bold text-danger">-{selectedAugment.cost.toLocaleString()}</p>
                  </div>
                  <div className="text-2xl text-muted-foreground">→</div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase">New Balance</p>
                    <p className="text-xl font-display font-bold text-foreground">
                      {(totalScoreBalance - selectedAugment.cost).toLocaleString()}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground text-center mb-4">
                  This augment will apply to <strong className="text-foreground">all future runs</strong> permanently.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={handleCancelConfirm}
                    className="arcade-button-secondary rounded-lg flex-1"
                  >
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
