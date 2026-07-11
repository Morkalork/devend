/**
 * GameBottomBar — compact bar below the board summarising the active
 * GameModifiers as icons. Tapping it opens BottomBarDetailsPanel.
 */
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GameModifiers } from '@/hooks/useActiveModifiers';
import { effectiveBallSpeedFactor } from '@/lib/ballTypes';
import { UpgradeTag } from '@/types/upgrade';
import { DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { TagChip } from './TagChip';

interface GameBottomBarProps {
  activeModifiers: GameModifiers;
  accentColor: string;
  lockedBalls?: number;
  /** Build readout: owned upgrades per archetype tag. */
  tagCounts?: Map<string, number>;
  /** Owned upgrades of a tag needed to activate its set bonus. */
  tagSetThreshold?: number;
  /** Rendered above the stats inside this fixed wrapper (Ship Early bar), so
   *  it stacks with the bar instead of being covered by it. */
  topSlot?: React.ReactNode;
  onExpand?: () => void;
}

export const GameBottomBar = React.forwardRef<HTMLDivElement, GameBottomBarProps>(
function GameBottomBar({ activeModifiers, accentColor, lockedBalls = 0, tagCounts, tagSetThreshold = DEFAULT_TAG_SET_THRESHOLD, topSlot, onExpand }, ref) {
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
    ? Math.pow(1 - modifiers.microManagerPerLock, lockedBalls)
    : 1;
  // Floored combined factor — matches what the physics actually enforces (#42).
  const effectiveSpeedFactor = effectiveBallSpeedFactor(modifiers.ballSpeedMultiplier, microManagerFactor);
  // Current MicroManager reduction after the floor, so this readout can't claim
  // a bigger slow than the ball-speed line above actually shows.
  const microNowReduction = modifiers.ballSpeedMultiplier > 0
    ? Math.max(0, 1 - effectiveSpeedFactor / modifiers.ballSpeedMultiplier)
    : 0;

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
    { label: t('bottomBar.microMgrPerLock'), value: `${Math.round(modifiers.microManagerPerLock * 100)}% (${Math.round(microNowReduction * 100)}% now)`, changed: modifiers.microManagerPerLock !== 0 },
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
      {topSlot}
      <div
        className="mx-auto max-w-4xl px-3 py-2"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.80)',
          borderTop: `1px solid ${accentColor}40`,
        }}
      >
        {/* Build readout: archetype chips with progress toward each set bonus.
            A ✓ chip means that tag's set bonus is active. */}
        {tagCounts && tagCounts.size > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 pb-1">
            {[...tagCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => {
                const setActive = count >= tagSetThreshold;
                return (
                  <TagChip
                    key={tag}
                    tag={tag as UpgradeTag}
                    pill
                    ringed={setActive}
                    suffix={setActive ? '✓' : `${count}/${tagSetThreshold}`}
                  />
                );
              })}
          </div>
        )}
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
