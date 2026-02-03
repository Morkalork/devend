import { useRef, useState, useEffect } from 'react';
import { Heart, Lock, Scissors, Target, Hexagon } from 'lucide-react';
import { UpgradeConfig } from '@/types/upgrade';
import { SvgIcon } from '@/components/ui/SvgIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface AugmentProgress {
  levelsCompleted: number;
  levelsToNextPoint: number;
  progressInCurrentPoint: number;
  pointsEarned: number;
  levelsPerPoint: number;
}

interface GameTopBarProps {
  levelNumber: number;
  cutsUsed: number;
  parCuts: number;
  lives: number;
  spaceRemaining: number;
  spaceRequired: number;
  lockedBalls: number;
  ownedUpgrades: UpgradeConfig[];
  accentColor?: string;
  augmentProgress?: AugmentProgress;
}

export function GameTopBar({
  levelNumber,
  cutsUsed,
  parCuts,
  lives,
  spaceRemaining,
  spaceRequired,
  lockedBalls,
  ownedUpgrades,
  accentColor = '#00ff88',
  augmentProgress,
}: GameTopBarProps) {
  const upgradesContainerRef = useRef<HTMLDivElement>(null);
  const [needsCarousel, setNeedsCarousel] = useState(false);
  const [openTooltipId, setOpenTooltipId] = useState<string | null>(null);

  // Check if carousel is needed based on container width
  useEffect(() => {
    const checkOverflow = () => {
      const container = upgradesContainerRef.current;
      if (container) {
        setNeedsCarousel(container.scrollWidth > container.clientWidth);
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [ownedUpgrades]);

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openTooltipId) {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-upgrade-icon]')) {
          setOpenTooltipId(null);
        }
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openTooltipId]);

  const handleUpgradeClick = (upgradeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTooltipId(prev => prev === upgradeId ? null : upgradeId);
  };

  const hasUpgrades = ownedUpgrades.length > 0;

  return (
    <div className="flex-shrink-0 flex flex-col gap-1">
      {/* Row 1: Game Status Bar - Always Visible */}
      <div 
        className="px-3 py-2 flex items-center justify-between gap-2"
        style={{ 
          backgroundColor: 'rgba(0, 10, 5, 0.9)',
          borderBottom: `2px solid ${accentColor}44`,
        }}
      >
        {/* Level Number */}
        <div 
          className="flex items-center gap-1 min-w-0"
          style={{ color: accentColor }}
        >
          <span 
            className="font-display text-base font-bold"
            style={{ 
              textShadow: `0 0 10px ${accentColor}88`,
            }}
          >
            LV{levelNumber}
          </span>
        </div>

        {/* Cuts / Par */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Scissors 
            className="w-5 h-5 flex-shrink-0" 
            style={{ color: accentColor }}
          />
          <span 
            className="font-display text-base font-bold tabular-nums"
            style={{ 
              color: cutsUsed > parCuts ? '#ff6b6b' : accentColor,
              textShadow: `0 0 10px ${cutsUsed > parCuts ? '#ff6b6b' : accentColor}88`,
            }}
          >
            {cutsUsed}/{parCuts}
          </span>
        </div>

        {/* Lives - Hearts with pulse animation */}
        <div className="flex items-center gap-1">
          {Array.from({ length: lives }).map((_, i) => (
            <Heart
              key={i}
              className="w-5 h-5 animate-pulse-heart"
              style={{ 
                color: accentColor,
                fill: accentColor,
                filter: `drop-shadow(0 0 6px ${accentColor}aa)`,
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>

        {/* Space Remaining / Required */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Target 
            className="w-5 h-5 flex-shrink-0" 
            style={{ color: accentColor }}
          />
          <span 
            className="font-display text-base font-bold tabular-nums"
            style={{ 
              color: spaceRemaining <= spaceRequired ? accentColor : 'hsl(var(--foreground))',
              textShadow: spaceRemaining <= spaceRequired 
                ? `0 0 10px ${accentColor}88` 
                : 'none',
            }}
          >
            {spaceRemaining}%/{spaceRequired}%
          </span>
        </div>

        {/* Locked Balls */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Lock 
            className="w-5 h-5 flex-shrink-0" 
            style={{ color: accentColor, opacity: 0.6 }}
          />
          <span 
            className="font-display text-base font-bold tabular-nums"
            style={{ 
              color: accentColor,
              opacity: 0.6,
            }}
          >
            {lockedBalls}
          </span>
        </div>

        {/* Augment Progress */}
        {augmentProgress && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Hexagon 
              className="w-5 h-5 flex-shrink-0" 
              style={{ 
                color: '#ffffff',
                fill: augmentProgress.pointsEarned > 0 ? 'rgba(255,255,255,0.3)' : 'transparent',
              }}
            />
            <span 
              className="font-display text-base font-bold tabular-nums"
              style={{ 
                color: '#ffffff',
                textShadow: augmentProgress.pointsEarned > 0 ? '0 0 8px rgba(255,255,255,0.6)' : 'none',
              }}
            >
              {augmentProgress.progressInCurrentPoint}/{augmentProgress.levelsPerPoint}
            </span>
          </div>
        )}
      </div>

      {/* Row 2: Upgrades Bar - Conditional */}
      {hasUpgrades && (
        <div 
          className="px-3 py-1.5"
          style={{ 
            backgroundColor: 'rgba(0, 10, 5, 0.8)',
            borderBottom: `1px solid ${accentColor}33`,
          }}
        >
          <TooltipProvider delayDuration={0}>
            <div
              ref={upgradesContainerRef}
              className={`flex items-center gap-2 ${
                needsCarousel 
                  ? 'overflow-x-auto scrollbar-hide touch-pan-x' 
                  : 'justify-center'
              }`}
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            >
              {ownedUpgrades.map((upgrade) => (
                <Tooltip 
                  key={upgrade.id} 
                  open={openTooltipId === upgrade.id}
                  onOpenChange={(open) => {
                    if (!open && openTooltipId === upgrade.id) {
                      setOpenTooltipId(null);
                    }
                  }}
                >
                  <TooltipTrigger asChild>
                    <button
                      data-upgrade-icon
                      onClick={(e) => handleUpgradeClick(upgrade.id, e)}
                      className="flex-shrink-0 w-8 h-8 rounded-md p-1 flex items-center justify-center transition-all duration-200 hover:scale-110 focus:outline-none focus:ring-1"
                      style={{ 
                        backgroundColor: `${accentColor}18`,
                        border: `1px solid ${accentColor}55`,
                        boxShadow: openTooltipId === upgrade.id 
                          ? `0 0 12px ${accentColor}88` 
                          : 'none',
                        color: accentColor,
                      }}
                      aria-label={upgrade.name}
                    >
                      <SvgIcon
                        src={upgrade.icon}
                        className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                        alt={upgrade.name}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    sideOffset={10}
                    className="max-w-[220px] z-50"
                    style={{
                      backgroundColor: 'rgba(0, 20, 10, 0.95)',
                      border: `1px solid ${accentColor}77`,
                      boxShadow: `0 0 24px ${accentColor}44`,
                    }}
                  >
                    <div className="space-y-1.5">
                      <p 
                        className="font-display font-bold text-base"
                        style={{ color: accentColor }}
                      >
                        {upgrade.name}
                      </p>
                      <p 
                        className="text-sm leading-relaxed"
                        style={{ color: 'hsl(var(--foreground) / 0.85)' }}
                      >
                        {upgrade.description}
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
