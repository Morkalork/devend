import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UpgradeConfig, TIER_COLORS, UpgradeTier } from '@/types/upgrade';
import { Clock, ArrowRight, Lock, Check, Medal } from 'lucide-react';
import { CRTBackground } from './CRTBackground';
import { TutorialOverlay } from './TutorialOverlay';
import { Certificate } from '@/types/certificate';

interface UpgradeShopProps {
  playerPoints: number;
  upgrades: UpgradeConfig[];
  ownedUpgradeIds: string[];
  completedLevel: number;
  canPurchase: (upgradeId: string, playerScore: number, ownedIds: string[]) => boolean;
  isLocked: (upgradeId: string, ownedIds: string[]) => boolean;
  onPurchase: (upgradeId: string, price: number) => void;
  onContinue: () => void;
  accentColor?: string;
  extraShopItems?: number;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
  newlyUnlockedCerts?: Certificate[];
}

/** Shuffle array using Fisher-Yates */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function UpgradeShop({
  playerPoints,
  upgrades,
  ownedUpgradeIds,
  completedLevel,
  canPurchase,
  isLocked,
  onPurchase,
  onContinue,
  accentColor,
  extraShopItems = 0,
  showTutorial = false,
  onTutorialDismiss,
  newlyUnlockedCerts = [],
}: UpgradeShopProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [purchasedThisSession, setPurchasedThisSession] = useState<string[]>([]);
  const [lockedInfoId, setLockedInfoId] = useState<string | null>(null);
  const [shakingId, setShakingId] = useState<string | null>(null);

  const shopSlots = 3 + extraShopItems;

  // Pick random offers once on mount (restock only between levels)
  const [offeredUpgrades] = useState<UpgradeConfig[]>(() => {
    // Filter out owned and upgrades not yet unlocked by level progression
    const available = upgrades.filter(u =>
      !ownedUpgradeIds.includes(u.id) &&
      completedLevel >= (u.unlockLevel ?? 1)
    );
    const unlocked = available.filter(u => {
      if (!u.prerequisites || u.prerequisites.length === 0) return true;
      return u.prerequisites.every(p => ownedUpgradeIds.includes(p));
    });
    const locked = available.filter(u => {
      if (!u.prerequisites || u.prerequisites.length === 0) return false;
      return u.prerequisites.some(p => !ownedUpgradeIds.includes(p));
    });
    const picked = shuffle(unlocked).slice(0, shopSlots);
    // Add at most one locked item if there's room
    if (picked.length < shopSlots && locked.length > 0) {
      picked.push(shuffle(locked)[0]);
    }
    return picked;
  });

  // Combine owned with session purchases
  const allOwnedIds = useMemo(() => 
    [...ownedUpgradeIds, ...purchasedThisSession], 
    [ownedUpgradeIds, purchasedThisSession]
  );

  // Effective overtime - playerPoints (totalScore) is already reduced by onPurchase
  const effectiveOvertime = playerPoints;

  // Budget remaining after currently selected items
  const selectedTotalCost = selectedIds.reduce((sum, id) => {
    const u = offeredUpgrades.find(u => u.id === id);
    return sum + (u?.cost ?? 0);
  }, 0);
  const remainingBudget = effectiveOvertime - selectedTotalCost;

  const handleItemClick = useCallback((upgrade: UpgradeConfig, alreadySelected: boolean, currentRemainingBudget: number) => {
    if (allOwnedIds.includes(upgrade.id)) return;
    if (isLocked(upgrade.id, allOwnedIds)) return;

    // Deselect if already selected
    if (alreadySelected) {
      setSelectedIds(prev => prev.filter(id => id !== upgrade.id));
      return;
    }

    // Can't afford — shake instead of toast
    if (upgrade.cost > currentRemainingBudget) {
      setShakingId(upgrade.id);
      setTimeout(() => setShakingId(null), 600);
      return;
    }

    setSelectedIds(prev => [...prev, upgrade.id]);
  }, [allOwnedIds, isLocked]);

  const handleContinue = useCallback(() => {
    for (const id of selectedIds) {
      const upgrade = offeredUpgrades.find(u => u.id === id);
      if (upgrade) {
        onPurchase(upgrade.id, upgrade.cost);
        setPurchasedThisSession(prev => [...prev, upgrade.id]);
      }
    }
    onContinue();
  }, [selectedIds, offeredUpgrades, onPurchase, onContinue]);

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-6 z-50 overflow-y-auto"
      >
        {/* Store label — vertical mid-left on mobile, rotated corner on desktop */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="fixed left-2 top-1/2 -translate-y-1/2 md:top-8 md:left-8 md:translate-y-0 md:origin-top-left"
        >
          <span
            className="inline-block text-2xl font-bold text-foreground/30 tracking-widest uppercase [transform:rotate(-90deg)] md:[transform:rotate(-45deg)]"
          >
            Store
          </span>
        </motion.div>

        {/* Level completed */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="text-sm text-muted-foreground"
        >
          Level {completedLevel} complete
        </motion.div>

        {/* Waypoint banner — shown only on multiples of 5 */}
        {completedLevel % 5 === 0 && (
          <motion.div
            initial={{ scale: 0.75, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-full max-w-sm flex flex-col items-center gap-1 rounded-xl px-6 py-4"
            style={{
              background: 'linear-gradient(135deg, #00ff8812 0%, #00ff8820 100%)',
              border: '2px solid #00ff88',
              boxShadow: '0 0 24px #00ff8866, 0 0 48px #00ff8833, inset 0 0 24px #00ff8808',
            }}
          >
            {/* Pulsing glow ring */}
            <motion.div
              animate={{ boxShadow: ['0 0 0px #00ff8800', '0 0 32px #00ff8888', '0 0 0px #00ff8800'] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-xl pointer-events-none"
            />

            <motion.p
              animate={{ opacity: [1, 0.7, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="text-xs font-bold tracking-[0.3em] uppercase"
              style={{ fontFamily: 'Orbitron, sans-serif', color: '#00ff88' }}
            >
              ⚑ &nbsp;checkpoint reached&nbsp; ⚑
            </motion.p>

            <motion.p
              animate={{ textShadow: ['0 0 8px #00ff8888', '0 0 24px #00ff88cc', '0 0 8px #00ff8888'] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="text-4xl font-black tracking-widest"
              style={{ fontFamily: 'Orbitron, sans-serif', color: '#00ff88' }}
            >
              LEVEL {completedLevel}
            </motion.p>

            <p
              className="text-xs tracking-widest uppercase"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: '#4a7a5a' }}
            >
              progress will be saved here
            </p>
          </motion.div>
        )}

        {/* Overtime display */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center gap-2 text-xl"
        >
          <Clock className="w-6 h-6 text-yellow-500" />
          <span className="font-semibold text-foreground">{effectiveOvertime}h</span>
          <span className="text-muted-foreground">overtime</span>
        </motion.div>

        {/* Upgrade Tree */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex flex-wrap justify-center gap-4 max-w-5xl"
        >
          {offeredUpgrades.map((upgrade, index) => {
                const owned = allOwnedIds.includes(upgrade.id);
                const locked = isLocked(upgrade.id, allOwnedIds);
                const selected = selectedIds.includes(upgrade.id);
                const purchasable = canPurchase(upgrade.id, effectiveOvertime, allOwnedIds);
                // Can't afford with remaining budget (unless already selected)
                const cantAfford = !locked && !owned && !selected && upgrade.cost > remainingBudget;
                const tierColors = TIER_COLORS[upgrade.tier];

            return (
              <motion.div
                key={upgrade.id}
                animate={shakingId === upgrade.id ? { x: [-10, 10, -8, 8, -4, 4, 0] } : { x: 0 }}
                transition={shakingId === upgrade.id ? { duration: 0.5, type: 'tween' } : { duration: 0 }}
              >
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handleItemClick(upgrade, selected, remainingBudget)}
                disabled={owned || locked}
                whileHover={{ scale: purchasable ? 1.05 : 1 }}
                whileTap={{ scale: purchasable ? 0.95 : 1 }}
                className={`
                  relative w-44 p-3 rounded-lg transition-all duration-200 text-center
                  ${cantAfford ? 'border-dashed' : ''} border-2
                  ${selected ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-black' : ''}
                  ${owned
                    ? 'bg-green-500/20 border-green-500/50'
                    : locked
                      ? 'bg-muted/30 border-muted/30 opacity-40 cursor-not-allowed'
                      : purchasable
                        ? `bg-card ${tierColors.border} hover:border-primary cursor-pointer`
                        : cantAfford
                          ? 'bg-card/50 border-muted-foreground/30 opacity-60 cursor-pointer'
                          : 'bg-card/50 border-muted cursor-not-allowed opacity-40'
                  }
                `}
              >
                {/* Tier badge */}
                <div className={`text-xs font-medium mb-1 ${tierColors.text}`}>
                  {upgrade.tier}
                </div>

                {/* Name */}
                <div className="text-sm font-semibold text-foreground mb-1 truncate">
                  {upgrade.name}
                </div>

                {/* Status icon */}
                {selected && (
                  <div className="absolute top-1 right-1">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                {owned && (
                  <div className="absolute top-1 right-1">
                    <Check className="w-3 h-3 text-green-500" />
                  </div>
                )}
                {locked && !owned && (
                  <div
                    className="absolute top-1 right-1 cursor-help"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLockedInfoId(prev => prev === upgrade.id ? null : upgrade.id);
                    }}
                  >
                    <Lock className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
                {locked && !owned && lockedInfoId === upgrade.id && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full z-10 bg-popover border border-border rounded px-2 py-1 text-[10px] text-muted-foreground whitespace-nowrap shadow-md">
                    Requires: {(upgrade.prerequisites || []).filter(p => !allOwnedIds.includes(p)).map(p => {
                      const prereq = upgrades.find(u => u.id === p);
                      return prereq ? prereq.name : p;
                    }).join(', ')}
                  </div>
                )}

                {/* Description */}
                <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                  {upgrade.description}
                </p>

                {/* Cost */}
                {!owned && (
                  <div className={`flex items-center justify-center gap-1 text-sm font-bold
                    ${purchasable ? 'text-yellow-500' : 'text-muted-foreground'}
                  `}>
                    <Clock className="w-4 h-4" />
                    {upgrade.cost}h
                  </div>
                )}
              </motion.button>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Certificate unlock banner */}
        {newlyUnlockedCerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            {newlyUnlockedCerts.map(cert => (
              <div
                key={cert.id}
                className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10"
              >
                <Medal className="w-4 h-4 text-yellow-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider">Certificate Unlocked!</p>
                  <p className="text-sm text-foreground font-semibold">{cert.name}</p>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* Continue Button */}
        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={handleContinue}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="arcade-button-primary rounded-lg flex items-center gap-2 text-sm whitespace-nowrap"
        >
          {selectedIds.length > 0 ? `Buy ${selectedIds.length} & Continue (${selectedTotalCost}h)` : 'Continue'}
          <ArrowRight className="w-5 h-5" />
        </motion.button>
      </motion.div>

      {showTutorial && (
        <TutorialOverlay
          visible
          title="THE UPGRADE SHOP"
          body="Spend overtime hours on upgrades after each map. Overtime upgrades multiply future earnings. Effects appear in the bottom bar on the next map."
          arrowDirection="none"
          onDismiss={() => onTutorialDismiss?.()}
        />
      )}
    </>
  );
}
