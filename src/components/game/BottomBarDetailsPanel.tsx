/**
 * BottomBarDetailsPanel — full-screen expansion of GameBottomBar: every
 * active modifier explained in plain language.
 */
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      label: t('bottomBarDetails.ballSpeed'),
      value: pct(effectiveSpeed),
      changed: effectiveSpeed !== 1,
      description: `${t('bottomBarDetails.ballSpeedDescBase', { base: pct(m.ballSpeedMultiplier) })}${
        m.microManagerPerLock > 0
          ? t('bottomBarDetails.ballSpeedDescMicro', { reduction: Math.round((1 - microFactor) * 100), count: lockedBalls })
          : ''
      }${t('bottomBarDetails.ballSpeedDescTail')}`,
    },
    {
      label: t('bottomBarDetails.ballSize'),
      value: pct(m.ballSizeMultiplier),
      changed: m.ballSizeMultiplier !== 1,
      description: t('bottomBarDetails.ballSizeDesc'),
    },
    {
      label: t('bottomBarDetails.fenceSpeed'),
      value: pct(m.fenceGenerationSpeedMultiplier),
      changed: m.fenceGenerationSpeedMultiplier !== 1,
      description: t('bottomBarDetails.fenceSpeedDesc'),
    },
    {
      label: t('bottomBarDetails.scoreMultiplier'),
      value: pct(m.scoreMultiplier),
      changed: m.scoreMultiplier !== 1,
      description: t('bottomBarDetails.scoreMultiplierDesc'),
    },
    {
      label: t('bottomBarDetails.instantFences'),
      value: bonus(m.instantFencesPerMap),
      changed: m.instantFencesPerMap !== 0,
      description:
        m.instantFencesPerMap > 0
          ? t('bottomBarDetails.instantFencesActive', { count: m.instantFencesPerMap })
          : t('bottomBarDetails.instantFencesInactive'),
    },
    {
      label: t('bottomBarDetails.concurrentFences'),
      value: bonus(m.additionalConcurrentFences),
      changed: m.additionalConcurrentFences !== 0,
      description:
        m.additionalConcurrentFences > 0
          ? t('bottomBarDetails.concurrentFencesActive', { total: 1 + m.additionalConcurrentFences })
          : t('bottomBarDetails.concurrentFencesInactive'),
    },
    {
      label: t('bottomBarDetails.bonusRemoval'),
      value: `${pct(m.bonusRemovalChance)} @ ${pct(m.bonusRemovalAmount)}`,
      changed: m.bonusRemovalChance > 0,
      description:
        m.bonusRemovalChance > 0
          ? t('bottomBarDetails.bonusRemovalActive', { chance: pct(m.bonusRemovalChance), amount: pct(m.bonusRemovalAmount) })
          : t('bottomBarDetails.bonusRemovalInactive'),
    },
    {
      label: t('bottomBarDetails.extraLives'),
      value: bonus(m.extraLives),
      changed: m.extraLives !== 0,
      description:
        m.extraLives > 0
          ? t('bottomBarDetails.extraLivesActive', { count: m.extraLives })
          : t('bottomBarDetails.extraLivesInactive'),
    },
    {
      label: t('bottomBarDetails.scoreInterest'),
      value: pct(m.scoreInterestRate),
      changed: m.scoreInterestRate !== 0,
      description:
        m.scoreInterestRate > 0
          ? t('bottomBarDetails.scoreInterestActive', { rate: pct(m.scoreInterestRate) })
          : t('bottomBarDetails.scoreInterestInactive'),
    },
    {
      label: t('bottomBarDetails.extraShopSlots'),
      value: bonus(m.extraShopItems),
      changed: m.extraShopItems !== 0,
      description:
        m.extraShopItems > 0
          ? t('bottomBarDetails.extraShopSlotsActive', { count: m.extraShopItems })
          : t('bottomBarDetails.extraShopSlotsInactive'),
    },
    {
      label: t('bottomBarDetails.shopRestocks'),
      value: bonus(m.shopRestockCount),
      changed: m.shopRestockCount !== 0,
      description:
        m.shopRestockCount > 0
          ? t('bottomBarDetails.shopRestocksActive', { count: m.shopRestockCount })
          : t('bottomBarDetails.shopRestocksInactive'),
    },
    {
      label: t('bottomBarDetails.microManager'),
      value: m.microManagerPerLock > 0 ? t('bottomBarDetails.microManagerValue', { percent: Math.round(m.microManagerPerLock * 100) }) : t('bottomBarDetails.off'),
      changed: m.microManagerPerLock > 0,
      description:
        m.microManagerPerLock > 0
          ? t('bottomBarDetails.microManagerActive', { percent: Math.round(m.microManagerPerLock * 100), count: lockedBalls, speed: pct(effectiveSpeed) })
          : t('bottomBarDetails.microManagerInactive'),
    },
    {
      label: t('bottomBarDetails.ballPathPrediction'),
      value:
        m.ballPathPredictionBounces > 0
          ? t('bottomBarDetails.bounceCount', { count: m.ballPathPredictionBounces })
          : t('bottomBarDetails.off'),
      changed: m.ballPathPredictionBounces > 0,
      description:
        m.ballPathPredictionBounces > 0
          ? t('bottomBarDetails.ballPathPredictionActive', {
              bounceText: t('bottomBarDetails.bounceCount', { count: m.ballPathPredictionBounces }),
              target: m.ballPathPredictionBalls >= 100
                ? t('bottomBarDetails.ballPathTargetAll')
                : t('bottomBarDetails.ballPathTargetTop', { count: m.ballPathPredictionBalls }),
            })
          : t('bottomBarDetails.ballPathPredictionInactive'),
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
          {t('bottomBarDetails.activeModifiers')}
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
          aria-label={t('bottomBarDetails.closePanel')}
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">

        {/* Active (non-default) modifiers */}
        {activeRows.length > 0 && (
          <section>
            <p style={sectionHeadStyle}>{t('bottomBarDetails.modifiedCount', { count: activeRows.length })}</p>
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
              {t('bottomBarDetails.noModifiers')}
            </p>
          </div>
        )}

        {/* Base / inactive modifiers */}
        {inactiveRows.length > 0 && (
          <section>
            <p style={sectionHeadStyle}>{t('bottomBarDetails.atDefault')}</p>
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
