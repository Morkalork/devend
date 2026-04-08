import React from 'react';
import { GameModifiers } from '@/hooks/useActiveModifiers';

interface GameStatsPanelProps {
  activeModifiers: GameModifiers;
  accentColor: string;
  lockedBalls?: number;
}

export const GameStatsPanel = React.forwardRef<HTMLDivElement, GameStatsPanelProps>(
function GameStatsPanel({ activeModifiers, accentColor, lockedBalls = 0 }, ref) {
  const modifiers = activeModifiers;

  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
  const formatBonus = (value: number) => value > 0 ? `+${value}` : `${value}`;
  const formatRate = (value: number) => `${Math.round(value * 100)}%`;

  const microManagerFactor = modifiers.microManagerPerLock > 0 && lockedBalls > 0
    ? Math.max(0.30, Math.pow(1 - modifiers.microManagerPerLock, lockedBalls))
    : 1;
  const effectiveSpeedFactor = modifiers.ballSpeedMultiplier * microManagerFactor;

  const stats = [
    { label: 'Ball Speed', value: formatPercent(effectiveSpeedFactor), changed: effectiveSpeedFactor !== 1 },
    { label: 'Ball Size', value: formatPercent(modifiers.ballSizeMultiplier), changed: modifiers.ballSizeMultiplier !== 1 },
    { label: 'Fence Speed', value: formatPercent(modifiers.fenceGenerationSpeedMultiplier), changed: modifiers.fenceGenerationSpeedMultiplier !== 1 },
    { label: 'OT Mult.', value: formatPercent(modifiers.scoreMultiplier), changed: modifiers.scoreMultiplier !== 1 },
    { label: 'Instant Fences', value: formatBonus(modifiers.instantFencesPerMap), changed: modifiers.instantFencesPerMap !== 0 },
    { label: 'Concurrent', value: formatBonus(modifiers.additionalConcurrentFences), changed: modifiers.additionalConcurrentFences !== 0 },
    { label: 'Bonus Remove', value: `${formatRate(modifiers.bonusRemovalChance)} @ ${formatRate(modifiers.bonusRemovalAmount)}`, changed: modifiers.bonusRemovalChance > 0 },
    { label: 'Extra Lives', value: formatBonus(modifiers.extraLives), changed: modifiers.extraLives !== 0 },
    { label: 'Interest', value: formatRate(modifiers.scoreInterestRate), changed: modifiers.scoreInterestRate !== 0 },
    { label: 'Shop Slots', value: formatBonus(modifiers.extraShopItems), changed: modifiers.extraShopItems !== 0 },
    { label: 'MicroMgr/Lock', value: `${Math.round(modifiers.microManagerPerLock * 100)}% (${Math.round((1 - microManagerFactor) * 100)}% now)`, changed: modifiers.microManagerPerLock !== 0 },
  ];

  return (
    <div
      ref={ref}
      className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
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
        </div>
      </div>
    </div>
  );
});
