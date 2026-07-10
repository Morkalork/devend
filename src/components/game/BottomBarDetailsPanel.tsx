/**
 * BottomBarDetailsPanel — full-screen expansion of GameBottomBar: every
 * active modifier explained in plain language.
 */
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { X } from 'lucide-react';
import { GameModifiers, ModifierSource, MULTIPLICATIVE_KEYS } from '@/hooks/useActiveModifiers';
import { effectiveBallSpeedFactor } from '@/lib/ballTypes';
import { contentText } from '@/i18n/content';

interface BottomBarDetailsPanelProps {
  visible: boolean;
  onClose: () => void;
  activeModifiers: GameModifiers;
  modifierSources?: ModifierSource[];
  accentColor?: string;
  lockedBalls?: number;
}

interface StatRow {
  label: string;
  value: string;
  changed: boolean;
  description: string;
  /** GameModifiers keys this row reads, used to attribute it to its sources. */
  keys: (keyof GameModifiers)[];
}

/** Additive keys expressed as fractions (shown as percentages, not raw counts). */
const FRACTIONAL_ADDITIVE_KEYS = new Set<keyof GameModifiers>([
  'scoreInterestRate',
  'bonusRemovalChance',
  'bonusRemovalAmount',
  'microManagerPerLock',
  'fenceSpeedPerLock',
  'fenceSpeedPerFence',
  'bankedSlowPer50h',
]);

/** Localized display name for a modifier source, by its kind. */
function sourceName(t: TFunction, s: ModifierSource): string {
  switch (s.kind) {
    case 'upgrade': return contentText.upgradeName(t, s);
    case 'certificate': return contentText.certName(t, s);
    case 'achievement': return contentText.achName(t, s);
    case 'loadout': return contentText.loadoutName(t, s);
    case 'tagSet': return t('bottomBarDetails.tagSetSource', { name: contentText.tagSetName(t, s) });
    case 'ascension': return t('bottomBarDetails.ascensionSource', { depth: s.name });
    default: return s.name;
  }
}

/** A source's contribution to the first of `keys` it actually changes, or null. */
function contributionFor(s: ModifierSource, keys: (keyof GameModifiers)[]): { key: keyof GameModifiers; value: number } | null {
  for (const key of keys) {
    const v = s.modifiers[key];
    if (v == null) continue;
    const identity = MULTIPLICATIVE_KEYS.includes(key) ? v === 1 : v === 0;
    if (identity) continue;
    return { key, value: v };
  }
  return null;
}

/** Format one source's contribution the way its key reads elsewhere. */
function formatContribution(key: keyof GameModifiers, v: number): string {
  if (MULTIPLICATIVE_KEYS.includes(key)) {
    const d = Math.round((v - 1) * 100);
    return `${d >= 0 ? '+' : ''}${d}%`;
  }
  if (FRACTIONAL_ADDITIVE_KEYS.has(key)) {
    const p = Math.round(v * 100);
    return `${p >= 0 ? '+' : ''}${p}%`;
  }
  return v >= 0 ? `+${v}` : `${v}`;
}

export function BottomBarDetailsPanel({
  visible,
  onClose,
  activeModifiers,
  modifierSources = [],
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
      ? Math.pow(1 - m.microManagerPerLock, lockedBalls)
      : 1;
  // Floored combined factor — matches the physics cap (#42).
  const effectiveSpeed = effectiveBallSpeedFactor(m.ballSpeedMultiplier, microFactor);

  const rows: StatRow[] = [
    {
      label: t('bottomBarDetails.ballSpeed'),
      value: pct(effectiveSpeed),
      changed: effectiveSpeed !== 1,
      keys: ['ballSpeedMultiplier'],
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
      keys: ['ballSizeMultiplier'],
      description: t('bottomBarDetails.ballSizeDesc'),
    },
    {
      label: t('bottomBarDetails.fenceSpeed'),
      value: pct(m.fenceGenerationSpeedMultiplier),
      changed: m.fenceGenerationSpeedMultiplier !== 1,
      keys: ['fenceGenerationSpeedMultiplier'],
      description: t('bottomBarDetails.fenceSpeedDesc'),
    },
    {
      label: t('bottomBarDetails.scoreMultiplier'),
      value: pct(m.scoreMultiplier),
      changed: m.scoreMultiplier !== 1,
      keys: ['scoreMultiplier'],
      description: t('bottomBarDetails.scoreMultiplierDesc'),
    },
    {
      label: t('bottomBarDetails.instantFences'),
      value: bonus(m.instantFencesPerMap),
      changed: m.instantFencesPerMap !== 0,
      keys: ['instantFencesPerMap'],
      description:
        m.instantFencesPerMap > 0
          ? t('bottomBarDetails.instantFencesActive', { count: m.instantFencesPerMap })
          : t('bottomBarDetails.instantFencesInactive'),
    },
    {
      label: t('bottomBarDetails.concurrentFences'),
      value: bonus(m.additionalConcurrentFences),
      changed: m.additionalConcurrentFences !== 0,
      keys: ['additionalConcurrentFences'],
      description:
        m.additionalConcurrentFences > 0
          ? t('bottomBarDetails.concurrentFencesActive', { total: 1 + m.additionalConcurrentFences })
          : t('bottomBarDetails.concurrentFencesInactive'),
    },
    {
      label: t('bottomBarDetails.bonusRemoval'),
      value: `${pct(m.bonusRemovalChance)} @ ${pct(m.bonusRemovalAmount)}`,
      changed: m.bonusRemovalChance > 0,
      keys: ['bonusRemovalChance', 'bonusRemovalAmount'],
      description:
        m.bonusRemovalChance > 0
          ? t('bottomBarDetails.bonusRemovalActive', { chance: pct(m.bonusRemovalChance), amount: pct(m.bonusRemovalAmount) })
          : t('bottomBarDetails.bonusRemovalInactive'),
    },
    {
      label: t('bottomBarDetails.extraLives'),
      value: bonus(m.extraLives),
      changed: m.extraLives !== 0,
      keys: ['extraLives'],
      description:
        m.extraLives > 0
          ? t('bottomBarDetails.extraLivesActive', { count: m.extraLives })
          : t('bottomBarDetails.extraLivesInactive'),
    },
    {
      label: t('bottomBarDetails.scoreInterest'),
      value: pct(m.scoreInterestRate),
      changed: m.scoreInterestRate !== 0,
      keys: ['scoreInterestRate', 'scoreInterestCapBonus'],
      description:
        m.scoreInterestRate > 0
          ? t('bottomBarDetails.scoreInterestActive', { rate: pct(m.scoreInterestRate), cap: 8 + m.scoreInterestCapBonus })
          : t('bottomBarDetails.scoreInterestInactive'),
    },
    {
      label: t('bottomBarDetails.overtimePerLock'),
      value: bonus(m.overtimePerLock),
      changed: m.overtimePerLock !== 0,
      keys: ['overtimePerLock'],
      description:
        m.overtimePerLock > 0
          ? t('bottomBarDetails.overtimePerLockActive', { hours: m.overtimePerLock })
          : t('bottomBarDetails.overtimePerLockInactive'),
    },
    {
      label: t('bottomBarDetails.frozenLockBonus'),
      value: m.frozenLockBonus > 0 ? `x${1 + m.frozenLockBonus}` : t('bottomBarDetails.off'),
      changed: m.frozenLockBonus !== 0,
      keys: ['frozenLockBonus'],
      description:
        m.frozenLockBonus > 0
          ? t('bottomBarDetails.frozenLockBonusActive', { mult: 1 + m.frozenLockBonus })
          : t('bottomBarDetails.frozenLockBonusInactive'),
    },
    {
      label: t('bottomBarDetails.fenceSpeedPerLock'),
      value: pct(m.fenceSpeedPerLock),
      changed: m.fenceSpeedPerLock !== 0,
      keys: ['fenceSpeedPerLock'],
      description:
        m.fenceSpeedPerLock > 0
          ? t('bottomBarDetails.fenceSpeedPerLockActive', { percent: Math.round(m.fenceSpeedPerLock * 100) })
          : t('bottomBarDetails.fenceSpeedPerLockInactive'),
    },
    {
      label: t('bottomBarDetails.simultaneousLockBonus'),
      value: bonus(m.simultaneousLockBonus),
      changed: m.simultaneousLockBonus !== 0,
      keys: ['simultaneousLockBonus'],
      description:
        m.simultaneousLockBonus > 0
          ? t('bottomBarDetails.simultaneousLockBonusActive', { count: m.simultaneousLockBonus })
          : t('bottomBarDetails.simultaneousLockBonusInactive'),
    },
    {
      label: t('bottomBarDetails.freezeNoCooldown'),
      value: m.freezeNoCooldown > 0 ? t('bottomBarDetails.on') : t('bottomBarDetails.off'),
      changed: m.freezeNoCooldown !== 0,
      keys: ['freezeNoCooldown'],
      description:
        m.freezeNoCooldown > 0
          ? t('bottomBarDetails.freezeNoCooldownActive')
          : t('bottomBarDetails.freezeNoCooldownInactive'),
    },
    {
      label: t('bottomBarDetails.fenceSpeedPerFence'),
      value: pct(m.fenceSpeedPerFence),
      changed: m.fenceSpeedPerFence !== 0,
      keys: ['fenceSpeedPerFence'],
      description:
        m.fenceSpeedPerFence > 0
          ? t('bottomBarDetails.fenceSpeedPerFenceActive', { percent: Math.round(m.fenceSpeedPerFence * 100) })
          : t('bottomBarDetails.fenceSpeedPerFenceInactive'),
    },
    {
      label: t('bottomBarDetails.underParInstantFence'),
      value: bonus(m.underParInstantFence),
      changed: m.underParInstantFence !== 0,
      keys: ['underParInstantFence'],
      description:
        m.underParInstantFence > 0
          ? t('bottomBarDetails.underParInstantFenceActive', { count: m.underParInstantFence })
          : t('bottomBarDetails.underParInstantFenceInactive'),
    },
    {
      label: t('bottomBarDetails.bankedSlow'),
      value: m.bankedSlowPer50h > 0 ? t('bottomBarDetails.bankedSlowValue', { percent: Math.round(m.bankedSlowPer50h * 100) }) : t('bottomBarDetails.off'),
      changed: m.bankedSlowPer50h !== 0,
      keys: ['bankedSlowPer50h'],
      description:
        m.bankedSlowPer50h > 0
          ? t('bottomBarDetails.bankedSlowActive', { percent: Math.round(m.bankedSlowPer50h * 100) })
          : t('bottomBarDetails.bankedSlowInactive'),
    },
    {
      label: t('bottomBarDetails.spaceBonusMultiplier'),
      value: pct(m.spaceBonusMultiplier),
      changed: m.spaceBonusMultiplier !== 1,
      keys: ['spaceBonusMultiplier'],
      description:
        m.spaceBonusMultiplier !== 1
          ? t('bottomBarDetails.spaceBonusMultiplierActive', { mult: m.spaceBonusMultiplier })
          : t('bottomBarDetails.spaceBonusMultiplierInactive'),
    },
    {
      label: t('bottomBarDetails.extraShopSlots'),
      value: bonus(m.extraShopItems),
      changed: m.extraShopItems !== 0,
      keys: ['extraShopItems'],
      description:
        m.extraShopItems > 0
          ? t('bottomBarDetails.extraShopSlotsActive', { count: m.extraShopItems })
          : t('bottomBarDetails.extraShopSlotsInactive'),
    },
    {
      label: t('bottomBarDetails.shopRestocks'),
      value: bonus(m.shopRestockCount),
      changed: m.shopRestockCount !== 0,
      keys: ['shopRestockCount'],
      description:
        m.shopRestockCount > 0
          ? t('bottomBarDetails.shopRestocksActive', { count: m.shopRestockCount })
          : t('bottomBarDetails.shopRestocksInactive'),
    },
    {
      label: t('bottomBarDetails.microManager'),
      value: m.microManagerPerLock > 0 ? t('bottomBarDetails.microManagerValue', { percent: Math.round(m.microManagerPerLock * 100) }) : t('bottomBarDetails.off'),
      changed: m.microManagerPerLock > 0,
      keys: ['microManagerPerLock'],
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
      keys: ['ballPathPredictionBounces', 'ballPathPredictionBalls'],
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
    fontFamily: 'Morkalork Display, sans-serif',
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
          style={{ fontFamily: 'Morkalork Display, sans-serif', color: accentColor, textShadow: `0 0 20px ${accentColor}55` }}
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
              {activeRows.map(row => {
                const contributors = modifierSources
                  .map(s => ({ s, c: contributionFor(s, row.keys) }))
                  .filter((x): x is { s: ModifierSource; c: { key: keyof GameModifiers; value: number } } => x.c !== null);
                return (
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
                    <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.85 }}>
                      {row.description}
                    </p>

                    {contributors.length > 0 && (
                      <div className="mt-2.5 pt-2.5 space-y-1" style={{ borderTop: `1px solid ${accentColor}22` }}>
                        <p className="text-[10px] uppercase tracking-widest" style={{ color: `${accentColor}99`, fontFamily: 'Morkalork Display, sans-serif' }}>
                          {t('bottomBarDetails.fromSources')}
                        </p>
                        {contributors.map(({ s, c }) => (
                          <div key={`${s.kind}-${s.id}`} className="flex items-center justify-between gap-3">
                            <span className="text-xs" style={{ color: '#c8ffd8' }}>{sourceName(t, s)}</span>
                            <span className="text-xs font-bold tabular-nums" style={{ color: accentColor }}>
                              {formatContribution(c.key, c.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
                    <span className="text-sm font-bold" style={{ color: `${accentColor}bb` }}>
                      {row.label}
                    </span>
                    <span className="text-sm tabular-nums" style={{ color: `${accentColor}aa` }}>
                      {row.value}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
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
