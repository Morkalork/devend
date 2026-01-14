import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UpgradeConfig } from '@/types/upgrade';
import { Coins, ArrowRight, Info, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
}

function computePrice(upgrade: UpgradeConfig, levelNumber: number): number {
  const levelsSinceAvail = Math.max(0, levelNumber - upgrade.levelAvailability);
  const decaySteps = Math.floor(levelsSinceAvail / 2);
  const effectiveMax = Math.max(upgrade.priceMin, upgrade.priceMax - decaySteps);
  // Random integer between priceMin and effectiveMax inclusive
  return Math.floor(Math.random() * (effectiveMax - upgrade.priceMin + 1)) + upgrade.priceMin;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function UpgradeShop({
  playerPoints,
  levelNumber,
  upgrades,
  ownedUpgradeIds,
  onPurchase,
  onContinue,
}: UpgradeShopProps) {
  const { toast } = useToast();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [purchasedThisSession, setPurchasedThisSession] = useState<string[]>([]);

  // Compute eligible upgrades and select up to 3 random offers
  const offers = useMemo<UpgradeOffer[]>(() => {
    const eligible = upgrades.filter(upgrade => {
      const isAvailable = levelNumber >= upgrade.levelAvailability;
      const isNotRemoved = upgrade.levelRemoved === undefined || levelNumber <= upgrade.levelRemoved;
      const isNotOwned = !ownedUpgradeIds.includes(upgrade.id);
      return isAvailable && isNotRemoved && isNotOwned;
    });

    const selected = shuffleArray(eligible).slice(0, 3);
    
    return selected.map(upgrade => ({
      upgrade,
      price: computePrice(upgrade, levelNumber),
    }));
  }, [upgrades, levelNumber, ownedUpgradeIds]);

  const handlePurchase = useCallback((offer: UpgradeOffer) => {
    if (purchasedThisSession.includes(offer.upgrade.id)) {
      return; // Already purchased this session
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
  }, [playerPoints, onPurchase, purchasedThisSession, toast]);

  // Mobile long-press handling
  const handleTouchStart = useCallback((id: string) => {
    setPressedId(id);
  }, []);

  const handleTouchEnd = useCallback(() => {
    setPressedId(null);
  }, []);

  return (
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

      {/* Upgrade Cards */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-wrap justify-center gap-4 mb-8 max-w-3xl"
      >
        <AnimatePresence>
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
              const isOwned = purchasedThisSession.includes(offer.upgrade.id);
              const canAfford = playerPoints >= offer.price && !isOwned;
              const isHovered = hoveredId === offer.upgrade.id;
              const isPressed = pressedId === offer.upgrade.id;
              const showDescription = isHovered || isPressed;

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
                    disabled={isOwned}
                    whileHover={{ scale: !isOwned ? 1.02 : 1 }}
                    whileTap={{ scale: !isOwned ? 0.98 : 1 }}
                    className={`
                      relative w-48 p-4 rounded-xl border-2 transition-all duration-200
                      ${isOwned
                        ? 'bg-green-500/20 border-green-500/50 cursor-default'
                        : canAfford 
                          ? 'bg-card border-primary/50 hover:border-primary cursor-pointer' 
                          : 'bg-card/50 border-muted cursor-pointer opacity-60'
                      }
                    `}
                  >
                    {/* Owned overlay */}
                    {isOwned && (
                      <div className="absolute inset-0 rounded-xl bg-green-500/10 flex items-center justify-center z-10">
                        <div className="bg-green-500 rounded-full p-2">
                          <Check className="w-6 h-6 text-white" />
                        </div>
                      </div>
                    )}

                    {/* Icon */}
                    <div className={`w-16 h-16 mx-auto mb-3 rounded-lg bg-primary/10 flex items-center justify-center ${isOwned ? 'opacity-50' : ''}`}>
                      <img 
                        src={offer.upgrade.icon} 
                        alt={offer.upgrade.name}
                        className="w-10 h-10 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>

                    {/* Name */}
                    <h3 className={`font-semibold text-foreground text-center mb-2 ${isOwned ? 'opacity-50' : ''}`}>
                      {offer.upgrade.name}
                    </h3>

                    {/* Price or Owned label */}
                    {isOwned ? (
                      <div className="flex items-center justify-center gap-1 text-lg font-bold text-green-500">
                        Owned
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

                    {/* Info hint */}
                    {!isOwned && (
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
                        <p className="text-sm text-popover-foreground text-center">
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
        className="arcade-button-secondary rounded-lg flex items-center gap-2"
      >
        Continue
        <ArrowRight className="w-5 h-5" />
      </motion.button>
    </motion.div>
  );
}
