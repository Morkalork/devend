import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UpgradeConfig, TIER_COLORS, UpgradeTier } from '@/types/upgrade';
import { Clock, ArrowRight, Lock, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CRTBackground } from './CRTBackground';

interface UpgradeShopProps {
  playerPoints: number;
  upgrades: UpgradeConfig[];
  ownedUpgradeIds: string[];
  canPurchase: (upgradeId: string, playerScore: number, ownedIds: string[]) => boolean;
  isLocked: (upgradeId: string, ownedIds: string[]) => boolean;
  onPurchase: (upgradeId: string, price: number) => void;
  onContinue: () => void;
  accentColor?: string;
  extraShopItems?: number;
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
  canPurchase,
  isLocked,
  onPurchase,
  onContinue,
  accentColor,
  extraShopItems = 0,
}: UpgradeShopProps) {
  const { toast } = useToast();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [purchasedThisSession, setPurchasedThisSession] = useState<string[]>([]);
  const [lockedInfoId, setLockedInfoId] = useState<string | null>(null);

  const shopSlots = 3 + extraShopItems;

  // Pick random offers once on mount (restock only between levels)
  const [offeredUpgrades] = useState<UpgradeConfig[]>(() => {
    const available = upgrades.filter(u => !ownedUpgradeIds.includes(u.id));
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

  // Effective overtime after session purchases
  const effectiveOvertime = useMemo(() => {
    let spent = 0;
    for (const id of purchasedThisSession) {
      const u = upgrades.find(u => u.id === id);
      if (u) spent += u.cost;
    }
    return playerPoints - spent;
  }, [playerPoints, purchasedThisSession, upgrades]);

  const handlePurchase = useCallback((upgrade: UpgradeConfig) => {
    if (allOwnedIds.includes(upgrade.id)) return;
    
    if (!canPurchase(upgrade.id, effectiveOvertime, allOwnedIds)) {
      if (effectiveOvertime < upgrade.cost) {
        toast({
          title: "Not enough overtime",
          description: `You need ${upgrade.cost - effectiveOvertime}h more.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Prerequisites required",
          description: `Complete prerequisite upgrades first.`,
          variant: "destructive",
        });
      }
      return;
    }

    onPurchase(upgrade.id, upgrade.cost);
    setPurchasedThisSession(prev => [...prev, upgrade.id]);
  }, [allOwnedIds, canPurchase, effectiveOvertime, onPurchase, toast]);

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-6 z-50 overflow-y-auto"
      >
        {/* Rotated corner title */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="fixed top-8 left-8 origin-top-left"
        >
          <span 
            className="text-2xl font-bold text-foreground/30 tracking-widest uppercase"
            style={{ transform: 'rotate(-45deg)', display: 'inline-block' }}
          >
            Store
          </span>
        </motion.div>

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
                const purchasable = canPurchase(upgrade.id, effectiveOvertime, allOwnedIds);
                const cantAfford = !locked && !owned && effectiveOvertime < upgrade.cost;
                const tierColors = TIER_COLORS[upgrade.tier];

            return (
              <motion.button
                key={upgrade.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handlePurchase(upgrade)}
                disabled={owned || locked}
                onMouseEnter={() => setHoveredId(upgrade.id)}
                onMouseLeave={() => setHoveredId(null)}
                whileHover={{ scale: purchasable ? 1.05 : 1 }}
                whileTap={{ scale: purchasable ? 0.95 : 1 }}
                className={`
                  relative w-36 p-3 rounded-lg border-2 transition-all duration-200 text-center
                  ${owned
                    ? 'bg-green-500/20 border-green-500/50'
                    : locked
                      ? 'bg-muted/30 border-muted/30 opacity-40 cursor-not-allowed'
                      : purchasable 
                        ? `bg-card ${tierColors.border} hover:border-primary cursor-pointer` 
                        : cantAfford
                          ? `bg-card/50 ${tierColors.border} opacity-60 cursor-pointer`
                          : 'bg-card/50 border-muted cursor-not-allowed opacity-40'
                  }
                `}
              >
                {/* Tier badge */}
                <div className={`text-[10px] font-medium mb-1 ${tierColors.text}`}>
                  {upgrade.tier}
                </div>

                {/* Name */}
                <div className="text-xs font-semibold text-foreground mb-1 truncate">
                  {upgrade.name}
                </div>

                {/* Status icon */}
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
                <p className="text-[10px] text-muted-foreground line-clamp-2 mb-1">
                  {upgrade.description}
                </p>

                {/* Cost */}
                {!owned && (
                  <div className={`flex items-center justify-center gap-1 text-xs font-bold
                    ${purchasable ? 'text-yellow-500' : 'text-muted-foreground'}
                  `}>
                    <Clock className="w-3 h-3" />
                    {upgrade.cost}h
                  </div>
                )}
              </motion.button>
            );
          })}
        </motion.div>

        {/* Continue Button */}
        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={onContinue}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="arcade-button-primary rounded-lg flex items-center gap-2"
        >
          Continue
          <ArrowRight className="w-5 h-5" />
        </motion.button>
      </motion.div>
    </>
  );
}
