import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { UpgradeConfig } from '@/types/upgrade';

interface GameStatsPanelProps {
  ownedUpgradeIds: string[];
  upgrades: UpgradeConfig[];
  accentColor: string;
}

export function GameStatsPanel({ ownedUpgradeIds, upgrades, accentColor }: GameStatsPanelProps) {
  const modifiers = useActiveModifiers(ownedUpgradeIds, upgrades);

  // Format percentage values
  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
  const formatBonus = (value: number) => value > 0 ? `+${value}` : `${value}`;

  // Only show stats that differ from defaults or are interesting
  const stats = [
    { label: 'Ball Speed', value: formatPercent(modifiers.ballSpeedMultiplier), changed: modifiers.ballSpeedMultiplier !== 1 },
    { label: 'Ball Size', value: formatPercent(modifiers.ballSizeMultiplier), changed: modifiers.ballSizeMultiplier !== 1 },
    { label: 'Fence Speed', value: formatPercent(modifiers.wallSpeedMultiplier), changed: modifiers.wallSpeedMultiplier !== 1 },
    { label: 'Swipe Sens.', value: formatPercent(modifiers.swipeSensitivity), changed: modifiers.swipeSensitivity !== 1 },
    { label: 'Score Mult.', value: formatPercent(modifiers.scoreMultiplier), changed: modifiers.scoreMultiplier !== 1 },
    { label: 'Size Reduce', value: `${modifiers.reducedSizePercent}%`, changed: modifiers.reducedSizePercent !== 0 },
    { label: 'Wall Grace', value: formatBonus(modifiers.wallGrace), changed: modifiers.wallGrace !== 0 },
    { label: 'Par Bonus', value: formatBonus(modifiers.expectedCutsBonus), changed: modifiers.expectedCutsBonus !== 0 },
    { label: 'Shop Slots', value: formatBonus(modifiers.shopSlots), changed: modifiers.shopSlots !== 0 },
    { label: 'Wall Shield', value: `${modifiers.wallShield}`, changed: modifiers.wallShield !== 0 },
    { label: 'Bonus Lives', value: formatBonus(modifiers.bonusLives), changed: modifiers.bonusLives !== 0 },
    { label: 'Price Mult.', value: formatPercent(modifiers.priceMultiplier), changed: modifiers.priceMultiplier !== 1 },
  ];

  // Boolean modifiers
  const booleanStats = [
    { label: 'Cut Preview', active: modifiers.cutPreview },
    { label: 'Highlight Fast', active: modifiers.highlightFastestBall },
  ];

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      <div 
        className="mx-auto max-w-4xl px-3 py-2"
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          borderTop: `1px solid ${accentColor}40`,
        }}
      >
        {/* Stats Grid */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {stats.map((stat) => (
            <div 
              key={stat.label} 
              className="flex items-center gap-1"
              style={{ 
                color: stat.changed ? accentColor : `${accentColor}80`,
                textShadow: stat.changed ? `0 0 8px ${accentColor}` : 'none',
              }}
            >
              <span className="opacity-70">{stat.label}:</span>
              <span className="font-bold">{stat.value}</span>
            </div>
          ))}
          
          {/* Boolean stats */}
          {booleanStats.map((stat) => (
            <div 
              key={stat.label} 
              className="flex items-center gap-1"
              style={{ 
                color: stat.active ? accentColor : `${accentColor}40`,
                textShadow: stat.active ? `0 0 8px ${accentColor}` : 'none',
              }}
            >
              <span className="opacity-70">{stat.label}:</span>
              <span className="font-bold">{stat.active ? 'ON' : 'OFF'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
