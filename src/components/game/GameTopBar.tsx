import { useRef, useState, useEffect } from 'react';
import { Heart, Lock, Scissors, Target } from 'lucide-react';
import { UpgradeConfig } from '@/types/upgrade';
import { SvgIcon } from '@/components/ui/SvgIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface GameTopBarProps {
  cutsUsed: number;
  parCuts: number;
  lives: number;
  spaceRemaining: number;
  spaceRequired: number;
  lockedBalls: number;
  ownedUpgrades: UpgradeConfig[];
  accentColor?: string;
}

export function GameTopBar({
  cutsUsed,
  parCuts,
  lives,
  spaceRemaining,
  spaceRequired,
  lockedBalls,
  ownedUpgrades,
  accentColor = '#00ff88',
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
    <div className="flex-shrink-0 flex flex-col gap-0.5">
      {/* Row 1: Game Status Bar - Always Visible */}
      <div 
        className="px-2 py-1 flex items-center justify-between gap-1"
        style={{ 
          backgroundColor: 'rgba(0, 10, 5, 0.85)',
          borderBottom: `1px solid ${accentColor}33`,
        }}
      >
        {/* Cuts / Par */}
        <div className="flex items-center gap-1 min-w-0">
          <Scissors 
            className="w-3.5 h-3.5 flex-shrink-0" 
            style={{ color: accentColor }}
          />
          <span 
            className="font-display text-xs font-bold tabular-nums"
            style={{ 
              color: cutsUsed > parCuts ? '#ff6b6b' : accentColor,
              textShadow: `0 0 8px ${cutsUsed > parCuts ? '#ff6b6b' : accentColor}66`,
            }}
          >
            {cutsUsed}/{parCuts}
          </span>
        </div>

        {/* Lives - Hearts with pulse animation */}
        <div className="flex items-center gap-0.5">
          {Array.from({ length: lives }).map((_, i) => (
            <Heart
              key={i}
              className="w-3.5 h-3.5 animate-pulse-heart"
              style={{ 
                color: accentColor,
                fill: accentColor,
                filter: `drop-shadow(0 0 4px ${accentColor}88)`,
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>

        {/* Space Remaining / Required */}
        <div className="flex items-center gap-1 min-w-0">
          <Target 
            className="w-3.5 h-3.5 flex-shrink-0" 
            style={{ color: accentColor }}
          />
          <span 
            className="font-display text-xs font-bold tabular-nums"
            style={{ 
              color: spaceRemaining <= spaceRequired ? accentColor : 'hsl(var(--foreground))',
              textShadow: spaceRemaining <= spaceRequired 
                ? `0 0 8px ${accentColor}66` 
                : 'none',
            }}
          >
            {spaceRemaining}%/{spaceRequired}%
          </span>
        </div>

        {/* Locked Balls */}
        <div className="flex items-center gap-1 min-w-0">
          <Lock 
            className="w-3.5 h-3.5 flex-shrink-0" 
            style={{ color: accentColor, opacity: 0.6 }}
          />
          <span 
            className="font-display text-xs font-bold tabular-nums"
            style={{ 
              color: accentColor,
              opacity: 0.6,
            }}
          >
            {lockedBalls}
          </span>
        </div>
      </div>

      {/* Row 2: Upgrades Bar - Conditional */}
      {hasUpgrades && (
        <div 
          className="px-2 py-1"
          style={{ 
            backgroundColor: 'rgba(0, 10, 5, 0.75)',
            borderBottom: `1px solid ${accentColor}22`,
          }}
        >
          <TooltipProvider delayDuration={0}>
            <div
              ref={upgradesContainerRef}
              className={`flex items-center gap-1.5 ${
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
                      className="flex-shrink-0 w-6 h-6 rounded p-0.5 flex items-center justify-center transition-all duration-200 hover:scale-110 focus:outline-none focus:ring-1"
                      style={{ 
                        backgroundColor: `${accentColor}15`,
                        border: `1px solid ${accentColor}44`,
                        boxShadow: openTooltipId === upgrade.id 
                          ? `0 0 8px ${accentColor}66` 
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
                    sideOffset={8}
                    className="max-w-[200px] z-50"
                    style={{
                      backgroundColor: 'rgba(0, 20, 10, 0.95)',
                      border: `1px solid ${accentColor}66`,
                      boxShadow: `0 0 20px ${accentColor}33`,
                    }}
                  >
                    <div className="space-y-1">
                      <p 
                        className="font-display font-bold text-sm"
                        style={{ color: accentColor }}
                      >
                        {upgrade.name}
                      </p>
                      <p 
                        className="text-xs leading-relaxed"
                        style={{ color: 'hsl(var(--foreground) / 0.8)' }}
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
