/**
 * GameTopBar — compact status bar above the board: level, cuts vs par,
 * lives, space cleared, locked balls, owned upgrade icons and
 * certificate-hour progress. Tapping it opens TopBarDetailsPanel.
 */
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Lock, Scissors, Target, Hexagon, ChevronDown, RotateCcw } from 'lucide-react';
import { UpgradeConfig, UpgradeTier } from '@/types/upgrade';
import { getUpgradeIcon } from './upgradeIcons';
import { contentText } from '@/i18n/content';

/**
 * Tier rank shown as a small signal-strength meter (1–3 bars) in the corner
 * of each upgrade icon. Architect/Wizard cap out at the full three bars.
 */
const TIER_BARS: Record<UpgradeTier, number> = {
  Junior: 1,
  Senior: 2,
  Principal: 3,
  Architect: 3,
  Wizard: 3,
};

/** Strict tier ordering, used to pick the highest tier owned within a family. */
const TIER_RANK: Record<UpgradeTier, number> = {
  Junior: 1,
  Senior: 2,
  Principal: 3,
  Architect: 4,
  Wizard: 5,
};

/**
 * Collapse owned upgrades to one entry per family (shared `name`), keeping the
 * highest tier bought. Owning Junior + Senior + Principal of the same upgrade
 * shows a single icon whose tier meter reflects the top tier, rather than three
 * separate icons. Family order follows first appearance in the owned list.
 */
function groupUpgradesByFamily(owned: UpgradeConfig[]): UpgradeConfig[] {
  const byFamily = new Map<string, UpgradeConfig>();
  for (const upgrade of owned) {
    const existing = byFamily.get(upgrade.name);
    if (!existing || TIER_RANK[upgrade.tier] > TIER_RANK[existing.tier]) {
      byFamily.set(upgrade.name, upgrade);
    }
  }
  return [...byFamily.values()];
}
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CertificateHourProgress {
  levelsCompleted: number;
  levelsToNextHour: number;
  progressInCurrentHour: number;
  hoursEarned: number;
  levelsPerHour: number;
}

interface GameTopBarProps {
  levelNumber: number;
  cutsUsed: number;
  parCuts: number;
  lives: number;
  continuesRemaining?: number;
  spaceRemaining: number;
  spaceRequired: number;
  lockedBalls: number;
  threadLockRequired?: number;
  ownedUpgrades: UpgradeConfig[];
  accentColor?: string;
  certificateProgress?: CertificateHourProgress;
  microManagerPerLock?: number;
  ascensionDepth?: number;
  onExpand?: () => void;
}

export function GameTopBar({
  levelNumber,
  cutsUsed,
  parCuts,
  lives,
  continuesRemaining = 0,
  spaceRemaining,
  spaceRequired,
  lockedBalls,
  threadLockRequired,
  ownedUpgrades,
  accentColor = '#00ff88',
  certificateProgress,
  microManagerPerLock = 0,
  ascensionDepth = 0,
  onExpand,
}: GameTopBarProps) {
  const { t } = useTranslation();
  // One icon per upgrade family (highest tier owned), not one per bought tier.
  const groupedUpgrades = useMemo(() => groupUpgradesByFamily(ownedUpgrades), [ownedUpgrades]);
  const upgradesContainerRef = useRef<HTMLDivElement>(null);
  const [needsCarousel, setNeedsCarousel] = useState(false);
  const [openTooltipId, setOpenTooltipId] = useState<string | null>(null);
  const swipeStartYRef = useRef<number | null>(null);

  const handleSwipeTouchStart = (e: React.TouchEvent) => {
    swipeStartYRef.current = e.touches[0].clientY;
  };
  const handleSwipeTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartYRef.current === null || !onExpand) return;
    if (e.changedTouches[0].clientY - swipeStartYRef.current > 30) onExpand();
    swipeStartYRef.current = null;
  };

  // ── Animated capture-percentage count-up ─────────────────────────────────
  const [displaySpace, setDisplaySpace] = useState(spaceRemaining);
  const spaceAnimRef = useRef<number | undefined>(undefined);
  const spaceFromRef = useRef(spaceRemaining);
  useEffect(() => {
    const from = spaceFromRef.current;
    const to   = spaceRemaining;
    if (from === to) return;
    cancelAnimationFrame(spaceAnimRef.current!);
    const t0  = performance.now();
    const dur = 280;
    const tick = (now: number) => {
      const p     = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - p) ** 2;
      setDisplaySpace(Math.round(from + (to - from) * eased));
      if (p < 1) spaceAnimRef.current = requestAnimationFrame(tick);
      else        spaceFromRef.current = to;
    };
    spaceAnimRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(spaceAnimRef.current!);
  }, [spaceRemaining]);

  // ── Per-stat flash keys (each increment forces a CSS animation restart) ──
  const [spaceFlashKey,  setSpaceFlashKey]  = useState(0);
  const [livesFlashKey,  setLivesFlashKey]  = useState(0);
  const [locksFlashKey,  setLocksFlashKey]  = useState(0);
  const prevSpaceRef = useRef(spaceRemaining);
  const prevLivesRef = useRef(lives);
  const prevLocksRef = useRef(lockedBalls);
  // ignore the ESLint warning — useCallback is just a stable reference here
  const flash = useCallback((set: React.Dispatch<React.SetStateAction<number>>) =>
    set(k => k + 1), []);
  useEffect(() => {
    if (spaceRemaining < prevSpaceRef.current) flash(setSpaceFlashKey);
    prevSpaceRef.current = spaceRemaining;
  }, [spaceRemaining, flash]);
  useEffect(() => {
    if (lives < prevLivesRef.current) flash(setLivesFlashKey);
    prevLivesRef.current = lives;
  }, [lives, flash]);
  useEffect(() => {
    if (lockedBalls > prevLocksRef.current) flash(setLocksFlashKey);
    prevLocksRef.current = lockedBalls;
  }, [lockedBalls, flash]);

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
  }, [groupedUpgrades]);

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

  const hasUpgrades = groupedUpgrades.length > 0;

  const lockReq = threadLockRequired ?? 0;
  const lockMet = lockedBalls >= lockReq;
  const lockColor = lockReq > 0
    ? (lockMet ? accentColor : 'hsl(var(--foreground))')
    : `${accentColor}66`;

  return (
    <div className="flex-shrink-0 flex flex-col">
      {/* Row 1: Navigation — menu, level, lives, certificate-hour progress */}
      <div
        className={`pl-[88px] pr-3 py-2 flex items-center justify-between gap-2${onExpand ? ' cursor-pointer' : ''}`}
        onClick={onExpand}
        onTouchStart={handleSwipeTouchStart}
        onTouchEnd={handleSwipeTouchEnd}
        style={{
          backgroundColor: 'rgba(0, 10, 5, 0.9)',
          borderBottom: `1px solid ${accentColor}33`,
        }}
      >
        {/* Level Number (+ ascension depth badge while ascended) */}
        <div className="flex items-center gap-1.5 min-w-0" style={{ color: accentColor }}>
          <span className="font-display text-base font-bold" style={{ textShadow: `0 0 10px ${accentColor}88` }}>
            LV{levelNumber}
          </span>
          {ascensionDepth > 0 && (
            <span
              className="font-display text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                color: '#ffb347',
                border: '1px solid #ffb34788',
                backgroundColor: '#ffb34718',
                textShadow: '0 0 8px #ffb34788',
              }}
            >
              A{ascensionDepth}
            </span>
          )}
        </div>

        {/* Lives (+ banked Continues) */}
        <div className="flex items-center gap-2">
          <div key={livesFlashKey} className={`flex items-center gap-1 ${livesFlashKey > 0 ? 'animate-stat-flash' : ''}`}>
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
          {continuesRemaining > 0 && (
            <div
              className="flex items-center gap-0.5 flex-shrink-0"
              title={t('topBar.continues', { count: continuesRemaining })}
            >
              <RotateCcw className="w-4 h-4" style={{ color: accentColor }} />
              <span className="font-display text-sm font-bold tabular-nums" style={{ color: accentColor }}>
                {continuesRemaining}
              </span>
            </div>
          )}
        </div>

        {/* Certificate-hour progress */}
        {certificateProgress && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Hexagon
              className="w-5 h-5 flex-shrink-0"
              style={{
                color: '#ffffff',
                fill: certificateProgress.hoursEarned > 0 ? 'rgba(255,255,255,0.3)' : 'transparent',
              }}
            />
            <span
              className="font-display text-base font-bold tabular-nums"
              style={{
                color: '#ffffff',
                textShadow: certificateProgress.hoursEarned > 0 ? '0 0 8px rgba(255,255,255,0.6)' : 'none',
              }}
            >
              {certificateProgress.progressInCurrentHour}/{certificateProgress.levelsPerHour}
            </span>
          </div>
        )}

        {/* Expand indicator — only when onExpand is provided */}
        {onExpand && (
          <ChevronDown
            className="w-4 h-4 flex-shrink-0 opacity-50"
            style={{ color: accentColor }}
          />
        )}
      </div>

      {/* Row 2: Objectives — cuts/par, space, thread locks */}
      <div
        className={`px-3 py-1.5 flex items-center justify-around gap-2${onExpand ? ' cursor-pointer' : ''}`}
        onClick={onExpand}
        onTouchStart={handleSwipeTouchStart}
        onTouchEnd={handleSwipeTouchEnd}
        style={{
          backgroundColor: 'rgba(0, 10, 5, 0.9)',
          borderBottom: `2px solid ${accentColor}44`,
        }}
      >
        {/* Cuts / Par */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Scissors className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <span
            className="font-display text-sm font-bold tabular-nums"
            style={{
              color: cutsUsed > parCuts ? '#ff6b6b' : accentColor,
              textShadow: `0 0 10px ${cutsUsed > parCuts ? '#ff6b6b' : accentColor}88`,
            }}
          >
            {cutsUsed}/{parCuts}
          </span>
        </div>

        {/* Space */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Target className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
          <span
            key={spaceFlashKey}
            className={`font-display text-sm font-bold tabular-nums${spaceFlashKey > 0 ? ' animate-stat-flash' : ''}`}
            style={{
              color: spaceRemaining <= spaceRequired ? accentColor : 'hsl(var(--foreground))',
              textShadow: spaceRemaining <= spaceRequired ? `0 0 10px ${accentColor}88` : 'none',
            }}
          >
            {spaceRemaining <= spaceRequired
              ? t('topBar.clear')
              : t('topBar.percentToGo', { percent: displaySpace - spaceRequired })}
          </span>
        </div>

        {/* Thread Locks */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Lock
            className="w-4 h-4 flex-shrink-0"
            style={{ color: lockColor, filter: lockMet && lockReq > 0 ? `drop-shadow(0 0 6px ${accentColor}aa)` : 'none' }}
          />
          <span
            key={locksFlashKey}
            className={`font-display text-sm font-bold tabular-nums${locksFlashKey > 0 ? ' animate-stat-flash' : ''}`}
            style={{
              color: lockColor,
              textShadow: lockMet && lockReq > 0 ? `0 0 10px ${accentColor}88` : 'none',
            }}
          >
            {lockReq > 0 ? `${lockedBalls}/${lockReq}` : lockedBalls}
          </span>
        </div>
      </div>

      {/* Row 2: Upgrades Bar */}
      {hasUpgrades && (
        <div 
          className="px-3 py-1.5"
          style={{ 
            backgroundColor: 'rgba(0, 10, 5, 0.9)',
            borderBottom: `1px solid ${accentColor}33`,
          }}
        >
          <TooltipProvider delayDuration={0}>
            <div
              ref={upgradesContainerRef}
              className={`flex items-center gap-2 ${
                needsCarousel ? 'overflow-x-auto scrollbar-hide touch-pan-x' : 'justify-center'
              }`}
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {groupedUpgrades.map((upgrade) => {
                const Icon = getUpgradeIcon(upgrade, ownedUpgrades);
                return (
                <Tooltip
                  key={upgrade.id}
                  open={openTooltipId === upgrade.id}
                  onOpenChange={(open) => {
                    if (!open && openTooltipId === upgrade.id) setOpenTooltipId(null);
                  }}
                >
                  <TooltipTrigger asChild>
                    <button
                      data-upgrade-icon
                      onClick={(e) => handleUpgradeClick(upgrade.id, e)}
                      className="relative flex-shrink-0 h-8 w-8 rounded-md flex items-center justify-center transition-all duration-200 hover:scale-110 focus:outline-none focus:ring-1 text-[10px] font-bold"
                      style={{
                        backgroundColor: `${accentColor}18`,
                        border: `1px solid ${accentColor}55`,
                        boxShadow: openTooltipId === upgrade.id ? `0 0 12px ${accentColor}88` : 'none',
                        color: accentColor,
                      }}
                      aria-label={contentText.upgradeName(t, upgrade)}
                    >
                      {Icon
                        ? <Icon className="w-4 h-4" strokeWidth={1.5} />
                        : contentText.upgradeName(t, upgrade).substring(0, 3).toUpperCase()}
                      {/* Tier meter: 1–3 ascending bars in the top-right corner */}
                      <span className="absolute top-[3px] right-[3px] flex items-end gap-[1px]" aria-hidden="true">
                        {Array.from({ length: TIER_BARS[upgrade.tier] }).map((_, i) => (
                          <span
                            key={i}
                            className="w-[2px] rounded-[1px]"
                            style={{ height: `${3 + i * 2}px`, backgroundColor: accentColor }}
                          />
                        ))}
                      </span>
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
                      <p className="font-display font-bold text-base" style={{ color: accentColor }}>
                        {contentText.upgradeName(t, upgrade)} [{contentText.tier(t, upgrade.tier)}]
                      </p>
                      <p className="text-sm leading-relaxed" style={{ color: 'hsl(var(--foreground) / 0.85)' }}>
                        {contentText.upgradeDesc(t, upgrade)}
                      </p>
                      {upgrade.id.startsWith('micro_manager_') && microManagerPerLock > 0 && (
                        <p className="text-sm font-bold tabular-nums" style={{ color: accentColor }}>
                          {t('topBar.currentlyReducingBy', { percent: Math.min(50, Math.round(lockedBalls * microManagerPerLock * 100)) })}
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
