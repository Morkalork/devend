/**
 * GameTopBar — compact status bar above the board: level, cuts vs par,
 * lives, space cleared, locked balls, certificate-hour progress, and a Specs
 * button. Tapping the bar (or Specs) opens TopBarDetailsPanel, which holds the
 * run's build, upgrades, assignment and attributes.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { unreadManualCount } from '@/lib/manual';
import { Heart, Lock, Scissors, Target, Hexagon, ChevronDown, RotateCcw, TrendingUp, Gauge, Medal, ClipboardList, Info, X } from 'lucide-react';
import { WinGateChip } from '@/components/game/WinGateChip';
import type { WinConditionProgress } from '@/types/winSpec';

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
  /**
   * The map's unusual win requirements with live progress. Empty on an ordinary
   * space-and-locks map, which is most of them.
   */
  winGates?: WinConditionProgress[];
  /** Opens the "How to win" text, which carries the full wording. */
  onExplainWin?: () => void;
  /** Scope Creep speed boost in percent (0 = inactive, chip hidden). */
  scopeCreepPercent?: number;
  accentColor?: string;
  certificateProgress?: CertificateHourProgress;
  ascensionDepth?: number;
  // Map highscore progress (#45): shown only with the Benchmarking certificate and
  // when this map has a stored highscore. current = live projected score.
  showHighscoreBar?: boolean;
  highscoreCurrent?: number;
  highscoreTarget?: number;
  // Record Pace (HIGHSCORES.md): the run's overtime delta vs the best run as
  // of the last completed map. Rides Benchmarking too; null = nothing to race.
  runPaceDelta?: number | null;
  /** Opens the Specs panel (TopBarDetailsPanel). */
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
  winGates,
  onExplainWin,
  scopeCreepPercent = 0,
  accentColor = '#00ff88',
  certificateProgress,
  ascensionDepth = 0,
  showHighscoreBar = false,
  highscoreCurrent = 0,
  highscoreTarget = 0,
  runPaceDelta = null,
  onExpand,
}: GameTopBarProps) {
  // Recomputed per render rather than held in state: the count only changes
  // when a mechanic is first met or the panel is opened, both of which already
  // re-render this bar, and the read is a cached in-memory set.
  const manualUnread = unreadManualCount();
  const { t } = useTranslation();
  const swipeStartYRef = useRef<number | null>(null);

  // Space readout hold-detail: exact remaining/cleared numbers behind the
  // CLEAR / "% to go" chip (handy mid Push Your Luck, when the chip just says
  // CLEAR but the board is still shrinking).
  const [spaceDetail, setSpaceDetail] = useState(false);
  const spaceHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSpaceHold = () => {
    if (spaceHoldTimer.current) { clearTimeout(spaceHoldTimer.current); spaceHoldTimer.current = null; }
  };
  const startSpaceHold = () => {
    cancelSpaceHold();
    spaceHoldTimer.current = setTimeout(() => setSpaceDetail(true), 450);
  };
  useEffect(() => cancelSpaceHold, []);

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
  const [creepFlashKey,  setCreepFlashKey]  = useState(0);
  const prevSpaceRef = useRef(spaceRemaining);
  const prevLivesRef = useRef(lives);
  const prevLocksRef = useRef(lockedBalls);
  const prevCreepRef = useRef(scopeCreepPercent);
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
    // Each Scope Creep surge pulses the chip so the escalation is felt.
    if (scopeCreepPercent > prevCreepRef.current) flash(setCreepFlashKey);
    prevCreepRef.current = scopeCreepPercent;
  }, [scopeCreepPercent, flash]);

  const lockReq = threadLockRequired ?? 0;
  const lockMet = lockedBalls >= lockReq;
  const lockColor = lockReq > 0
    ? (lockMet ? accentColor : 'hsl(var(--foreground))')
    : `${accentColor}66`;

  return (
    <div className="flex-shrink-0 flex flex-col">
      {/* Row 1: Navigation — menu, level, lives, certificate-hour progress */}
      <div
        className={`px-3 py-2 flex items-center justify-between gap-2${onExpand ? ' cursor-pointer' : ''}`}
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
          {/* One heart + a counter: a pile of hearts broke the top-bar layout
              once extra-life upgrades stacked up. */}
          <div
            key={livesFlashKey}
            className={`flex items-center gap-1 ${livesFlashKey > 0 ? 'animate-stat-flash' : ''}`}
            title={t('topBar.lives', { count: lives })}
          >
            <Heart
              className="w-5 h-5 animate-pulse-heart"
              style={{
                color: accentColor,
                fill: accentColor,
                filter: `drop-shadow(0 0 6px ${accentColor}aa)`,
              }}
            />
            <span className="font-display text-sm font-bold tabular-nums" style={{ color: accentColor }}>
              {lives}
            </span>
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
        {/* Certificate hours have moved off the permanent bar: they are a
            between-run currency rather than map state, and the Specs panel
            already renders them in full. Nothing was deleted, only relocated. */}

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

        {/* Space — hold or tap for exact remaining/cleared numbers */}
        <button
          className="relative flex items-center gap-1.5 min-w-0 bg-transparent border-0 p-0 focus:outline-none"
          onPointerDown={startSpaceHold}
          onPointerUp={cancelSpaceHold}
          onPointerLeave={cancelSpaceHold}
          onPointerCancel={cancelSpaceHold}
          onClick={(e) => { e.stopPropagation(); setSpaceDetail(true); }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={t('topBar.spaceTitle')}
        >
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
          <Info className="w-3 h-3 flex-shrink-0 opacity-50" style={{ color: accentColor }} />
        </button>

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

        {/* The unusual requirement, where the player already looks to find out
            where they stand. Only ever rendered on the few maps that have one:
            a chip on every map is chrome the eye learns to skip. */}
        {(winGates ?? []).map(g => (
          <WinGateChip
            key={g.condition.kind + ('ballType' in g.condition ? g.condition.ballType : '')}
            gate={g}
            accentColor={accentColor}
            onExplain={onExplainWin}
          />
        ))}

        {/* Scope Creep: appears once the anti-stall speed surge kicks in */}
        {scopeCreepPercent > 0 && (
          <div
            className="flex items-center gap-1.5 min-w-0"
            title={t('topBar.scopeCreepTitle', { percent: scopeCreepPercent })}
          >
            <Gauge className="w-4 h-4 flex-shrink-0" style={{ color: '#ff6b6b' }} />
            <span
              key={creepFlashKey}
              className={`font-display text-sm font-bold tabular-nums${creepFlashKey > 0 ? ' animate-stat-flash' : ''}`}
              style={{ color: '#ff6b6b', textShadow: '0 0 10px #ff6b6b88' }}
            >
              {t('topBar.scopeCreepValue', { percent: scopeCreepPercent })}
            </span>
          </div>
        )}
      </div>

      {/* Highscore progress (#45): the Benchmarking certificate reveals a second bar
          (bottom) tracking the live projected score vs the map highscore, under
          a bar (top) showing capture progress toward clearing the map. */}
      {showHighscoreBar && highscoreTarget > 0 && (() => {
        const captureFraction = spaceRequired < 100
          ? Math.max(0, Math.min(1, (100 - spaceRemaining) / (100 - spaceRequired)))
          : 0;
        const hsFraction = Math.max(0, Math.min(1, highscoreCurrent / highscoreTarget));
        const beat = highscoreCurrent >= highscoreTarget;
        return (
          <div className="mt-1.5 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: beat ? '#ffd54a' : '#ffb020' }} />
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${captureFraction * 100}%`, background: accentColor }} />
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${hsFraction * 100}%`, background: beat ? '#ffd54a' : '#ffb020', boxShadow: beat ? '0 0 8px #ffd54a88' : 'none' }}
                />
              </div>
            </div>
            <span
              className="font-display text-[10px] font-bold tabular-nums flex-shrink-0"
              style={{ color: beat ? '#ffd54a' : 'hsl(var(--muted-foreground))', textShadow: beat ? '0 0 8px #ffd54a88' : 'none' }}
            >
              {beat ? t('topBar.recordPace') : `${Math.round(hsFraction * 100)}%`}
            </span>
          </div>
        );
      })()}

      {/* Run-pace chip (HIGHSCORES.md): with Benchmarking, keep the delta vs
          your best run visible while playing, not just on the score overlay. */}
      {showHighscoreBar && runPaceDelta !== null && (
        <div className="mt-1 flex items-center justify-end gap-1.5">
          <Medal className="w-3.5 h-3.5 flex-shrink-0" style={{ color: runPaceDelta >= 0 ? '#4ade80' : '#ff6b6b' }} />
          <span
            className="font-display text-[10px] font-bold tabular-nums"
            style={{ color: runPaceDelta >= 0 ? '#4ade80' : '#ff6b6b' }}
          >
            {t('topBar.runPace', { delta: runPaceDelta >= 0 ? `+${runPaceDelta}h` : `${runPaceDelta}h` })}
          </span>
        </div>
      )}

      {/* Row 3: Specs — opens the full run sheet (build, upgrades, assignment,
          attributes). Replaces the old per-upgrade icon row (#61). */}
      {onExpand && (
        <div
          className="px-3 py-1.5"
          style={{
            backgroundColor: 'rgba(0, 10, 5, 0.9)',
            borderBottom: `1px solid ${accentColor}33`,
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onExpand(); }}
            className="w-full h-8 rounded-md flex items-center justify-center gap-2 transition-all duration-200 hover:brightness-125 focus:outline-none"
            style={{
              backgroundColor: `${accentColor}18`,
              border: `1px solid ${accentColor}55`,
              color: accentColor,
            }}
            aria-label={t('topBar.specs')}
          >
            <ClipboardList className="w-4 h-4" strokeWidth={1.5} />
            <span className="font-display text-sm font-bold tracking-widest uppercase">{t('topBar.specs')}</span>
            {/* A new mechanic has been filed in the Manual. This badge is what
                replaced the modal that used to announce it: the player learns
                something is there without losing the frame they were playing. */}
            {manualUnread > 0 && (
              <span
                className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: accentColor, color: '#04160d' }}
                aria-label={t('topBar.specsNew', { count: manualUnread })}
              >
                {manualUnread}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Hold-detail for the Space readout: exact remaining/cleared numbers.
          Reads live, so during Push Your Luck you can watch the board shrink.
          Backdrop tap or the X closes it (the game's standard explainer). */}
      {spaceDetail && (() => {
        const remaining = Math.max(0, Math.min(100, Math.round(spaceRemaining)));
        const cleared = 100 - remaining;
        const goalMet = spaceRemaining <= spaceRequired;
        const toGo = Math.max(0, Math.round(spaceRemaining - spaceRequired));
        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            onClick={() => setSpaceDetail(false)}
          >
            <div
              className="relative w-full max-w-sm max-h-full flex flex-col rounded-xl border-2 bg-card shadow-xl"
              style={{ borderColor: `${accentColor}66` }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setSpaceDetail(false)}
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                aria-label={t('topBar.contractClose')}
              >
                <X className="w-4 h-4" />
              </button>
              {/* Bounded and scrollable: a `fixed inset-0` overlay with items-center
                  clips a card taller than the viewport out of BOTH ends, and neither
                  end can be scrolled to. The close button stays outside the scroller. */}
              <div className="overflow-y-auto p-5">
                <div className="flex items-center gap-3 mb-3 pr-6">
                  <Target className="w-7 h-7 shrink-0" style={{ color: accentColor }} />
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('topBar.spaceTitle')}</div>
                    <div className="text-base font-bold" style={{ color: goalMet ? accentColor : 'hsl(var(--foreground))' }}>
                      {goalMet ? t('topBar.spaceGoalReached') : t('topBar.percentToGo', { percent: toGo })}
                    </div>
                  </div>
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('topBar.spaceLeft')}</div>
                    <div className="font-display text-3xl font-bold tabular-nums" style={{ color: accentColor, textShadow: `0 0 12px ${accentColor}66` }}>
                      {remaining}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('topBar.spaceCleared')}</div>
                    <div className="font-display text-3xl font-bold tabular-nums text-foreground">{cleared}%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
