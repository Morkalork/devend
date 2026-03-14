import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowLeft, Check, Lock, Plus, Hexagon } from 'lucide-react';
import { Augment } from '@/types/augment';
import { MetaProgressionStats } from '@/types/metaProgression';
import { CRTBackground } from './CRTBackground';
import { SvgIcon } from '@/components/ui/SvgIcon';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { TutorialOverlay } from './TutorialOverlay';

interface AugmentStoreProps {
  augments: Augment[];
  totalAugmentPoints: number;
  augmentsOwned: Record<string, number>;
  unlockedIds: string[];
  metaStats: MetaProgressionStats;
  onPurchase: (augment: Augment) => void;
  onBack: () => void;
  accentColor?: string;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
}

export function AugmentStore({
  augments,
  totalAugmentPoints,
  augmentsOwned,
  unlockedIds,
  metaStats,
  onPurchase,
  onBack,
  accentColor,
  showTutorial = false,
  onTutorialDismiss,
}: AugmentStoreProps) {
  const [selectedAugment, setSelectedAugment] = useState<Augment | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [justPurchased, setJustPurchased] = useState<string | null>(null);

  const getStacks = (id: string) => augmentsOwned[id] || 0;
  const isAugmentUnlocked = (augment: Augment) => !augment.locked || unlockedIds.includes(augment.id);
  const canAfford = (augment: Augment) => totalAugmentPoints >= augment.costPerStack;
  const isMaxed = (augment: Augment) => getStacks(augment.id) >= augment.maxStacks;

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
    if (!isAugmentUnlocked(augment)) return;
    if (isMaxed(augment)) return;
    if (!canAfford(augment)) return;
    setSelectedAugment(augment);
    setConfirming(true);
  };

  const handleConfirmPurchase = () => {
    if (!selectedAugment) return;
    onPurchase(selectedAugment);
    
    // Show visual confirmation
    setJustPurchased(selectedAugment.id);
    setTimeout(() => setJustPurchased(null), 1500);
    
    toast({
      title: `${selectedAugment.name} upgraded!`,
      description: `Stack ${getStacks(selectedAugment.id) + 1}/${selectedAugment.maxStacks}`,
    });
    
    setConfirming(false);
    setSelectedAugment(null);
  };

  const handleCancelConfirm = () => {
    setConfirming(false);
    setSelectedAugment(null);
  };

  // Sort: owned first, then affordable, then rest
  const sortedAugments = [...augments].sort((a, b) => {
    const aStacks = getStacks(a.id);
    const bStacks = getStacks(b.id);
    const aMaxed = aStacks >= a.maxStacks;
    const bMaxed = bStacks >= b.maxStacks;
    
    // Maxed items go to bottom
    if (aMaxed !== bMaxed) return aMaxed ? 1 : -1;
    
    // Owned (but not maxed) go to top
    const aOwned = aStacks > 0 && !aMaxed;
    const bOwned = bStacks > 0 && !bMaxed;
    if (aOwned !== bOwned) return aOwned ? -1 : 1;
    
    // Affordable & unlocked next
    const aCanBuy = isAugmentUnlocked(a) && canAfford(a) && !aMaxed;
    const bCanBuy = isAugmentUnlocked(b) && canAfford(b) && !bMaxed;
    if (aCanBuy !== bCanBuy) return aCanBuy ? -1 : 1;
    
    // Unlocked but unaffordable before locked
    const aUnlocked = isAugmentUnlocked(a);
    const bUnlocked = isAugmentUnlocked(b);
    if (aUnlocked !== bUnlocked) return aUnlocked ? -1 : 1;
    
    return a.costPerStack - b.costPerStack;
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
            <Sparkles className="w-8 h-8 text-white" />
            <h1 className="text-3xl sm:text-4xl font-display font-black tracking-wider text-foreground">
              AUGMENTS
            </h1>
          </div>

          {/* Augment Points Balance */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white/10 border border-white/30 rounded-xl px-6 py-3 text-center"
            style={{ boxShadow: '0 0 20px rgba(255,255,255,0.1)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Augment Points
            </p>
            <div className="flex items-center justify-center gap-2">
              <Hexagon className="w-6 h-6 text-white fill-white/20" />
              <p className="text-4xl font-display font-bold text-white">
                {totalAugmentPoints}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Earn 1 point every 5 levels
            </p>
          </motion.div>

          {/* Info message when can't afford anything */}
          {totalAugmentPoints > 0 && !sortedAugments.some(a => isAugmentUnlocked(a) && !isMaxed(a) && canAfford(a)) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-muted/20 border border-muted/30 rounded-lg p-3 text-center text-sm text-muted-foreground"
            >
              You need more Augment Points to purchase. The cheapest augment costs 2 points.
            </motion.div>
          )}

          {/* Augment Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full flex flex-col gap-3 max-h-[55vh] overflow-y-auto pr-1"
          >
            {sortedAugments.map((augment, index) => {
              const stacks = getStacks(augment.id);
              const maxed = isMaxed(augment);
              const unlocked = isAugmentUnlocked(augment);
              const affordable = canAfford(augment);
              const canPurchase = unlocked && !maxed && affordable;
              const unlockProgress = getUnlockProgress(augment);

              return (
                <motion.button
                  key={augment.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ 
                    opacity: 1, 
                    x: 0,
                    scale: justPurchased === augment.id ? [1, 1.02, 1] : 1,
                  }}
                  transition={{ 
                    delay: 0.25 + index * 0.03,
                    scale: { duration: 0.3 }
                  }}
                  whileTap={canPurchase ? { scale: 0.98 } : undefined}
                  whileHover={canPurchase ? { scale: 1.01 } : undefined}
                  onClick={() => {
                    console.log('[AugmentStore] Clicked:', augment.name, { canPurchase, unlocked, maxed, affordable });
                    handleSelect(augment);
                  }}
                  disabled={!canPurchase}
                  className={`
                    relative p-4 rounded-lg border-2 text-left transition-all outline-none
                    ${augment.special 
                      ? justPurchased === augment.id
                        ? 'border-yellow-400 bg-yellow-500/30'
                        : maxed
                          ? 'border-yellow-500/60 bg-gradient-to-r from-yellow-500/25 via-amber-500/20 to-yellow-500/25 cursor-default'
                          : canPurchase 
                            ? 'border-yellow-500/50 bg-gradient-to-r from-yellow-500/15 via-amber-500/10 to-yellow-500/15 hover:border-yellow-400 hover:bg-yellow-500/20 cursor-pointer active:bg-yellow-500/25 focus:ring-2 focus:ring-yellow-400/50' 
                            : 'border-yellow-500/20 bg-yellow-500/5 opacity-60 cursor-not-allowed'
                      : justPurchased === augment.id
                        ? 'border-white bg-white/20'
                        : maxed
                          ? 'border-white/50 bg-white/15 cursor-default'
                          : !unlocked
                            ? 'border-muted/30 bg-muted/5 opacity-60 cursor-not-allowed'
                            : canPurchase 
                              ? 'border-white/30 bg-white/5 hover:border-white hover:bg-white/10 cursor-pointer active:bg-white/15 focus:ring-2 focus:ring-white/50' 
                              : 'border-muted/20 bg-muted/5 opacity-50 cursor-not-allowed'
                    }
                  `}
                  style={{
                    boxShadow: augment.special
                      ? justPurchased === augment.id 
                        ? '0 0 40px rgba(234, 179, 8, 0.5), inset 0 0 20px rgba(234, 179, 8, 0.1)' 
                        : maxed 
                          ? '0 0 25px rgba(234, 179, 8, 0.3), inset 0 0 15px rgba(234, 179, 8, 0.05)' 
                          : canPurchase 
                            ? '0 0 20px rgba(234, 179, 8, 0.2)' 
                            : 'none'
                      : justPurchased === augment.id 
                        ? '0 0 30px rgba(255,255,255,0.4)' 
                        : maxed 
                          ? '0 0 20px rgba(255,255,255,0.15)' 
                          : canPurchase 
                            ? '0 0 15px rgba(255,255,255,0.1)' 
                            : 'none',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {augment.icon ? (
                          <SvgIcon 
                            src={augment.icon} 
                            className={`w-5 h-5 ${augment.special ? 'text-yellow-400' : 'text-white'}`}
                          />
                        ) : (
                          <Sparkles className={`w-4 h-4 ${augment.special ? 'text-yellow-400' : 'text-white'}`} />
                        )}
                        <span className={`font-display font-bold text-lg ${
                          augment.special 
                            ? 'text-yellow-400' 
                            : !unlocked 
                              ? 'text-muted-foreground/70' 
                              : 'text-foreground'
                        }`}>
                          {augment.name}
                        </span>
                        {augment.special && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-yellow-500/20 text-yellow-400 rounded">
                            Special
                          </span>
                        )}
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
                    
                    <div className="flex flex-col items-end shrink-0 gap-1">
                      {/* Stack indicator */}
                      <div className="flex items-center gap-1 text-sm">
                        <span className={`font-display font-bold ${
                          augment.special 
                            ? stacks > 0 ? 'text-yellow-400' : 'text-yellow-400/50'
                            : stacks > 0 ? 'text-white' : 'text-muted-foreground'
                        }`}>
                          {stacks}
                        </span>
                        <span className={augment.special ? 'text-yellow-400/50' : 'text-muted-foreground'}>/</span>
                        <span className={augment.special ? 'text-yellow-400/50' : 'text-muted-foreground'}>{augment.maxStacks}</span>
                      </div>
                      
                      {/* Cost or Maxed indicator */}
                      {maxed ? (
                        <div className={`flex items-center gap-1 ${augment.special ? 'text-yellow-400' : 'text-white'}`}>
                          <Check className="w-4 h-4" />
                          <span className="text-xs font-bold">{augment.maxStacks === 1 ? 'OWNED' : 'MAXED'}</span>
                        </div>
                      ) : unlocked ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <Hexagon className={`w-4 h-4 ${augment.special ? 'text-yellow-400 fill-yellow-400/20' : 'text-white fill-white/20'}`} />
                            <span className={`text-lg font-display font-bold ${
                              augment.special 
                                ? canPurchase ? 'text-yellow-400' : 'text-yellow-400/50'
                                : canPurchase ? 'text-white' : 'text-muted-foreground'
                            }`}>
                              {augment.costPerStack}
                            </span>
                          </div>
                          {!affordable && (
                            <span className={`text-[10px] font-medium ${augment.special ? 'text-yellow-500/80' : 'text-danger/80'}`}>
                              Need {augment.costPerStack - totalAugmentPoints} more
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          {/* Back Button - mt-3 matches the gap-3 between store items */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={onBack}
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2 mt-[-0.75rem]"
          >
            <ArrowLeft className="w-5 h-5" />
            Continue
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
                className="bg-background border-2 border-white/50 rounded-xl p-6 max-w-sm w-full"
                style={{ boxShadow: '0 0 30px rgba(255,255,255,0.2)' }}
              >
                <h2 className="text-xl font-display font-bold text-white mb-4 text-center">
                  Purchase Stack?
                </h2>
                
                <div className="bg-white/10 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    {selectedAugment.icon ? (
                      <SvgIcon src={selectedAugment.icon} className="w-5 h-5 text-white" />
                    ) : (
                      <Sparkles className="w-5 h-5 text-white" />
                    )}
                    <span className="font-display font-bold text-foreground">{selectedAugment.name}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedAugment.description}</p>
                  <div className="mt-2 text-sm text-white">
                    Stack: {getStacks(selectedAugment.id)} → {getStacks(selectedAugment.id) + 1} / {selectedAugment.maxStacks}
                  </div>
                </div>

                <div className="flex justify-between items-center mb-6 px-2">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase">Cost</p>
                    <div className="flex items-center gap-1 justify-center">
                      <Hexagon className="w-4 h-4 text-danger fill-danger/20" />
                      <p className="text-xl font-display font-bold text-danger">-{selectedAugment.costPerStack}</p>
                    </div>
                  </div>
                  <div className="text-2xl text-muted-foreground">→</div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase">New Balance</p>
                    <div className="flex items-center gap-1 justify-center">
                      <Hexagon className="w-4 h-4 text-white fill-white/20" />
                      <p className="text-xl font-display font-bold text-foreground">
                        {totalAugmentPoints - selectedAugment.costPerStack}
                      </p>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground text-center mb-4">
                  This augment stack is <strong className="text-foreground">permanent</strong> and applies to all future runs.
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
                    <Plus className="w-4 h-4" />
                    Buy Stack
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showTutorial && (
        <TutorialOverlay
          visible
          title="AUGMENTATION WORKSHOP"
          body="Spend Augment Points on permanent upgrades that persist across all runs. Points are earned by completing levels. Each stack compounds your power."
          arrowDirection="none"
          onDismiss={() => onTutorialDismiss?.()}
        />
      )}
    </>
  );
}
