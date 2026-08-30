/**
 * The one thing the player must notice without looking away.
 *
 * The deadline's only visual signal used to be a bar draining at the very
 * bottom of the screen, which is the furthest point on a phone from where the
 * player is actually looking. The audio was already right - the heartbeat has
 * fired for the last ten seconds all along - but a player tracking a ball and
 * drawing a fence has no attention to spend on the bottom edge.
 *
 * So the alert goes over the board, where the eyes already are. Two rules make
 * that safe rather than obnoxious:
 *
 * TEXT IS THE LAST CHANNEL, NOT THE FIRST. Reading needs foveal attention: you
 * have to look straight at words. That is exactly what is unavailable in the
 * last ten seconds. The edge pulse carries the signal, because peripheral
 * vision reads motion and contrast rather than glyphs, and the number is a
 * brief flash for the moment the state changes - not a running readout. The
 * exact seconds live in the HUD for a player who chooses to look.
 *
 * IT NEVER TAKES A TAP. `pointer-events: none`, without exception. An alert
 * that swallows the cut which would have saved the run is worse than no alert.
 *
 * ── Why red, and why it pulses ─────────────────────────────────────────────
 *
 * The board edge is not free any more: WinGateFrame uses a steady amber there
 * to mean "this map wants something beyond an ordinary clear". Two things at
 * the same location have to differ on two channels at once or they read as one
 * thing, so this differs in hue AND in motion. A map can be both unusual and
 * nearly out of time, and the two signals stay separable when they overlap.
 * Red-pulsing is also the one alarm nobody has to learn.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/** The alarm colour. Distinct from WinGateFrame's amber on purpose. */
const ALARM = '#ff6b6b';

interface Props {
  /** The deadline is close. Drives the edge. */
  urgent: boolean;
  /**
   * Seconds left, shown once as a flash when it changes. Null hides the
   * numeral entirely and leaves only the edge.
   */
  seconds: number | null;
}

export function BoardAlert({ urgent, seconds }: Props) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  if (!urgent) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 7 }}>
      {/* The signal itself. Under prefers-reduced-motion it holds steady
          instead of pulsing: the alarm survives, only the animation goes. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-sm"
        animate={reduceMotion ? { opacity: 0.85 } : { opacity: [0.35, 1, 0.35] }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          border: `3px solid ${ALARM}`,
          boxShadow: `inset 0 0 26px ${ALARM}66, 0 0 16px ${ALARM}55`,
        }}
      />
      {/* One numeral, keyed on the second so each tick replaces the last
          rather than queueing. Large, brief, and gone: it is a flash marking
          the change, not a clock to read. */}
      {seconds != null && (
        <motion.div
          key={seconds}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0, scale: 1.35 }}
          animate={{ opacity: [0, 0.9, 0], scale: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          aria-hidden
        >
          <span
            className="font-display font-black tabular-nums"
            style={{
              fontSize: 'clamp(3rem, 22vw, 7rem)',
              color: ALARM,
              textShadow: `0 0 40px ${ALARM}, 0 0 12px #000`,
            }}
          >
            {seconds}
          </span>
        </motion.div>
      )}
      {/* The words, for a player who does look. Kept off the middle of the
          board, where the balls are. */}
      <div
        className="absolute inset-x-0 bottom-3 flex justify-center"
        role="status"
        aria-live="assertive"
      >
        <span
          className="font-display text-xs font-bold uppercase tracking-[0.2em]"
          style={{ color: ALARM, textShadow: `0 0 10px ${ALARM}, 0 0 6px #000` }}
        >
          {/* One word, and its job is shape recognition rather than reading:
              a player who can spare the attention to read it did not need it. */}
          {t('game.timeAlarm')}
        </span>
      </div>
    </div>
  );
}
