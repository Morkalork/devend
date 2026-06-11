/**
 * BottomBarDetailsPanel — full-screen expansion of GameBottomBar: every
 * active modifier explained in plain language.
 */
import { X } from 'lucide-react';
import { GameModifiers } from '@/hooks/useActiveModifiers';

interface BottomBarDetailsPanelProps {
  visible: boolean;
  onClose: () => void;
  activeModifiers: GameModifiers;
  accentColor?: string;
  lockedBalls?: number;
}

interface StatRow {
  label: string;
  value: string;
  changed: boolean;
  description: string;
}

export function BottomBarDetailsPanel({
  visible,
  onClose,
  activeModifiers,
  accentColor = '#00ff88',
  lockedBalls = 0,
}: BottomBarDetailsPanelProps) {
  if (!visible) return null;

  const m = activeModifiers;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const bonus = (v: number) => (v > 0 ? `+${v}` : `${v}`);

  const microFactor =
    m.microManagerPerLock > 0 && lockedBalls > 0
      ? Math.max(0.3, Math.pow(1 - m.microManagerPerLock, lockedBalls))
      : 1;
  const effectiveSpeed = m.ballSpeedMultiplier * microFactor;

  const rows: StatRow[] = [
    {
      label: 'Ball Speed',
      value: pct(effectiveSpeed),
      changed: effectiveSpeed !== 1,
      description: `Effective multiplier on ball velocity. Base: ${pct(m.ballSpeedMultiplier)}${
        m.microManagerPerLock > 0
          ? `. MicroManager applies an additional ${Math.round((1 - microFactor) * 100)}% reduction from ${lockedBalls} locked ball${lockedBalls !== 1 ? 's' : ''}`
          : ''
      }. Slower balls give you more reaction time when drawing fences.`,
    },
    {
      label: 'Ball Size',
      value: pct(m.ballSizeMultiplier),
      changed: m.ballSizeMultiplier !== 1,
      description:
        'Radius multiplier applied to every ball. Larger balls are harder to dodge when drawing a fence — but also cover more of the board for locking purposes.',
    },
    {
      label: 'Fence Speed',
      value: pct(m.fenceGenerationSpeedMultiplier),
      changed: m.fenceGenerationSpeedMultiplier !== 1,
      description:
        'How quickly your fence grows after you start drawing. Higher fence speed shortens the window a ball has to collide with your in-progress fence, making cuts safer.',
    },
    {
      label: 'Score Multiplier',
      value: pct(m.scoreMultiplier),
      changed: m.scoreMultiplier !== 1,
      description:
        'Global multiplier applied to all points earned this run. Stacks multiplicatively with per-cut par bonuses.',
    },
    {
      label: 'Instant Fences',
      value: bonus(m.instantFencesPerMap),
      changed: m.instantFencesPerMap !== 0,
      description:
        m.instantFencesPerMap > 0
          ? `${m.instantFencesPerMap} fence${m.instantFencesPerMap !== 1 ? 's' : ''} are automatically completed at the start of each level, capturing territory without any risk.`
          : 'No instant fences active. Purchase upgrades to gain free fences each level.',
    },
    {
      label: 'Concurrent Fences',
      value: bonus(m.additionalConcurrentFences),
      changed: m.additionalConcurrentFences !== 0,
      description:
        m.additionalConcurrentFences > 0
          ? `You can draw ${1 + m.additionalConcurrentFences} fences simultaneously. Extra concurrent fences let you cut from multiple walls at once.`
          : 'Default: 1 active fence at a time.',
    },
    {
      label: 'Bonus Removal',
      value: `${pct(m.bonusRemovalChance)} @ ${pct(m.bonusRemovalAmount)}`,
      changed: m.bonusRemovalChance > 0,
      description:
        m.bonusRemovalChance > 0
          ? `Each successful cut has a ${pct(m.bonusRemovalChance)} chance to strip ${pct(m.bonusRemovalAmount)} of a ball's accumulated speed bonus, gradually nudging fast balls back toward their base speed.`
          : 'No bonus removal active.',
    },
    {
      label: 'Extra Lives',
      value: bonus(m.extraLives),
      changed: m.extraLives !== 0,
      description:
        m.extraLives > 0
          ? `+${m.extraLives} additional starting live${m.extraLives !== 1 ? 's' : ''} added at the start of every run. More lives means more chances to recover from a bad cut.`
          : 'No extra starting lives.',
    },
    {
      label: 'Score Interest',
      value: pct(m.scoreInterestRate),
      changed: m.scoreInterestRate !== 0,
      description:
        m.scoreInterestRate > 0
          ? `At the end of each level, ${pct(m.scoreInterestRate)} of your current total score is added as a bonus. Higher accumulated scores compound faster.`
          : 'No interest rate active.',
    },
    {
      label: 'Extra Shop Slots',
      value: bonus(m.extraShopItems),
      changed: m.extraShopItems !== 0,
      description:
        m.extraShopItems > 0
          ? `${m.extraShopItems} extra item${m.extraShopItems !== 1 ? 's' : ''} appear in the upgrade shop between levels, giving you more choices each visit.`
          : 'Default shop size.',
    },
    {
      label: 'MicroManager',
      value: m.microManagerPerLock > 0 ? `${Math.round(m.microManagerPerLock * 100)}% / lock` : 'Off',
      changed: m.microManagerPerLock > 0,
      description:
        m.microManagerPerLock > 0
          ? `Each locked ball reduces ball speed by ${Math.round(m.microManagerPerLock * 100)}% (stacks multiplicatively, capped at 70% total). Right now ${lockedBalls} ball${lockedBalls !== 1 ? 's' : ''} locked → effective speed ${pct(effectiveSpeed)}.`
          : 'MicroManager not active.',
    },
    {
      label: 'Ball Path Prediction',
      value:
        m.ballPathPredictionBounces > 0
          ? `${m.ballPathPredictionBounces} bounce${m.ballPathPredictionBounces !== 1 ? 's' : ''}`
          : 'Off',
      changed: m.ballPathPredictionBounces > 0,
      description:
        m.ballPathPredictionBounces > 0
          ? `Draws a predicted trajectory ${m.ballPathPredictionBounces} bounce${m.ballPathPredictionBounces !== 1 ? 's' : ''} ahead for the ${m.ballPathPredictionBalls >= 100 ? 'fastest balls' : `top ${m.ballPathPredictionBalls} fastest ball${m.ballPathPredictionBalls !== 1 ? 's' : ''}`}. Helps you time fences to avoid collisions.`
          : 'No trajectory preview active.',
    },
  ];

  const sectionHeadStyle: React.CSSProperties = {
    color: `${accentColor}88`,
    fontFamily: 'Orbitron, sans-serif',
    letterSpacing: '0.15em',
    fontSize: '0.7rem',
    fontWeight: 700,
    marginBottom: '0.75rem',
    textTransform: 'uppercase' as const,
  };

  const activeRows = rows.filter(r => r.changed);
  const inactiveRows = rows.filter(r => !r.changed);

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col"
      style={{ backgroundColor: 'rgba(0, 10, 5, 0.97)', fontFamily: "'JetBrains Mono', monospace" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        style={{ borderBottom: `2px solid ${accentColor}44` }}
      >
        <h1
          className="text-xl font-black tracking-widest uppercase"
          style={{ fontFamily: 'Orbitron, sans-serif', color: accentColor, textShadow: `0 0 20px ${accentColor}55` }}
        >
          Active Modifiers
        </h1>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-11 h-11 rounded-lg transition-all hover:scale-110 active:scale-95"
          style={{
            backgroundColor: `${accentColor}22`,
            border: `2px solid ${accentColor}99`,
            color: accentColor,
            boxShadow: `0 0 12px ${accentColor}44`,
          }}
          aria-label="Close panel"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">

        {/* Active (non-default) modifiers */}
        {activeRows.length > 0 && (
          <section>
            <p style={sectionHeadStyle}>Modified ({activeRows.length})</p>
            <div className="space-y-3">
              {activeRows.map(row => (
                <div
                  key={row.label}
                  className="rounded-lg p-4"
                  style={{
                    backgroundColor: `${accentColor}0d`,
                    border: `1px solid ${accentColor}44`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-sm" style={{ color: accentColor, textShadow: `0 0 8px ${accentColor}88` }}>
                      {row.label}
                    </span>
                    <span className="font-bold text-base tabular-nums" style={{ color: accentColor, textShadow: `0 0 8px ${accentColor}88` }}>
                      {row.value}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.65 }}>
                    {row.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeRows.length === 0 && (
          <div
            className="rounded-lg p-5 text-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: `1px solid ${accentColor}22` }}
          >
            <p className="text-sm" style={{ color: '#4a7a5a' }}>
              No modifiers active yet. Purchase upgrades between levels to gain power-ups for your run.
            </p>
          </div>
        )}

        {/* Base / inactive modifiers */}
        {inactiveRows.length > 0 && (
          <section>
            <p style={sectionHeadStyle}>At Default</p>
            <div className="space-y-2">
              {inactiveRows.map(row => (
                <div
                  key={row.label}
                  className="rounded-lg p-3"
                  style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: `1px solid ${accentColor}18` }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold" style={{ color: `${accentColor}55` }}>
                      {row.label}
                    </span>
                    <span className="text-sm tabular-nums" style={{ color: `${accentColor}44` }}>
                      {row.value}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.35 }}>
                    {row.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}
