import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Loader2, Sparkles, Hexagon, Trophy, Backpack, Medal, CalendarDays, Flame, Check, X } from 'lucide-react';
import { CRTBackground } from './CRTBackground';
import { MemoryParallaxLayer } from './MemoryParallaxLayer';
import { version } from '@/lib/version';
import type { MenuHighlightFlags, MenuHighlightKey } from '@/hooks/useMenuHighlights';

interface WelcomeScreenProps {
  onStartGame: () => void;
  /** When a saved run exists, resumes it. Absent = no save (single Start Game button). */
  onContinue?: () => void;
  onTutorial: () => void;
  onOptions: () => void;
  onOpenCertificateStore?: () => void;
  onLoadouts?: () => void;
  /** Opens the Performance Review (records). Absent until a run has banked. */
  onHallOfFame?: () => void;
  /** Starts today's seeded Daily Stand-up run (HIGHSCORES.md Phase D). */
  onDaily?: () => void;
  /** First tap on Daily Stand-up shows an intro modal before the run starts. */
  showDailyIntro?: boolean;
  /** Marks the Daily Stand-up intro as seen (persisted tutorial flag). */
  onDailyIntroSeen?: () => void;
  /** Attendance streak shown on the daily button (0 = hidden). */
  dailyStreak?: number;
  /** True when today's stand-up already has a banked run (shows a check). */
  dailyDoneToday?: boolean;
  onAchievements?: () => void;
  onAdmin?: () => void;
  /** Secret gesture: tapping the animated ball 10x unlocks admin (deployed dev). */
  onSecretUnlock?: () => void;
  isLoading?: boolean;
  error?: string | null;
  accentColor?: string;
  totalCertificateHours?: number;
  completedAchievementCount?: number;
  /** First-time highlights: which buttons get the gold ring + NEW badge. */
  highlights?: Partial<MenuHighlightFlags>;
  /** Called when a highlighted button is tapped, clearing its highlight. */
  onHighlightSeen?: (key: MenuHighlightKey) => void;
}

export function WelcomeScreen({
  onStartGame,
  onContinue,
  onTutorial,
  onOptions,
  onOpenCertificateStore,
  onLoadouts,
  onHallOfFame,
  onDaily,
  showDailyIntro = false,
  onDailyIntroSeen,
  dailyStreak = 0,
  dailyDoneToday = false,
  onAchievements,
  onAdmin,
  onSecretUnlock,
  isLoading,
  error,
  accentColor,
  totalCertificateHours,
  completedAchievementCount,
  highlights,
  onHighlightSeen,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  // Secret admin unlock: 10 taps on the animated ball (deployed dev). Taps must
  // come in quick succession - a >1.2s gap resets the count, so it's deliberate.
  const secretTapsRef = useRef(0);
  const secretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSecretTap = () => {
    if (!onSecretUnlock) return;
    if (secretTimerRef.current) clearTimeout(secretTimerRef.current);
    secretTapsRef.current += 1;
    if (secretTapsRef.current >= 10) {
      secretTapsRef.current = 0;
      onSecretUnlock();
      return;
    }
    secretTimerRef.current = setTimeout(() => { secretTapsRef.current = 0; }, 1200);
  };
  useEffect(() => () => { if (secretTimerRef.current) clearTimeout(secretTimerRef.current); }, []);
  const [showCertInfo, setShowCertInfo] = useState(false);
  const [showDailyInfo, setShowDailyInfo] = useState(false);
  // When certificates aren't unlocked yet the store callback is absent; instead
  // of a dead button we keep it tappable and explain how to gain access.
  const certLocked = !onOpenCertificateStore;
  // Tapping a highlighted button acknowledges its first-time highlight.
  const ackHighlight = (key: MenuHighlightKey) => {
    if (highlights?.[key]) onHighlightSeen?.(key);
  };
  const newBadge = (
    <span className="menu-highlight-badge" aria-label={t('welcome.newBadge')}>
      <Sparkles className="w-3 h-3" />
    </span>
  );

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <MemoryParallaxLayer accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center p-6 relative z-10" style={{ backgroundColor: 'hsl(var(--background) / 0.85)' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-64 h-64 rounded-full bg-primary/5 blur-3xl"
          animate={{
            x: [0, 100, 0],
            y: [0, -50, 0],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          style={{ top: '20%', left: '10%' }}
        />
        <motion.div
          className="absolute w-96 h-96 rounded-full bg-accent/5 blur-3xl"
          animate={{
            x: [0, -80, 0],
            y: [0, 60, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          style={{ bottom: '10%', right: '5%' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 flex flex-col items-center gap-12"
      >
        {/* Title */}
        <motion.div
          className="text-center"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
        <h1 className="game-title animate-pulse-glow">
            Dev/End
          </h1>
          <motion.p
            className="mt-4 text-muted-foreground text-lg tracking-wide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {t('welcome.tagline')}
          </motion.p>
        </motion.div>

        {/* Animated spinning ball preview with multi-axis illusion. Doubles as a
            secret admin unlock: 10 quick taps (deployed dev only). */}
        <motion.div
          className="relative w-20 h-20 mt-4 select-none"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          onClick={handleSecretTap}
        >
          {/* Outer glow */}
          <div 
            className="absolute inset-[-8px] rounded-full"
            style={{
              background: 'radial-gradient(circle, hsl(var(--primary) / 0.4) 0%, hsl(var(--primary) / 0.15) 50%, transparent 70%)',
            }}
          />
          
          {/* Ball base with 3D gradient */}
          <div 
            className="absolute inset-0 rounded-full overflow-hidden"
            style={{
              background: 'radial-gradient(ellipse at 30% 30%, hsl(var(--primary) / 1.2) 0%, hsl(var(--primary)) 35%, hsl(var(--primary) / 0.7) 70%, hsl(var(--primary) / 0.5) 100%)',
              boxShadow: '0 0 30px hsl(var(--primary) / 0.5), inset -8px -8px 20px rgba(0,0,0,0.3)',
            }}
          >
            {/* Layer 1: Latitude bands - tilting rotation */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotateX: [0, 20, 0, -20, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                <ellipse cx="40" cy="20" rx="30" ry="6" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
                <ellipse cx="40" cy="35" rx="36" ry="8" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
                <ellipse cx="40" cy="50" rx="36" ry="8" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
                <ellipse cx="40" cy="65" rx="30" ry="6" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
              </svg>
            </motion.div>
            
            {/* Layer 2: Meridian lines - primary spin */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: 360 }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                {/* Vertical meridians with perspective */}
                <ellipse cx="25" cy="40" rx="8" ry="35" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" />
                <ellipse cx="40" cy="40" rx="3" ry="38" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
                <ellipse cx="55" cy="40" rx="8" ry="35" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" />
              </svg>
            </motion.div>
            
            {/* Layer 3: Equatorial band with markers - fast spin */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: -360 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                {/* Thick equator */}
                <line x1="2" y1="40" x2="78" y2="40" stroke="rgba(0,0,0,0.45)" strokeWidth="2.5" strokeLinecap="round" />
                {/* Segment markers */}
                <circle cx="12" cy="40" r="3" fill="rgba(0,0,0,0.35)" />
                <circle cx="28" cy="38" r="2.5" fill="rgba(0,0,0,0.3)" />
                <circle cx="52" cy="38" r="2.5" fill="rgba(0,0,0,0.3)" />
                <circle cx="68" cy="40" r="3" fill="rgba(0,0,0,0.35)" />
              </svg>
            </motion.div>
            
            {/* Layer 4: Polar caps - subtle tilt */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotateY: [0, 15, 0, -15, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80">
                <ellipse cx="40" cy="12" rx="14" ry="5" fill="rgba(0,0,0,0.1)" />
                <ellipse cx="40" cy="68" rx="14" ry="5" fill="rgba(0,0,0,0.1)" />
              </svg>
            </motion.div>
          </div>
          
          {/* Fixed highlight/glare overlay */}
          <div 
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '50%',
              height: '35%',
              top: '10%',
              left: '15%',
              background: 'radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.25) 40%, transparent 70%)',
            }}
          />
          {/* Sharp specular highlight */}
          <div 
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '12%',
              height: '12%',
              top: '18%',
              left: '22%',
              background: 'rgba(255,255,255,0.7)',
            }}
          />
        </motion.div>

        {/* Error state */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </motion.div>
        )}

        {/* Buttons */}
        <motion.div
          className="flex flex-col gap-5 w-full max-w-xs"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {/* Continue only appears when a saved run exists; it shimmers to mark
              it as the recommended action. New Game is always a normal button. */}
          {onContinue && (
            <motion.button
              className="arcade-button-primary arcade-button-sm shimmer rounded-lg flex items-center justify-center gap-2"
              onClick={onContinue}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading}
              style={{ boxShadow: '0 0 24px hsl(var(--primary) / 0.5), 0 0 48px hsl(var(--primary) / 0.2)' }}
            >
              {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('welcome.loading')}</> : t('welcome.continueGame')}
            </motion.button>
          )}
          <motion.button
            className={`arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 ${
              highlights?.newGame ? 'menu-highlight' : onContinue ? '' : 'animate-pulse-glow'
            }`}
            onClick={() => {
              ackHighlight('newGame');
              onStartGame();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
            style={onContinue || highlights?.newGame ? undefined : { boxShadow: '0 0 24px hsl(var(--primary) / 0.5), 0 0 48px hsl(var(--primary) / 0.2)' }}
          >
            {isLoading
              ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('welcome.loading')}</>
              : (onContinue ? t('welcome.newGame') : t('welcome.startGame'))}
            {!isLoading && highlights?.newGame && newBadge}
          </motion.button>
          {/* Daily Stand-up: today's seeded run, same for every player. The
              flame chip is the attendance streak; the check = banked today. */}
          {onDaily && (
            <motion.button
              className={`arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 ${highlights?.daily ? 'menu-highlight' : ''}`}
              onClick={() => {
                ackHighlight('daily');
                // First visit: explain what the Daily Stand-up is before the
                // run starts. Afterwards the button launches straight in.
                if (showDailyIntro) setShowDailyInfo(true);
                else onDaily();
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading}
            >
              <CalendarDays className="w-5 h-5" />
              {t('welcome.dailyStandup')}
              {highlights?.daily && newBadge}
              {dailyStreak > 0 && (
                <span className="ml-1 text-xs bg-white/20 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Flame className="w-3 h-3" style={{ color: '#ffb347' }} />
                  {dailyStreak}
                </span>
              )}
              {dailyDoneToday && <Check className="w-4 h-4 text-success" />}
            </motion.button>
          )}
          <motion.button
            className="arcade-button-primary arcade-button-sm rounded-lg"
            onClick={onTutorial}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            {t('welcome.tutorial')}
          </motion.button>
          <motion.button
            className="arcade-button-primary arcade-button-sm rounded-lg"
            onClick={onOptions}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            {t('welcome.options')}
          </motion.button>
          <motion.button
            className={`arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed ${certLocked ? 'opacity-50 grayscale' : ''} ${highlights?.certificates ? 'menu-highlight' : ''}`}
            onClick={() => {
              ackHighlight('certificates');
              if (onOpenCertificateStore) onOpenCertificateStore();
              else setShowCertInfo(true);
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isLoading}
          >
            <Sparkles className="w-5 h-5" />
            {t('welcome.certificates')}
            {highlights?.certificates && newBadge}
            {totalCertificateHours !== undefined && totalCertificateHours > 0 && (
              <span className="ml-1 text-xs bg-white/20 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <Hexagon className="w-3 h-3" />
                {t('welcome.hoursSuffix', { hours: totalCertificateHours })}
              </span>
            )}
          </motion.button>
          {onLoadouts && (
            <motion.button
              className="arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed"
              onClick={onLoadouts}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading}
            >
              <Backpack className="w-5 h-5" />
              {t('welcome.loadouts')}
            </motion.button>
          )}
          {onHallOfFame && (
            <motion.button
              className={`arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed ${highlights?.records ? 'menu-highlight' : ''}`}
              onClick={() => {
                ackHighlight('records');
                onHallOfFame();
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading}
            >
              <Medal className="w-5 h-5" />
              {t('welcome.records')}
              {highlights?.records && newBadge}
            </motion.button>
          )}
          {onAchievements && (() => {
            // Available once the player has earned anything to look at — cert
            // hours OR completed achievements. Gating on cert hours alone hid
            // the screen from players who'd completed achievements but never
            // banked an hour (while still showing the completed-count badge).
            const achievementsEnabled = (!!totalCertificateHours || !!completedAchievementCount) && !isLoading;
            return (
            <motion.button
              className={`arcade-button-primary arcade-button-sm rounded-lg flex items-center justify-center gap-2 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed ${highlights?.achievements && achievementsEnabled ? 'menu-highlight' : ''}`}
              onClick={() => {
                ackHighlight('achievements');
                onAchievements();
              }}
              whileHover={achievementsEnabled ? { scale: 1.02 } : undefined}
              whileTap={achievementsEnabled ? { scale: 0.98 } : undefined}
              disabled={!achievementsEnabled}
            >
              <Trophy className="w-5 h-5" />
              {t('welcome.achievements')}
              {highlights?.achievements && achievementsEnabled && newBadge}
              {completedAchievementCount !== undefined && completedAchievementCount > 0 && (
                <span className="ml-1 text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">
                  {completedAchievementCount}
                </span>
              )}
            </motion.button>
            );
          })()}
          {onAdmin && (
            <motion.button
              className="arcade-button-secondary arcade-button-sm rounded-lg opacity-70"
              onClick={onAdmin}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {t('welcome.admin')}
            </motion.button>
          )}
        </motion.div>
      </motion.div>
      <div className="absolute bottom-3 right-4 text-xs font-mono opacity-30 pointer-events-none select-none"
        style={{ color: '#00ff88' }}>
        v{version}
      </div>
    </div>
    {/* Explainer shown when certificates aren't unlocked yet. Tapping the
        backdrop or the X closes it. */}
    <AnimatePresence>
      {showCertInfo && (
        <motion.div
          key="cert-info"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShowCertInfo(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
        >
          <motion.div
            initial={{ scale: 0.92, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 8, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-xl border-2 bg-card p-5 shadow-xl"
            style={{ borderColor: accentColor ? `${accentColor}66` : undefined }}
          >
            <button
              onClick={() => setShowCertInfo(false)}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-3 pr-6">
              <Sparkles className="w-7 h-7 shrink-0 text-primary" />
              <div className="text-base font-bold text-foreground">{t('welcome.certLockedTitle')}</div>
            </div>

            <p className="text-sm text-muted-foreground whitespace-pre-line">{t('welcome.certLockedBody')}</p>

            <button
              onClick={() => setShowCertInfo(false)}
              className="arcade-button-primary arcade-button-sm rounded-lg w-full mt-5"
            >
              {t('welcome.certLockedGotIt')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* First-time Daily Stand-up intro. It gates the run: the only way forward
        is "Start", so a player always sees the explanation before playing.
        Backdrop/X cancels (leaves the flag unset) so it returns next tap. */}
    <AnimatePresence>
      {showDailyInfo && (
        <motion.div
          key="daily-info"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShowDailyInfo(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
        >
          <motion.div
            initial={{ scale: 0.92, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 8, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-xl border-2 bg-card p-5 shadow-xl"
            style={{ borderColor: accentColor ? `${accentColor}66` : undefined }}
          >
            <button
              onClick={() => setShowDailyInfo(false)}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-3 pr-6">
              <CalendarDays className="w-7 h-7 shrink-0 text-primary" />
              <div className="text-base font-bold text-foreground">{t('welcome.dailyIntroTitle')}</div>
            </div>

            <p className="text-sm text-muted-foreground whitespace-pre-line">{t('welcome.dailyIntroBody')}</p>

            <button
              onClick={() => {
                setShowDailyInfo(false);
                onDailyIntroSeen?.();
                onDaily?.();
              }}
              className="arcade-button-primary arcade-button-sm rounded-lg w-full mt-5"
            >
              {t('welcome.dailyIntroStart')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
