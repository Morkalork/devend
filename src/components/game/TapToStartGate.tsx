/**
 * TapToStartGate — mobile-web audio unlock.
 *
 * Browsers block audible sound until the first user gesture, so on the deployed
 * web build the menu track can't autoplay. This full-screen "tap to start" gate
 * appears only when autoplay was actually blocked (see isAwaitingUserGesture);
 * the first tap unlocks audio, starts the menu loop, and dismisses the gate, so
 * the player lands on the welcome menu with music already playing.
 *
 * It never shows where autoplay is allowed (the installed Android app, or a
 * desktop browser with media-engagement autoplay) because audio unlocks there
 * without a gesture.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { isAudioUnlocked, isAwaitingUserGesture, startMenuMusic } from '@/lib/gameMusic';

export function TapToStartGate({ accentColor }: { accentColor?: string }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  // playMainMusic() runs on the welcome mount and its autoplay rejection resolves
  // a tick later, so poll briefly to learn whether a gesture is needed. Stop as
  // soon as it's decided (shown, or already unlocked), and give up after a few
  // seconds where autoplay was allowed (nothing to gate).
  useEffect(() => {
    if (isAudioUnlocked()) return;
    let ticks = 0;
    const id = setInterval(() => {
      if (isAudioUnlocked()) { setShow(false); clearInterval(id); return; }
      if (isAwaitingUserGesture()) { setShow(true); clearInterval(id); return; }
      if (++ticks > 30) clearInterval(id); // ~4.5s: autoplay allowed, no gate needed
    }, 150);
    return () => clearInterval(id);
  }, []);

  const handleStart = () => {
    startMenuMusic(); // the tap also trips the global unlock listener; this is belt-and-suspenders
    setShow(false);
  };

  const accent = accentColor || '#00ff88';

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="tap-to-start"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={handleStart}
          role="button"
          aria-label={t('welcome.tapToStart')}
          className="fixed inset-0 z-[9000] flex flex-col items-center justify-center gap-10 cursor-pointer select-none"
          style={{ backgroundColor: 'rgba(0, 8, 4, 0.97)' }}
        >
          <motion.h1
            className="game-title animate-pulse-glow"
            initial={{ scale: 0.92 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            Dev/End
          </motion.h1>

          <motion.p
            className="font-display text-2xl font-bold tracking-[0.35em] uppercase"
            style={{ color: accent, textShadow: `0 0 18px ${accent}` }}
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
          >
            {t('welcome.tapToStart')}
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
