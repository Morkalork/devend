import { X } from 'lucide-react';
import { Heart, Lock, Scissors, Target, Hexagon } from 'lucide-react';
import { UpgradeConfig } from '@/types/upgrade';

interface AugmentProgress {
  levelsCompleted: number;
  levelsToNextPoint: number;
  progressInCurrentPoint: number;
  pointsEarned: number;
  levelsPerPoint: number;
}

interface TopInfoPanelProps {
  visible: boolean;
  onClose: () => void;
  levelNumber: number;
  cutsUsed: number;
  parCuts: number;
  lives: number;
  spaceRemaining: number;
  spaceRequired: number;
  lockedBalls: number;
  threadLockRequired?: number;
  ownedUpgrades: UpgradeConfig[];
  accentColor?: string;
  augmentProgress?: AugmentProgress;
  microManagerPerLock?: number;
}

export function TopInfoPanel({
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
  augmentProgress,
  microManagerPerLock = 0,
}: TopInfoPanelProps) {
  if (!visible) return null;

  const lockReq = threadLockRequired ?? 0;
  const lockMet = lockedBalls >= lockReq;
  const overPar = cutsUsed > parCuts;

  const sectionHeadStyle: React.CSSProperties = {
    color: `${accentColor}88`,
    fontFamily: 'Orbitron, sans-serif',
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
          style={{ fontFamily: 'Orbitron, sans-serif', color: accentColor, textShadow: `0 0 20px ${accentColor}55` }}
        >
          Level {levelNumber} Status
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

        {/* ── OBJECTIVES ── */}
        <section>
          <p style={sectionHeadStyle}>Objectives</p>
          <div className="space-y-3">

            {/* Space capture */}
            <div style={spaceRemaining <= spaceRequired ? cardHighStyle : cardStyle}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                  <span className="font-bold text-sm" style={{ color: accentColor }}>Territory Capture</span>
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
                  ? `Goal met! You have captured ${spaceRemaining}% (needed ${spaceRequired}%).`
                  : `Capture at least ${spaceRequired}% of the board. Currently at ${spaceRemaining}% — need ${spaceRemaining - spaceRequired}% more.`}
              </p>
            </div>

            {/* Cuts / Par */}
            <div style={overPar ? { ...cardStyle, border: `1px solid #ff6b6b44` } : cardStyle}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Scissors className="w-4 h-4 flex-shrink-0" style={{ color: overPar ? '#ff6b6b' : accentColor }} />
                  <span className="font-bold text-sm" style={{ color: overPar ? '#ff6b6b' : accentColor }}>Fence Cuts</span>
                </div>
                <span className="font-bold text-base tabular-nums" style={{ color: overPar ? '#ff6b6b' : 'hsl(var(--foreground))' }}>
                  {cutsUsed} / {parCuts} par
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                {overPar
                  ? `Over par by ${cutsUsed - parCuts} cut${cutsUsed - parCuts !== 1 ? 's' : ''}. Score multiplier is reduced when exceeding par.`
                  : cutsUsed === 0
                    ? `Par is ${parCuts} cuts. Staying within par gives a score bonus.`
                    : `${parCuts - cutsUsed} cut${parCuts - cutsUsed !== 1 ? 's' : ''} remaining before par. Great work!`}
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
                  <span className="font-bold text-sm" style={{ color: accentColor }}>Thread Locks</span>
                </div>
                <span className="font-bold text-base tabular-nums" style={{ color: lockMet && lockReq > 0 ? accentColor : 'hsl(var(--foreground))' }}>
                  {lockReq > 0 ? `${lockedBalls} / ${lockReq}` : lockedBalls}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                {lockReq > 0
                  ? lockMet
                    ? `Lock objective met! ${lockedBalls} of ${lockReq} balls locked.`
                    : `Lock ${lockReq} balls by trapping them with fences. ${lockReq - lockedBalls} more needed.`
                  : lockedBalls > 0
                    ? `${lockedBalls} ball${lockedBalls !== 1 ? 's' : ''} locked. No lock requirement this level.`
                    : 'No thread lock requirement this level.'}
              </p>
            </div>
          </div>
        </section>

        {/* ── YOUR STATUS ── */}
        <section>
          <p style={sectionHeadStyle}>Your Status</p>
          <div className="space-y-3">

            {/* Lives */}
            <div style={cardStyle}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 flex-shrink-0" style={{ color: accentColor, fill: accentColor }} />
                  <span className="font-bold text-sm" style={{ color: accentColor }}>Lives Remaining</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: lives }).map((_, i) => (
                    <Heart
                      key={i}
                      className="w-5 h-5"
                      style={{ color: accentColor, fill: accentColor, filter: `drop-shadow(0 0 5px ${accentColor}99)` }}
                    />
                  ))}
                  {lives === 0 && (
                    <span className="font-bold text-sm" style={{ color: '#ff6b6b' }}>None!</span>
                  )}
                </div>
              </div>
              <p className="text-xs leading-relaxed mt-2" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                You lose a life when a ball hits your fence while it is growing. Run out of lives and the level restarts.
              </p>
            </div>

            {/* Augment progress */}
            {augmentProgress && (
              <div style={cardStyle}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Hexagon className="w-4 h-4 flex-shrink-0" style={{ color: '#ffffff' }} />
                    <span className="font-bold text-sm" style={{ color: accentColor }}>Certificate Points</span>
                  </div>
                  <span className="font-bold text-base tabular-nums" style={{ color: '#ffffff' }}>
                    {augmentProgress.progressInCurrentPoint} / {augmentProgress.levelsPerPoint}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.6 }}>
                  {augmentProgress.pointsEarned} point{augmentProgress.pointsEarned !== 1 ? 's' : ''} earned so far.
                  {' '}Complete {augmentProgress.levelsPerPoint - augmentProgress.progressInCurrentPoint} more level{augmentProgress.levelsPerPoint - augmentProgress.progressInCurrentPoint !== 1 ? 's' : ''} to earn the next cert point and unlock upgrades in the Certificate Store.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── ACTIVE UPGRADES ── */}
        {ownedUpgrades.length > 0 && (
          <section>
            <p style={sectionHeadStyle}>Active Upgrades ({ownedUpgrades.length})</p>
            <div className="space-y-3">
              {ownedUpgrades.map(upgrade => (
                <div key={upgrade.id} style={cardStyle}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="font-bold text-sm leading-tight" style={{ color: accentColor }}>{upgrade.name}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded font-bold flex-shrink-0"
                      style={{ backgroundColor: `${accentColor}22`, border: `1px solid ${accentColor}55`, color: accentColor }}
                    >
                      {upgrade.tier}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.7 }}>
                    {upgrade.description}
                  </p>
                  {upgrade.id.startsWith('micro_manager_') && microManagerPerLock > 0 && (
                    <p className="text-xs font-bold mt-2" style={{ color: accentColor }}>
                      Currently reducing ball speed by {Math.min(70, Math.round(lockedBalls * microManagerPerLock * 100))}%
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {ownedUpgrades.length === 0 && (
          <section>
            <p style={sectionHeadStyle}>Active Upgrades</p>
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <p className="text-xs" style={{ color: '#4a7a5a' }}>
                No upgrades purchased yet. Visit the upgrade shop between levels to power up your run.
              </p>
            </div>
          </section>
        )}

        {/* Bottom spacer so content clears the safe area */}
        <div className="h-4" />
      </div>
    </div>
  );
}
