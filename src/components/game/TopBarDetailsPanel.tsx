/**
 * TopBarDetailsPanel — the full-screen "Specs" sheet for the current run:
 * your build (archetype tags + loadout), the map's objectives and assignment
 * (contract / Promotion / mutator / objective), your status, every owned
 * upgrade, and the full attribute (modifier) breakdown. Opened by the Specs
 * button in GameTopBar.
 */
import { useTranslation } from 'react-i18next';
import { X, Ticket, Award, Wind } from 'lucide-react';
import { Heart, Lock, Scissors, Target, Hexagon, Skull, Sparkles, RotateCcw } from 'lucide-react';
import { UpgradeConfig, UpgradeTag } from '@/types/upgrade';
import { LoadoutConfig } from '@/types/loadout';
import { DoorConfig } from '@/types/door';
import { CapstoneConfig } from '@/types/capstone';
import { ActiveMapMutator } from '@/types/mapMutator';
import { ActiveMapObjective, ObjectiveProgress } from '@/types/objective';
import { GameModifiers, ModifierSource } from '@/hooks/useActiveModifiers';
import { DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { getUpgradeIcon } from './upgradeIcons';
import { TagChip } from './TagChip';
import { ModifierBreakdown } from './ModifierBreakdown';
import { contentText } from '@/i18n/content';

interface CertificateHourProgress {
  levelsCompleted: number;
  levelsToNextHour: number;
  progressInCurrentHour: number;
  hoursEarned: number;
  levelsPerHour: number;
}

interface TopBarDetailsPanelProps {
  visible: boolean;
  onClose: () => void;
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
  activeLoadouts?: LoadoutConfig[];
  // Build readout: owned upgrades per archetype tag, and the count needed to
  // light a tag's set bonus.
  tagCounts?: Map<string, number>;
  tagSetThreshold?: number;
  // Attributes: merged modifiers + the sources that contribute to each.
  activeModifiers?: GameModifiers;
  modifierSources?: ModifierSource[];
  // Assignment: the running contract, once-per-run Promotion, per-map mutator
  // and optional objective (folded in from the old top-bar chips, #61).
  activeDoor?: DoorConfig | null;
  capstone?: CapstoneConfig | null;
  mapMutator?: ActiveMapMutator | null;
  objective?: ActiveMapObjective | null;
  objectiveProgress?: ObjectiveProgress | null;
}

export function TopBarDetailsPanel({
  visible,
  onClose,
  levelNumber,
  cutsUsed,
  parCuts,
  lives,
  spaceRemaining,
  spaceRequired,
  lockedBalls,
  threadLockRequired,
  ownedUpgrades,
  accentColor = '#00ff88',
  certificateProgress,
  microManagerPerLock = 0,
  ascensionDepth = 0,
  activeLoadouts = [],
  continuesRemaining = 0,
  tagCounts,
  tagSetThreshold = DEFAULT_TAG_SET_THRESHOLD,
  activeModifiers,
  modifierSources = [],
  activeDoor = null,
  capstone = null,
  mapMutator = null,
  objective = null,
  objectiveProgress = null,
}: TopBarDetailsPanelProps) {
  const { t } = useTranslation();
  if (!visible) return null;

  const lockReq = threadLockRequired ?? 0;
  const lockMet = lockedBalls >= lockReq;
  const overPar = cutsUsed > parCuts;

  const objectiveComplete = objectiveProgress?.mode === 'accumulate' && !!objectiveProgress?.met;
  const objectiveOverBudget = objectiveProgress?.mode === 'limit' && objectiveProgress?.met === false;

  const hasBuild = (tagCounts && tagCounts.size > 0) || ascensionDepth > 0 || activeLoadouts.length > 0;
  const hasAssignment = !!(activeDoor || capstone || mapMutator || objective);

  const sectionHeadStyle: React.CSSProperties = {
    color: `${accentColor}88`,
    fontFamily: 'Michroma, sans-serif',
    letterSpacing: '0.15em',
    fontSize: '0.7rem',
    fontWeight: 700,
    marginBottom: '0.75rem',
    textTransform: 'uppercase' as const,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: `1px solid ${accentColor}33`,
    borderRadius: '0.5rem',
    padding: '1rem',
  };

  const cardHighStyle: React.CSSProperties = {
    ...cardStyle,
    backgroundColor: `${accentColor}0d`,
    border: `1px solid ${accentColor}55`,
  };

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
          style={{ fontFamily: 'Michroma, sans-serif', color: accentColor, textShadow: `0 0 20px ${accentColor}55` }}
        >
          {t('topBarDetails.specsTitle', { level: levelNumber })}
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
          aria-label={t('topBarDetails.closePanel')}
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">

        {/* ── BUILD ── archetype tags + ascension + loadout: the run's identity.
            At depth 0 the drafted loadout is the run-start pick; past it they're
            the stacked ascension picks (with the depth multiplier). */}
        {hasBuild && (
          <section>
            <p style={sectionHeadStyle}>
              {ascensionDepth > 0
                ? t('topBarDetails.buildAscension', { depth: ascensionDepth })
                : t('topBarDetails.build')}
            </p>
            <div className="space-y-3">
              {tagCounts && tagCounts.size > 0 && (
                <div style={cardStyle}>
                  <div className="flex flex-wrap gap-1.5">
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
                </div>
              )}
              {ascensionDepth > 0 && (
                <div style={{ ...cardStyle, border: '1px solid #ffb34755' }}>
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.7 }}>
                    {t('topBarDetails.ascensionDescription', { multiplier: ascensionDepth + 1 })}
                  </p>
                </div>
              )}
              {activeLoadouts.map(loadout => (
                <div key={loadout.id} style={cardStyle}>
                  <p className="font-bold text-sm mb-2" style={{ color: '#ffb347' }}>{contentText.loadoutName(t, loadout)}</p>
                  <div className="flex items-start gap-2 mb-1.5">
                    <Skull className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#ff6b6b' }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#ff6b6b' }}>{contentText.loadoutCurse(t, loadout)}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.85 }}>{contentText.loadoutBlessing(t, loadout)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── OBJECTIVES ── */}
        <section>
          <p style={sectionHeadStyle}>{t('topBarDetails.objectives')}</p>
          <div className="space-y-3">

            {/* Space capture */}
            <div style={spaceRemaining <= spaceRequired ? cardHighStyle : cardStyle}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                  <span className="font-bold text-sm" style={{ color: accentColor }}>{t('topBarDetails.territoryCapture')}</span>
                </div>
                <span
                  className="font-bold text-base tabular-nums"
                  style={{ color: spaceRemaining <= spaceRequired ? accentColor : 'hsl(var(--foreground))' }}
                >
                  {spaceRemaining}% / {spaceRequired}%
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                {spaceRemaining <= spaceRequired
                  ? t('topBarDetails.territoryGoalMet', { remaining: spaceRemaining, required: spaceRequired })
                  : t('topBarDetails.territoryGoalPending', { required: spaceRequired, remaining: spaceRemaining, more: spaceRemaining - spaceRequired })}
              </p>
            </div>

            {/* Cuts / Par */}
            <div style={overPar ? { ...cardStyle, border: `1px solid #ff6b6b44` } : cardStyle}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Scissors className="w-4 h-4 flex-shrink-0" style={{ color: overPar ? '#ff6b6b' : accentColor }} />
                  <span className="font-bold text-sm" style={{ color: overPar ? '#ff6b6b' : accentColor }}>{t('topBarDetails.fenceCuts')}</span>
                </div>
                <span className="font-bold text-base tabular-nums" style={{ color: overPar ? '#ff6b6b' : 'hsl(var(--foreground))' }}>
                  {t('topBarDetails.cutsParValue', { used: cutsUsed, par: parCuts })}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                {overPar
                  ? t('topBarDetails.cutsOverPar', { count: cutsUsed - parCuts })
                  : cutsUsed === 0
                    ? t('topBarDetails.cutsParInfo', { par: parCuts })
                    : t('topBarDetails.cutsRemaining', { count: parCuts - cutsUsed })}
              </p>
            </div>

            {/* Thread Locks */}
            <div style={lockMet && lockReq > 0 ? cardHighStyle : cardStyle}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Lock
                    className="w-4 h-4 flex-shrink-0"
                    style={{ color: lockMet && lockReq > 0 ? accentColor : `${accentColor}66` }}
                  />
                  <span className="font-bold text-sm" style={{ color: accentColor }}>{t('topBarDetails.threadLocks')}</span>
                </div>
                <span className="font-bold text-base tabular-nums" style={{ color: lockMet && lockReq > 0 ? accentColor : 'hsl(var(--foreground))' }}>
                  {lockReq > 0 ? `${lockedBalls} / ${lockReq}` : lockedBalls}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                {lockReq > 0
                  ? lockMet
                    ? t('topBarDetails.lockObjectiveMet', { locked: lockedBalls, required: lockReq })
                    : t('topBarDetails.lockObjectivePending', { required: lockReq, more: lockReq - lockedBalls })
                  : lockedBalls > 0
                    ? t('topBarDetails.lockNoneRequiredWithLocks', { count: lockedBalls })
                    : t('topBarDetails.lockNoneRequired')}
              </p>
            </div>
          </div>
        </section>

        {/* ── ASSIGNMENT ── contract, Promotion, map mutator, optional objective. */}
        {hasAssignment && (
          <section>
            <p style={sectionHeadStyle}>{t('topBarDetails.assignment')}</p>
            <div className="space-y-3">
              {activeDoor && (
                <div style={{ ...cardStyle, border: '1px solid #ffb34755' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Ticket className="w-4 h-4 flex-shrink-0" style={{ color: '#ffb347' }} />
                    <span className="font-bold text-sm" style={{ color: '#ffb347' }}>{contentText.doorName(t, activeDoor)}</span>
                  </div>
                  <p className="text-xs"><span className="text-destructive font-semibold">{t('topBar.contractRisk')}</span> <span style={{ color: '#c8ffd8', opacity: 0.7 }}>{contentText.doorRisk(t, activeDoor)}</span></p>
                  <p className="text-xs mt-1"><span className="text-success font-semibold">{t('topBar.contractReward')}</span> <span style={{ color: '#c8ffd8', opacity: 0.7 }}>{contentText.doorReward(t, activeDoor)}</span></p>
                  {activeDoor.clarify && (
                    <p className="text-xs mt-2" style={{ color: '#c8ffd8', opacity: 0.6 }}>{contentText.doorClarify(t, activeDoor)}</p>
                  )}
                </div>
              )}
              {capstone && (
                <div style={{ ...cardStyle, border: '1px solid #ffd54a55' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 flex-shrink-0" style={{ color: '#ffd54a' }} />
                    <span className="font-bold text-sm" style={{ color: '#ffd54a' }}>{contentText.capstoneName(t, capstone)}</span>
                  </div>
                  <p className="text-xs" style={{ color: '#c8ffd8', opacity: 0.75 }}>{contentText.capstoneDesc(t, capstone)}</p>
                  {capstone.clarify && (
                    <p className="text-xs mt-2" style={{ color: '#c8ffd8', opacity: 0.6 }}>{contentText.capstoneClarify(t, capstone)}</p>
                  )}
                </div>
              )}
              {mapMutator && (
                <div style={{ ...cardStyle, border: '1px solid #c084fc55' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Wind className="w-4 h-4 flex-shrink-0" style={{ color: '#c084fc' }} />
                    <span className="font-bold text-sm" style={{ color: '#c084fc' }}>{contentText.mutatorName(t, mapMutator)}</span>
                  </div>
                  <p className="text-xs" style={{ color: '#c8ffd8', opacity: 0.75 }}>{contentText.mutatorDesc(t, mapMutator)}</p>
                  {mapMutator.clarify && (
                    <p className="text-xs mt-2" style={{ color: '#c8ffd8', opacity: 0.6 }}>{contentText.mutatorClarify(t, mapMutator)}</p>
                  )}
                </div>
              )}
              {objective && (
                <div style={{ ...cardStyle, border: `1px solid ${objectiveOverBudget ? '#f8717155' : '#34d39955'}` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 flex-shrink-0" style={{ color: objectiveOverBudget ? '#f87171' : '#34d399' }} />
                    <span className="font-bold text-sm" style={{ color: objectiveOverBudget ? '#f87171' : '#34d399' }}>{contentText.objectiveName(t, objective)}</span>
                  </div>
                  <p className="text-xs" style={{ color: '#c8ffd8', opacity: 0.75 }}>{contentText.objectiveDesc(t, objective)}</p>
                  <p className="text-xs mt-2" style={{ color: objectiveComplete ? '#34d399' : objectiveOverBudget ? '#f87171' : undefined }}>
                    <span className="font-semibold">{t('topBar.objectiveReward', { hours: objective.reward })}</span>
                    {objectiveProgress && (
                      <>{' '}<span className="tabular-nums" style={{ color: '#c8ffd8', opacity: 0.7 }}>{objectiveProgress.current}/{objectiveProgress.target}{objectiveComplete ? ' ✓' : ''}</span></>
                    )}
                  </p>
                  {objective.clarify && (
                    <p className="text-xs mt-2" style={{ color: '#c8ffd8', opacity: 0.6 }}>{contentText.objectiveClarify(t, objective)}</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── YOUR STATUS ── */}
        <section>
          <p style={sectionHeadStyle}>{t('topBarDetails.yourStatus')}</p>
          <div className="space-y-3">

            {/* Lives */}
            <div style={cardStyle}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 flex-shrink-0" style={{ color: accentColor, fill: accentColor }} />
                  <span className="font-bold text-sm" style={{ color: accentColor }}>{t('topBarDetails.livesRemaining')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Heart
                    className="w-5 h-5"
                    style={{ color: accentColor, fill: accentColor, filter: `drop-shadow(0 0 5px ${accentColor}99)` }}
                  />
                  {lives > 0 ? (
                    <span className="font-bold text-base tabular-nums" style={{ color: accentColor }}>{lives}</span>
                  ) : (
                    <span className="font-bold text-sm" style={{ color: '#ff6b6b' }}>{t('topBarDetails.livesNone')}</span>
                  )}
                </div>
              </div>
              <p className="text-xs leading-relaxed mt-2" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                {t('topBarDetails.livesDescription')}
              </p>
            </div>

            {/* Continues (per-run revives) */}
            <div style={cardStyle}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                  <span className="font-bold text-sm" style={{ color: accentColor }}>{t('topBarDetails.continues')}</span>
                </div>
                <span className="font-bold text-base tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
                  {continuesRemaining}
                </span>
              </div>
              <p className="text-xs leading-relaxed mt-2" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                {t('topBarDetails.continuesDescription')}
              </p>
            </div>

            {/* Certificate-hour progress */}
            {certificateProgress && (
              <div style={cardStyle}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Hexagon className="w-4 h-4 flex-shrink-0" style={{ color: '#ffffff' }} />
                    <span className="font-bold text-sm" style={{ color: accentColor }}>{t('topBarDetails.certificatePoints')}</span>
                  </div>
                  <span className="font-bold text-base tabular-nums" style={{ color: '#ffffff' }}>
                    {certificateProgress.progressInCurrentHour} / {certificateProgress.levelsPerHour}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                  {t('topBarDetails.certPointsEarned', { count: certificateProgress.hoursEarned })}
                  {' '}{t('topBarDetails.certPointsToGo', { count: certificateProgress.levelsPerHour - certificateProgress.progressInCurrentHour })}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── ACTIVE UPGRADES ── */}
        {ownedUpgrades.length > 0 && (
          <section>
            <p style={sectionHeadStyle}>{t('topBarDetails.activeUpgradesCount', { count: ownedUpgrades.length })}</p>
            <div className="space-y-3">
              {ownedUpgrades.map(upgrade => {
                const Icon = getUpgradeIcon(upgrade, ownedUpgrades);
                return (
                <div key={upgrade.id} style={cardStyle}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="font-bold text-sm leading-tight flex items-center gap-2" style={{ color: accentColor }}>
                      {Icon && <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />}
                      {contentText.upgradeName(t, upgrade)}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded font-bold flex-shrink-0"
                      style={{ backgroundColor: `${accentColor}22`, border: `1px solid ${accentColor}55`, color: accentColor }}
                    >
                      {contentText.tier(t, upgrade.tier)}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.7 }}>
                    {contentText.upgradeDesc(t, upgrade)}
                  </p>
                  {upgrade.id.startsWith('micro_manager_') && microManagerPerLock > 0 && (
                    <p className="text-xs font-bold mt-2" style={{ color: accentColor }}>
                      {t('topBarDetails.currentlyReducingBallSpeed', { percent: Math.min(50, Math.round(lockedBalls * microManagerPerLock * 100)) })}
                    </p>
                  )}
                </div>
                );
              })}
            </div>
          </section>
        )}

        {ownedUpgrades.length === 0 && (
          <section>
            <p style={sectionHeadStyle}>{t('topBarDetails.activeUpgrades')}</p>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <p className="text-xs" style={{ color: '#4a7a5a' }}>
                {t('topBarDetails.noUpgrades')}
              </p>
            </div>
          </section>
        )}

        {/* ── ATTRIBUTES ── the merged modifiers and what feeds each. */}
        {activeModifiers && (
          <section>
            <p style={sectionHeadStyle}>{t('topBarDetails.attributes')}</p>
            <ModifierBreakdown
              activeModifiers={activeModifiers}
              modifierSources={modifierSources}
              accentColor={accentColor}
              lockedBalls={lockedBalls}
            />
          </section>
        )}

        {/* Bottom spacer so content clears the safe area */}
        <div className="h-4" />
      </div>
    </div>
  );
}
