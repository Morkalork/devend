/**
 * GameBottomBar — compact bar below the board summarising the active
 * GameModifiers as icons. Tapping it opens BottomBarDetailsPanel.
 */
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GameModifiers } from '@/hooks/useActiveModifiers';

interface GameBottomBarProps {
  activeModifiers: GameModifiers;
  accentColor: string;
  lockedBalls?: number;
  onExpand?: () => void;
}

export const GameBottomBar = React.forwardRef<HTMLDivElement, GameBottomBarProps>(
function GameBottomBar({ activeModifiers, accentColor, lockedBalls = 0, onExpand }, ref) {
  const { t } = useTranslation();
  const swipeStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStartYRef.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartYRef.current === null || !onExpand) return;
    if (swipeStartYRef.current - e.changedTouches[0].clientY > 30) onExpand();
    swipeStartYRef.current = null;
  };
  const modifiers = activeModifiers;

  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
  const formatBonus = (value: number) => value > 0 ? `+${value}` : `${value}`;
  const formatRate = (value: number) => `${Math.round(value * 100)}%`;

  const microManagerFactor = modifiers.microManagerPerLock > 0 && lockedBalls > 0
    ? Math.max(0.30, Math.pow(1 - modifiers.microManagerPerLock, lockedBalls))
    : 1;
  const effectiveSpeedFactor = modifiers.ballSpeedMultiplier * microManagerFactor;

  const stats = [
    { label: t('bottomBar.ballSpeed'), value: formatPercent(effectiveSpeedFactor), changed: effectiveSpeedFactor !== 1 },
    { label: t('bottomBar.ballSize'), value: formatPercent(modifiers.ballSizeMultiplier), changed: modifiers.ballSizeMultiplier !== 1 },
    { label: t('bottomBar.fenceSpeed'), value: formatPercent(modifiers.fenceGenerationSpeedMultiplier), changed: modifiers.fenceGenerationSpeedMultiplier !== 1 },
    { label: t('bottomBar.otMult'), value: formatPercent(modifiers.scoreMultiplier), changed: modifiers.scoreMultiplier !== 1 },
    { label: t('bottomBar.instantFences'), value: formatBonus(modifiers.instantFencesPerMap), changed: modifiers.instantFencesPerMap !== 0 },
    { label: t('bottomBar.concurrent'), value: formatBonus(modifiers.additionalConcurrentFences), changed: modifiers.additionalConcurrentFences !== 0 },
    { label: t('bottomBar.bonusRemove'), value: `${formatRate(modifiers.bonusRemovalChance)} @ ${formatRate(modifiers.bonusRemovalAmount)}`, changed: modifiers.bonusRemovalChance > 0 },
    { label: t('bottomBar.extraLives'), value: formatBonus(modifiers.extraLives), changed: modifiers.extraLives !== 0 },
    { label: t('bottomBar.interest'), value: formatRate(modifiers.scoreInterestRate), changed: modifiers.scoreInterestRate !== 0 },
    { label: t('bottomBar.shopSlots'), value: formatBonus(modifiers.extraShopItems), changed: modifiers.extraShopItems !== 0 },
    { label: t('bottomBar.restocks'), value: formatBonus(modifiers.shopRestockCount), changed: modifiers.shopRestockCount !== 0 },
    { label: t('bottomBar.microMgrPerLock'), value: `${Math.round(modifiers.microManagerPerLock * 100)}% (${Math.round((1 - microManagerFactor) * 100)}% now)`, changed: modifiers.microManagerPerLock !== 0 },
  ];

  return (
    <div
      ref={ref}
      className={`fixed bottom-0 left-0 right-0 z-20${onExpand ? ' pointer-events-auto cursor-pointer' : ' pointer-events-none'}`}
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
      onClick={onExpand}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="mx-auto max-w-4xl px-3 py-2"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.80)',
          borderTop: `1px solid ${accentColor}40`,
        }}
      >
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-1"
              style={{
                color: stat.changed ? accentColor : `${accentColor}bb`,
                textShadow: stat.changed ? `0 0 8px ${accentColor}` : 'none',
              }}
            >
              <span className="opacity-80">{stat.label}:</span>
              <span className="font-bold">{stat.value}</span>
            </div>
          ))}
          {onExpand && (
            <div className="flex items-center gap-1 opacity-40">
              <span style={{ color: accentColor, fontSize: '0.6rem' }}>{t('bottomBar.tapForDetails')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
