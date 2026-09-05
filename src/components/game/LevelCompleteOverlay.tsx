import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, ArrowRight, Sparkles, TrendingUp, TrendingDown, Target, Lock, Clock, Zap, Medal, Hammer, Timer, Info, X, Gift, Gem, ChevronDown, Layers } from 'lucide-react';
import { LevelScoreData } from '@/types/game';
import { Certificate } from '@/types/certificate';
import { getAbility } from '@/lib/abilities';
import { isFlawlessRun } from '@/lib/scoreAxes';
import { contentText } from '@/i18n/content';
import { PerformanceReviewAxes } from './PerformanceReviewAxes';

// Press-and-hold info cards: each stat row explains its mechanic and how to
// earn more from it (keys under levelComplete.info.<key> in the locales).
const STAT_INFO: Record<string, { icon: typeof Clock; color: string }> = {
  level: { icon: Trophy, color: 'text-success' },
  remaining: { icon: Target, color: 'text-foreground' },
  fencesUsed: { icon: Target, color: 'text-foreground' },
  spaceBonus: { icon: Sparkles, color: 'text-primary' },
  baseOvertime: { icon: Clock, color: 'text-foreground' },
  threadLocks: { icon: Lock, color: 'text-cyan-400' },
  superiorLocks: { icon: Medal, color: 'text-cyan-300' },
  zoneLocks: { icon: Target, color: 'text-fuchsia-300' },
  breakBonus: { icon: Hammer, color: 'text-amber-400' },
  shipEarly: { icon: Timer, color: 'text-teal-400' },
  winBonus: { icon: Trophy, color: 'text-violet-400' },
  pushBonus: { icon: Zap, color: 'text-orange-400' },
  pickupBonus: { icon: Gift, color: 'text-fuchsia-400' },
  newHighscore: { icon: TrendingUp, color: 'text-yellow-400' },
  totalBonus: { icon: Sparkles, color: 'text-success' },
  overtimeEarned: { icon: Clock, color: 'text-primary' },
  totalOvertime: { icon: Clock, color: 'text-accent-foreground' },
  recordPace: { icon: TrendingUp, color: 'text-success' },
  // The Performance Review lanes. Holding a bar explains what that lane
  // pays for and, more usefully, what it costs you on the others.
  axis_delivery: { icon: Lock, color: 'text-cyan-400' },
  axis_craft: { icon: Medal, color: 'text-cyan-300' },
  axis_tempo: { icon: Timer, color: 'text-teal-400' },
  axis_thrift: { icon: Target, color: 'text-success' },
  axis_greed: { icon: Sparkles, color: 'text-primary' },
  axis_engagement: { icon: Hammer, color: 'text-amber-400' },
};

interface LevelCompleteOverlayProps {
  scoreData: LevelScoreData;
  totalScore: number;
  onContinue: () => void;
  accentColor?: string;
  /** ms to wait before enabling the Continue button (lets the dissolve animation finish) */
  buttonDelay?: number;
  /** Certs newly unlocked this level — shown before the Continue button */
  newlyUnlockedCerts?: Certificate[];
  /**
   * Record Pace (HIGHSCORES.md): cumulative-overtime delta vs the best run at
   * the same maps-completed point, plus the once-per-run PB banner flag.
   */
  pace?: { delta: number | null; newPersonalBest: boolean } | null;
}

export function LevelCompleteOverlay({ scoreData, totalScore, onContinue, accentColor, buttonDelay = 900, newlyUnlockedCerts, pace }: LevelCompleteOverlayProps) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(false);
  const [buttonReady, setButtonReady] = useState(buttonDelay === 0);
  const [displayLevelScore, setDisplayLevelScore] = useState(0);
  const [displayTotalScore, setDisplayTotalScore] = useState(0);
  // Stat row whose info card is open via press-and-hold (same pattern as the
  // upgrade shop's detail card: 450ms hold, >10px movement cancels for scroll).
  const [infoKey, setInfoKey] = useState<string | null>(null);
  // Itemised breakdown, collapsed by default. Every new scoring mechanic adds a
  // row here and none are ever removed, so the screen grew without bound; the
  // totals below it are fixed-size and stay out of the fold.
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const startLongPress = useCallback((key: string, e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    cancelLongPress();
    longPressTimer.current = setTimeout(() => setInfoKey(key), 450);
  }, [cancelLongPress]);

  const moveLongPress = useCallback((e: React.PointerEvent) => {
    const start = pointerStart.current;
    if (start && (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10)) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const hold = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => startLongPress(key, e),
    onPointerUp: cancelLongPress,
    onPointerLeave: cancelLongPress,
    onPointerCancel: cancelLongPress,
    onPointerMove: moveLongPress,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: { touchAction: 'pan-y' } as React.CSSProperties,
  });

  useEffect(() => {
    if (buttonDelay <= 0) return;
    const timer = setTimeout(() => setButtonReady(true), buttonDelay);
    return () => clearTimeout(timer);
  }, [buttonDelay]);

  useEffect(() => {
    const DELAY = 380;
    const DURATION = 900;
    const startTime = performance.now() + DELAY;
    let rafId: number;
    const animate = (now: number) => {
      if (now < startTime) { rafId = requestAnimationFrame(animate); return; }
      const progress = Math.min(1, (now - startTime) / DURATION);
      const ease = 1 - (1 - progress) * (1 - progress) * (1 - progress);
      setDisplayLevelScore(Math.round(scoreData.levelScore * ease));
      setDisplayTotalScore(Math.round(totalScore * ease));
      if (progress < 1) rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [scoreData.levelScore, totalScore]);
  const {
    levelNumber,
    levelId,
    cutCount,
    expectedCuts,
    basePoints,
    levelScore,
    remainingPercent,
    overcutBonus = 0,
    pushFailed = false,
    underParBonus = 0,
    spaceBonus = 0,
    spaceBonusRaw = 0,
    zoneShareWithheld = 0,
    multipliedBase,
    mapCeiling,
    performanceMultiplier = 1,
    fencesUnderPar = 0,
    fencesOverPar = 0,
    extraPercent = 0,
    axes,
    winBonus = 0,
    winBonusPercent = 0,
    lockBonus = 0,
    lockedBallsCount = 0,
    superiorLockCount = 0,
    superiorLockBonus = 0,
    zoneLockCount = 0,
    zoneLockBonus = 0,
    multiLockBonus = 0,
    multiLockBest = 1,
    bouncerOvertime = 0,
    pushBonus = 0,
    breakBonus = 0,
    breakMultiplier = 1,
    shipEarlyBonus = 0,
    pickupBonus = 0,
    clearTimeSeconds = 0,
    beatHighscore = false,
    highscoreBonus = 0,
    wonByAllLocked = false,
    winReason,
    alsoClearedSpace = false,
  } = scoreData;

  const claimedPickups = scoreData.pickupsClaimed ?? [];
  // Treasure-chest rewards smashed this map (#38): collapse duplicates to counts.
  const chestRewards = scoreData.chestRewards ?? [];
  const chestRewardCounts = chestRewards.reduce<Record<string, number>>((m, id) => { m[id] = (m[id] ?? 0) + 1; return m; }, {});
  const isOverPar = fencesOverPar > 0;
  const isSpaceDisabled = fencesOverPar >= 3;
  // Lock income split by quality: the standard row shows only the plain locks,
  // superior (tight-pocket) locks get their own highlighted row below it.
  const standardLockCount = Math.max(0, lockedBallsCount - superiorLockCount);
  // Lock hours as PAID, not as earned. The raw lock stack is multiplicative and
  // routinely runs to several hundred hours; the Delivery and Craft axes are
  // what those hours actually buy. Showing the raw figure here was the old
  // screen's worst lie: it read "+596h" next to a payout of sixty.
  const deliveryPay = axes?.delivery ?? Math.max(0, lockBonus - superiorLockBonus);
  const craftPay = axes?.craft ?? superiorLockBonus;
  const standardLockBonus = deliveryPay;
  const hasLockBonus = standardLockCount > 0 && standardLockBonus > 0;
  const hasSuperiorLocks = craftPay > 0 && (superiorLockCount > 0 || zoneLockCount > 0);
  // Colored Areas: the zone multiplier is folded into lockBonus, so without its
  // own row a var/let/const lock looked exactly like an ordinary one here and
  // the mechanic was invisible the moment the zone stopped glowing. This row
  // reports what the zones ADDED; it is already inside lockBonus, so it must
  // NOT be added to the total again.
  const hasZoneLocks = zoneLockCount > 0 && zoneLockBonus > 0;
  // Multi-locks, for exactly the reason the zone row above exists. Sealing
  // three balls in one cut pays triple, and nothing on this screen said so, so
  // a big multi-lock was indistinguishable from three ordinary locks. Like the
  // zone row this reports what the play ADDED and is already inside lockBonus,
  // so it must NOT be added to the total again.
  const hasMultiLock = multiLockBest > 1 && multiLockBonus > 0;
  // Bumper hours. Unlike the two rows above, these are NOT already inside the
  // lock income: they are paid above the per-map cap with the pickups, so this
  // row reports hours the player would not otherwise see accounted for.
  const hasBouncerHours = bouncerOvertime > 0;
  const hasBreakBonus = breakBonus > 0;
  const hasShipEarlyBonus = shipEarlyBonus > 0;
  const hasPushBonus = pushBonus > 0;
  /**
   * FLAWLESS: every ball on the map locked, and every one of those locks tight.
   *
   * Defined on COUNTS rather than on the Craft ratio, because that ratio can be
   * pushed past 1 by zone and simultaneous multipliers - so a run with one
   * sloppy lock in a const area could reach a full axis and would have claimed
   * this without being flawless at all. The counts cannot lie: n balls, n
   * locks, n of them superior.
   *
   * Deliberately not "max every axis". The tactical axes fight each other by
   * construction and about two are reachable per run, so an all-five badge
   * would be unwinnable. This is the perfection the economy actually offers:
   * you delivered the whole roster and you did it cleanly.
   */
  const flawless = isFlawlessRun(
    lockedBallsCount, superiorLockCount, axes?.ratios.delivery ?? 0,
  );

  const scaledBase = Math.floor(basePoints * performanceMultiplier);
  // Hours the map withheld because its colored areas were left alone.
  // The base the SCORER used, not a recomputation of it. The overlay used to
  // derive it as basePoints x performanceMultiplier and drop the build's score
  // multiplier, so a 1.25x run showed a 20h base inside a 130h total whose
  // visible parts summed to 125.
  const paidBase = Math.round(multipliedBase ?? Math.floor(basePoints * performanceMultiplier));
  const zonesMissedCost = Math.max(0, Math.round(zoneShareWithheld));
  // "Score: x / y". Both ends come from the scorer: y is the base plus every
  // lane's own ceiling, so the fraction adds up to the rows above it and cannot
  // drift from the numerator.
  const earnedTotal = Math.max(0, Math.round(paidBase + (axes?.total ?? 0) - zonesMissedCost));
  const availableTotal = Math.max(earnedTotal, Math.round(mapCeiling ?? 0));
  // "Overtime x / y" on the always-visible row. The Score row above says the
  // same thing but lives inside the itemised breakdown, which is collapsed by
  // default, so the fraction only existed for players who opened a panel most
  // never open - and the headline number alone cannot say whether 84h was the
  // whole map or a third of it.
  //
  // Same denominator as that row on purpose: two fractions on one screen that
  // disagree is worse than one that is hidden. It is the SCORER's ceiling, not
  // a sum of the rows.
  const overtimeCeiling = Math.round(mapCeiling ?? 0);
  // Drop the fraction when the map paid everything it had: "112h" then means
  // the same as "112 / 112h" and reads better.
  //
  // >= rather than ===, which also covers paying ABOVE the ceiling: a win
  // premium or a highscore multiplier is banked on top of it, and "140 / 100h"
  // reads as a bug in the player's favour. It is why this needs no floor at
  // the payout the way the Score row does - that row always draws its
  // fraction, this one stops drawing it exactly where a floor would kick in.
  // A missing mapCeiling (old saves, the game-over path) lands here too and
  // renders the bare number rather than "56 / 0".
  //
  // Compared against the final score, not the animating one, so the "/ y" does
  // not blink away and back during the count-up.
  const overtimeIsFull = levelScore >= overtimeCeiling;
  // The axes ARE the bonus. Push-your-luck hours bank into Greed, the map's
  // features into Engagement and the lock stack into Delivery + Craft, so
  // summing the itemised rows would count each of them twice.
  const totalBonus = (axes
    ? axes.total
    : underParBonus + spaceBonus + lockBonus + pushBonus + breakBonus + shipEarlyBonus)
    + winBonus;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 bg-background/30 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      />

      {/* Modal container: centered on every breakpoint (mobile included), so the
          card sits with even space above and below instead of pinned to the
          bottom edge with a large dead gap at the top. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          className="w-full sm:w-[420px] max-h-full overflow-y-auto"
          initial={{ opacity: 0, y: 55, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 310, damping: 26, mass: 0.85 }}
        >
          <div className="bg-card/60 backdrop-blur-md border border-border rounded-xl p-4 sm:p-6 shadow-2xl">
          {/* Header */}
          <motion.div
            className="flex items-center justify-center gap-2 sm:gap-3 mb-4 sm:mb-6"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.22 }}
          >
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-success/20 flex items-center justify-center">
              <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-success" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-display font-bold text-foreground">{t('levelComplete.title')}</h2>
              <p className="text-muted-foreground text-xs sm:text-sm">{levelId}</p>
              {/* Which condition actually ended the map. Only a space clear opens
                  the Push Your Luck prompt, so without this the prompt's coming
                  and going reads as random. */}
              {winReason && (
                <p className="text-[11px] sm:text-xs text-success/90 mt-0.5">
                  {t('levelComplete.winReason.label')}:{' '}
                  <span className="font-semibold">{t(`levelComplete.winReason.${winReason}`)}</span>
                  {alsoClearedSpace && (
                    <span className="text-muted-foreground">
                      {' '}({t('levelComplete.winReason.alsoCleared')})
                    </span>
                  )}
                </p>
              )}
            </div>
          </motion.div>

          {/* Push Failed Warning */}
          {pushFailed && (
            <div className="mb-4 p-3 bg-warning/10 border border-warning/30 rounded-lg text-center">
              <p className="text-warning text-sm font-medium">
                {t('levelComplete.pushFailed')}{hasPushBonus ? t('levelComplete.pushFailedBonus', { bonus: pushBonus }) : t('levelComplete.pushFailedNoBonus')}
              </p>
            </div>
          )}

          {/* Stats Grid */}
          <motion.div
            className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 text-sm sm:text-base select-none"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.28 }}
          >
            {/* Breakdown toggle. The bonus subtotal rides on the header so the
                collapsed state still answers "was this map worth anything?" -
                otherwise closing it by default would hide the good news. */}
            <button
              type="button"
              onClick={() => setBreakdownOpen(open => !open)}
              aria-expanded={breakdownOpen}
              className="w-full flex items-center justify-between gap-2 py-2 px-2 rounded-lg border border-border hover:border-muted-foreground/60 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
                <Target className="w-3.5 h-3.5" />
                {t('levelComplete.breakdownTitle')}
              </span>
              <span className="flex items-center gap-2">
                {totalBonus > 0 && (
                  <span className="text-success font-bold text-sm">+{totalBonus}h</span>
                )}
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${breakdownOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>

            <AnimatePresence initial={false}>
              {breakdownOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2 sm:space-y-3">

            <div {...hold('level')} className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
              <span className="text-muted-foreground">{t('levelComplete.level')}</span>
              <span className="font-bold text-foreground">{levelNumber}</span>
            </div>

            {/* Remaining space is meaningless on an all-balls-locked auto-win:
                the board fully drains to 0% once no ball is left in play. */}
            {!wonByAllLocked && (
              <div {...hold('remaining')} className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
                <span className="text-muted-foreground">{t('levelComplete.remaining')}</span>
                <span className="font-bold text-foreground">{remainingPercent}%</span>
              </div>
            )}

            {/* FLAWLESS. Above the axes because it is a verdict on the run, not
                a line item in it: the axes say which lanes you took, this says
                you left nothing behind in the one lane that has no trade-off. */}
            {flawless && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.35, type: 'spring', stiffness: 260, damping: 18 }}
                className="flex items-center justify-center gap-2 my-2 py-2 rounded-lg"
                style={{
                  border: '1px solid #ffd54a66',
                  background: 'linear-gradient(90deg, transparent, #ffd54a14 20%, #ffd54a14 80%, transparent)',
                }}
              >
                <Sparkles className="w-4 h-4 shrink-0" style={{ color: '#ffd54a' }} />
                <span
                  className="font-display text-sm font-black uppercase tracking-widest"
                  style={{ color: '#ffd54a', textShadow: '0 0 12px #ffd54a66' }}
                >
                  {t('levelComplete.flawless')}
                </span>
                <span className="text-xs" style={{ color: '#ffd54a', opacity: 0.75 }}>
                  {t('levelComplete.flawlessDetail', { count: lockedBallsCount })}
                </span>
              </motion.div>
            )}

            {/* The Performance Review: which lanes this run committed to.
                Sits above the itemised hours because it is the frame they are
                read in - the numbers below say how much, this says what kind. */}
            {axes && <PerformanceReviewAxes axes={axes} hold={hold} />}

            {/* Fence Efficiency Section */}
            <div {...hold('fencesUsed')} className="py-2 border-b border-border">
              <div className="flex justify-between items-center mb-1">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  {t('levelComplete.fencesUsed')}
                </span>
                <span className="font-bold text-foreground">
                  {cutCount} / {expectedCuts}
                </span>
              </div>

              {fencesUnderPar > 0 && (
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-success flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {t('levelComplete.underPar', { count: fencesUnderPar })}
                  </span>
                  <span className="font-bold text-success">+{underParBonus}h</span>
                </div>
              )}

              {fencesOverPar > 0 && (
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-destructive flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    {t('levelComplete.overPar', { count: fencesOverPar })}
                  </span>
                  <span className="text-destructive text-xs">
                    {t('levelComplete.baseMultiplier', { multiplier: performanceMultiplier })}
                    {isSpaceDisabled && t('levelComplete.noSpaceBonus')}
                  </span>
                </div>
              )}
            </div>

            {/* Space Optimization Section */}
            {extraPercent > 0 && (
              <div {...hold('spaceBonus')} className="py-2 border-b border-border">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    {t('levelComplete.extraSpaceRemoved')}
                  </span>
                  <span className="font-bold text-foreground">+{(extraPercent * 100).toFixed(0)}%</span>
                </div>

                <div className="flex justify-between items-center text-sm">
                  <span className={isSpaceDisabled ? 'text-destructive' : 'text-primary'}>
                    {t('levelComplete.spaceBonus')}
                  </span>
                  <span className={`font-bold ${isSpaceDisabled ? 'text-destructive line-through' : 'text-primary'}`}>
                    {isSpaceDisabled ? `${spaceBonusRaw}h` : spaceBonus > 0 ? `+${spaceBonus}h` : '-'}
                  </span>
                </div>
              </div>
            )}

            {/* ── One list, one idiom ──────────────────────────────────
                This used to be the axes AND an itemised list of the very
                same hours: Delivery WAS Thread Locks, Craft WAS Superior Locks,
                Thrift WAS under-par, Greed WAS the Space Bonus. The same money
                twice, in two vocabularies, plus rows like "Zone Locks +9h" that
                looked like income and were actually contributors to a Craft
                axis already sitting at its ceiling - so a player who took the
                zone read a number that had bought them nothing.

                Now: the base the scorer actually used, the five lanes with what
                each could have paid, then anything earned OUTSIDE those lanes,
                then the fraction. */}
            <div {...hold('baseOvertime')} className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {t('levelComplete.baseOvertime')}
                {isOverPar && (
                  <span className="text-destructive text-xs">{t('levelComplete.multiplierParen', { multiplier: performanceMultiplier })}</span>
                )}
              </span>
              <span className={`font-bold ${isOverPar ? 'text-destructive' : 'text-foreground'}`}>
                {paidBase}h
              </span>
            </div>

            {/* What skipping the colored areas cost. A percentage, because that
                is what it is: the share comes off everything above, not out of
                a lane of its own. */}
            {zonesMissedCost > 0 && (
              <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  {t('levelComplete.zonesMissed')}
                </span>
                <span className="font-bold text-destructive">-{zonesMissedCost}h</span>
              </div>
            )}

            {winBonus > 0 && (
              <div {...hold('winBonus')} className="flex justify-between items-center py-2 border-b border-violet-500/30 bg-violet-500/10 rounded px-2">
                <span className="text-violet-400 flex items-center gap-1">
                  <Trophy className="w-3 h-3 sm:w-4 sm:h-4" />
                  {t('levelComplete.winBonus', { percent: Math.round(winBonusPercent) })}
                </span>
                <span className="font-bold text-violet-400">+{winBonus}h</span>
              </div>
            )}
            {beatHighscore && (
              <div {...hold('newHighscore')} className="flex justify-between items-center py-2 border-b rounded px-2" style={{ borderColor: '#ffd54a55', background: '#ffd54a1a', touchAction: 'pan-y' }}>
                <span className="flex items-center gap-1" style={{ color: '#ffd54a' }}>
                  <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                  {t('levelComplete.newHighscore')}
                </span>
                <span className="font-bold" style={{ color: '#ffd54a' }}>+{highscoreBonus}h</span>
              </div>
            )}

            {/* Score: x / y - what you took of what this map could pay.
                Both ends come from the scorer. The overlay adding up its own
                rows is exactly how the base row came to disagree with the
                total by five hours. */}
            <div {...hold('totalBonus')} className="flex justify-between items-center py-2 sm:py-3 bg-success/10 rounded-lg px-2 sm:px-3">
              <span className="font-semibold text-foreground">{t('levelComplete.scoreOutOf')}</span>
              <span className="text-lg sm:text-xl font-bold">
                <span className="text-success">{earnedTotal}</span>
                <span className="text-muted-foreground"> / {availableTotal}h</span>
              </span>
            </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div {...hold('overtimeEarned')} className="flex justify-between items-center py-2 sm:py-3 bg-primary/10 rounded-lg px-2 sm:px-3">
              <span className="font-semibold text-foreground">{t('levelComplete.overtimeEarned')}</span>
              <span className="text-xl sm:text-2xl font-bold text-primary">
                {displayLevelScore}
                {!overtimeIsFull && (
                  <span className="text-base sm:text-lg text-muted-foreground"> / {overtimeCeiling}</span>
                )}
                h
              </span>
            </div>

            {/* Total Overtime: the grand running total and the hero number of
                this screen. Uses the live accent color + a glow so it reads as
                the focal point (the old text-accent-foreground was near-black,
                i.e. dark-on-dark against the faint accent tint). */}
            <div
              {...hold('totalOvertime')}
              className="flex justify-between items-center py-3 sm:py-4 rounded-lg px-3 sm:px-4 border"
              style={{
                background: accentColor ? `${accentColor}22` : 'hsl(var(--accent) / 0.15)',
                borderColor: accentColor ? `${accentColor}66` : 'hsl(var(--accent) / 0.4)',
                touchAction: 'pan-y',
              }}
            >
              <span className="font-bold text-foreground text-base sm:text-lg">{t('levelComplete.totalOvertime')}</span>
              <span
                className="text-2xl sm:text-3xl font-extrabold"
                style={{
                  color: accentColor || 'hsl(var(--accent))',
                  textShadow: accentColor ? `0 0 16px ${accentColor}aa` : '0 0 16px hsl(var(--accent) / 0.65)',
                }}
              >
                {displayTotalScore}h
              </span>
            </div>

            {/* Record Pace: this run vs your best run at the same point. Ahead
                is a lead to defend, behind is a licence to take risks. */}
            {pace && pace.delta !== null && (
              <div {...hold('recordPace')} className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border px-2">
                <span className="text-muted-foreground flex items-center gap-1">
                  {pace.delta >= 0
                    ? <TrendingUp className="w-3 h-3 text-success" />
                    : <TrendingDown className="w-3 h-3 text-destructive" />}
                  {t('levelComplete.recordPace')}
                </span>
                <span className={`font-bold ${pace.delta >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {pace.delta >= 0 ? `+${pace.delta}h` : `${pace.delta}h`}
                </span>
              </div>
            )}

            {/* Once per run: the moment the total passes the all-time best. */}
            {pace?.newPersonalBest && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.35, type: 'spring', stiffness: 260, damping: 18 }}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg border font-bold text-sm"
                style={{ borderColor: '#ffd54a66', background: '#ffd54a1a', color: '#ffd54a', textShadow: '0 0 12px #ffd54a66' }}
              >
                <Medal className="w-4 h-4" />
                {t('levelComplete.newPersonalBest')}
              </motion.div>
            )}

            <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted-foreground/70">
              <Info className="w-3 h-3" />
              <span>{t('levelComplete.holdHint')}</span>
            </div>
          </motion.div>

          {/* Newly unlocked certificates */}
          {newlyUnlockedCerts && newlyUnlockedCerts.length > 0 && (
            <motion.div
              className="mb-4 space-y-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.32, duration: 0.22 }}
            >
              {newlyUnlockedCerts.map(cert => (
                <div
                  key={cert.id}
                  className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10"
                >
                  <Medal className="w-4 h-4 text-yellow-400 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider">{t('levelComplete.certificateUnlocked')}</p>
                    <p className="text-sm text-foreground font-semibold">{contentText.certName(t, cert)}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* Continue Button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.22 }}
          >
            <button
              disabled={chosen || !buttonReady}
              className="arcade-button-primary w-full rounded-lg flex items-center justify-center gap-2 text-sm sm:text-base py-2 sm:py-3 hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:pointer-events-none"
              onClick={() => { setChosen(true); onContinue(); }}
            >
              {t('levelComplete.nextLevel')}
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </motion.div>
        </div>
        </motion.div>
      </div>

      {/* Press-and-hold stat info card: what the row means + how to earn more.
          Tapping the backdrop or the X closes it. */}
      <AnimatePresence>
        {infoKey && STAT_INFO[infoKey] && (() => {
          const { icon: StatIcon, color } = STAT_INFO[infoKey];
          return (
            <motion.div
              key="stat-info"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setInfoKey(null)}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            >
              <motion.div
                initial={{ scale: 0.92, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.92, y: 8, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm max-h-full flex flex-col rounded-xl border-2 bg-card shadow-xl"
                style={{ borderColor: accentColor ? `${accentColor}66` : undefined }}
              >
                <button
                  onClick={() => setInfoKey(null)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
                {/* Bounded and scrollable: a `fixed inset-0` overlay with items-center
                    clips a card taller than the viewport out of BOTH ends, and neither
                    end can be scrolled to. The close button stays outside the scroller. */}
                <div className="overflow-y-auto p-5">

                  <div className="flex items-center gap-3 mb-2 pr-6">
                    <StatIcon className={`w-7 h-7 shrink-0 ${color}`} strokeWidth={1.5} />
                    <div className="text-base font-bold text-foreground">{t(`levelComplete.info.${infoKey}.title`)}</div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-4">{t(`levelComplete.info.${infoKey}.body`)}</p>

                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1.5">
                    {t('levelComplete.infoTipLabel')}
                  </div>
                  <p className="text-sm text-foreground">{t(`levelComplete.info.${infoKey}.tip`)}</p>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </>
  );
}
