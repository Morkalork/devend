import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UpgradeConfig, GRADE_WEIGHTS, GRADE_COLORS, UpgradeGrade } from '@/types/upgrade';
import { Coins, ArrowRight, Info, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { SvgIcon } from '@/components/ui/SvgIcon';
import { CRTBackground } from './CRTBackground';

interface UpgradeOffer {
  upgrade: UpgradeConfig;
  price: number;
}

interface UpgradeShopProps {
  playerPoints: number;
  levelNumber: number;
  upgrades: UpgradeConfig[];
  ownedUpgradeIds: string[];
  onPurchase: (upgradeId: string, price: number) => void;
  onContinue: () => void;
  accentColor?: string;
}

function computeBasePrice(upgrade: UpgradeConfig, levelNumber: number): number {
  const levelsSinceAvail = Math.max(0, levelNumber - upgrade.levelAvailability);
  const decaySteps = Math.floor(levelsSinceAvail / 2);
  const effectiveMax = Math.max(upgrade.priceMin, upgrade.priceMax - decaySteps);
  // Random integer between priceMin and effectiveMax inclusive
  return Math.floor(Math.random() * (effectiveMax - upgrade.priceMin + 1)) + upgrade.priceMin;
}

// Weighted random selection without replacement
function weightedRandomSelect<T extends { grade: UpgradeGrade }>(
  items: T[],
  count: number
): T[] {
  if (items.length === 0) return [];
  
  const selected: T[] = [];
  const remaining = [...items];
  
  while (selected.length < count && remaining.length > 0) {
    // Calculate total weight
    const totalWeight = remaining.reduce((sum, item) => sum + GRADE_WEIGHTS[item.grade], 0);
    
    // Pick a random value in [0, totalWeight)
    let random = Math.random() * totalWeight;
    
    // Find the item that corresponds to this random value
    for (let i = 0; i < remaining.length; i++) {
      random -= GRADE_WEIGHTS[remaining[i].grade];
      if (random <= 0) {
        selected.push(remaining[i]);
        remaining.splice(i, 1);
        break;
      }
    }
  }
  
  return selected;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function UpgradeShop({
  playerPoints,
  levelNumber,
  upgrades,
  ownedUpgradeIds,
  onPurchase,
  onContinue,
  accentColor,
}: UpgradeShopProps) {
  const { toast } = useToast();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [purchasedThisSession, setPurchasedThisSession] = useState<string[]>([]);

  // Get active modifiers from owned upgrades (excluding purchases made this session for shop slots calculation)
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades);
  
  // Calculate shop slots (base 3 + shopSlots modifier)
  const shopSlotCount = 3 + activeModifiers.shopSlots;

  // Count how many of each upgrade the player owns
  const getOwnedCount = useCallback((upgradeId: string) => {
    return ownedUpgradeIds.filter(id => id === upgradeId).length;
  }, [ownedUpgradeIds]);

  // Compute offers ONCE when shop opens - use useState with initializer to prevent re-randomizing
  const [offers] = useState<UpgradeOffer[]>(() => {
    const eligible = upgrades.filter(upgrade => {
      const isAvailable = levelNumber >= upgrade.levelAvailability;
      const isNotRemoved = upgrade.levelRemoved === undefined || levelNumber <= upgrade.levelRemoved;
      
      // Check if player can still buy more copies (maxCount defaults to 1)
      const maxCount = upgrade.maxCount ?? 1;
      const ownedCount = ownedUpgradeIds.filter(id => id === upgrade.id).length;
      const canBuyMore = ownedCount < maxCount;
      
      return isAvailable && isNotRemoved && canBuyMore;
    });

    // Use weighted random selection based on grade
    const selected = weightedRandomSelect(eligible, shopSlotCount);
    
    return selected.map(upgrade => {
      const basePrice = computeBasePrice(upgrade, levelNumber);
      // Apply price multiplier and round, minimum 1
      const finalPrice = Math.max(1, Math.round(basePrice * activeModifiers.priceMultiplier));
      return {
        upgrade,
        price: finalPrice,
      };
    });
  });

  const handlePurchase = useCallback((offer: UpgradeOffer) => {
    // Check if already purchased this session
    if (purchasedThisSession.includes(offer.upgrade.id)) {
      return;
    }
    
    // Check if player has reached maxCount for this upgrade (including session purchases)
    const maxCount = offer.upgrade.maxCount ?? 1;
    const currentOwned = getOwnedCount(offer.upgrade.id);
    const sessionPurchases = purchasedThisSession.filter(id => id === offer.upgrade.id).length;
    
    if (currentOwned + sessionPurchases >= maxCount) {
      return; // Already at max count
    }
    
    if (playerPoints >= offer.price) {
      onPurchase(offer.upgrade.id, offer.price);
      setPurchasedThisSession(prev => [...prev, offer.upgrade.id]);
    } else {
      toast({
        title: "Not enough points",
        description: `You need ${offer.price - playerPoints} more points to buy ${offer.upgrade.name}.`,
        variant: "destructive",
      });
    }
  }, [playerPoints, onPurchase, purchasedThisSession, toast, getOwnedCount]);

  // Mobile long-press handling
  const handleTouchStart = useCallback((id: string) => {
    setPressedId(id);
  }, []);

  const handleTouchEnd = useCallback(() => {
    setPressedId(null);
  }, []);

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 z-50"
      >
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-center mb-8"
      >
        <h2 className="text-3xl font-bold text-foreground mb-2">Upgrade Shop</h2>
        <div className="flex items-center justify-center gap-2 text-xl">
          <Coins className="w-6 h-6 text-yellow-500" />
          <span className="font-semibold text-foreground">{playerPoints}</span>
          <span className="text-muted-foreground">points</span>
        </div>
      </motion.div>

      {/* Upgrade Cards - fixed min-height to prevent layout shift */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-wrap justify-center gap-4 mb-8 max-w-4xl min-h-[240px] items-start content-start"
      >
        <AnimatePresence mode="popLayout">
          {offers.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-muted-foreground text-center py-8"
            >
              No upgrades available at this level.
            </motion.p>
          ) : (
            offers.map((offer, index) => {
              const isPurchasedThisSession = purchasedThisSession.includes(offer.upgrade.id);
              const maxCount = offer.upgrade.maxCount ?? 1;
              const totalOwned = getOwnedCount(offer.upgrade.id) + 
                purchasedThisSession.filter(id => id === offer.upgrade.id).length;
              const isMaxed = totalOwned >= maxCount;
              const canAfford = playerPoints >= offer.price && !isMaxed;
              const isHovered = hoveredId === offer.upgrade.id;
              const isPressed = pressedId === offer.upgrade.id;
              const showDescription = isHovered || isPressed;
              const gradeColors = GRADE_COLORS[offer.upgrade.grade];

              return (
                <motion.div
                  key={offer.upgrade.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.1 }}
                  className="relative"
                  onMouseEnter={() => setHoveredId(offer.upgrade.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onTouchStart={() => handleTouchStart(offer.upgrade.id)}
                  onTouchEnd={handleTouchEnd}
                >
                  <motion.button
                    onClick={() => handlePurchase(offer)}
                    disabled={isMaxed}
                    whileHover={{ scale: !isMaxed ? 1.02 : 1 }}
                    whileTap={{ scale: !isMaxed ? 0.98 : 1 }}
                    className={`
                      relative w-48 h-56 p-4 rounded-xl border-2 transition-all duration-200 flex flex-col
                      ${isMaxed
                        ? 'bg-green-500/20 border-green-500/50 cursor-default'
                        : canAfford 
                          ? `bg-card ${gradeColors.border} hover:border-primary cursor-pointer` 
                          : 'bg-card/50 border-muted cursor-pointer opacity-60'
                      }
                    `}
                  >
                    {/* Grade badge */}
                    <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium ${gradeColors.bg} ${gradeColors.text}`}>
                      {capitalizeFirst(offer.upgrade.grade)}
                    </div>

                    {/* Owned count badge for stackable upgrades */}
                    {maxCount > 1 && totalOwned > 0 && (
                      <div className="absolute top-2 right-8 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/20 text-primary">
                        {totalOwned}/{maxCount}
                      </div>
                    )}

                    {/* Maxed overlay */}
                    {isMaxed && (
                      <div className="absolute inset-0 rounded-xl bg-green-500/10 flex items-center justify-center z-10">
                        <div className="bg-green-500 rounded-full p-2">
                          <Check className="w-6 h-6 text-white" />
                        </div>
                      </div>
                    )}

                    {/* Icon */}
                    <div className={`w-16 h-16 mx-auto mb-3 mt-4 rounded-lg bg-white flex items-center justify-center flex-shrink-0 ${isMaxed ? 'opacity-50' : ''}`}>
                      <SvgIcon 
                        src={offer.upgrade.icon} 
                        alt={offer.upgrade.name}
                        className="w-10 h-10 text-gray-900 [&>svg]:w-full [&>svg]:h-full"
                      />
                    </div>

                    {/* Name */}
                    <h3 className={`font-semibold text-foreground text-center mb-1 flex-shrink-0 ${isMaxed ? 'opacity-50' : ''}`}>
                      {offer.upgrade.name}
                    </h3>

                    {/* Description */}
                    <p className={`text-xs italic text-muted-foreground text-center mb-2 line-clamp-2 flex-grow ${isMaxed ? 'opacity-50' : ''}`}>
                      {offer.upgrade.description}
                    </p>

                    {/* Price or Maxed label */}
                    <div className="flex-shrink-0">
                      {isMaxed ? (
                        <div className="flex items-center justify-center gap-1 text-lg font-bold text-green-500">
                          {maxCount > 1 ? 'Maxed' : 'Owned'}
                        </div>
                      ) : (
                        <div className={`
                          flex items-center justify-center gap-1 text-lg font-bold
                          ${canAfford ? 'text-yellow-500' : 'text-muted-foreground'}
                        `}>
                          <Coins className="w-4 h-4" />
                          {offer.price}
                        </div>
                      )}
                    </div>

                    {/* Info hint */}
                    {!isMaxed && (
                      <div className="absolute top-2 right-2 text-muted-foreground">
                        <Info className="w-4 h-4" />
                      </div>
                    )}
                  </motion.button>

                  {/* Description tooltip */}
                  <AnimatePresence>
                    {showDescription && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 p-3 rounded-lg bg-popover border border-border shadow-lg z-10"
                      >
                        <div className={`text-xs font-medium mb-1 ${gradeColors.text}`}>
                          {capitalizeFirst(offer.upgrade.grade)}
                        </div>
                        <p className="text-sm text-popover-foreground">
                          {offer.upgrade.description}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
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
