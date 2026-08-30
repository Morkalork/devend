/**
 * Why you just lost a life, shown before the map restarts.
 *
 * The gap this fills: running out of time docked a life, flashed the screen red
 * and remounted the level, all inside 700ms. Nothing named the clock. From the
 * player's side a life vanished and the board reset, which reads as a bug the
 * first time and as an unfair game the second.
 *
 * So the restart WAITS here. It is dismissed by a tap or by its own timer, and
 * only then does the level remount - the explanation cannot be missed by
 * looking away, and it cannot be scrolled past either, because there is nothing
 * else on screen.
 *
 * It states two things, in this order: what ended the map, then what was still
 * outstanding when it did, with the numbers. The second line is the one worth
 * having. "Out of time" is a rule the player already knew; "you still needed 2
 * locks and had 1" is the information they can act on next attempt.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { AlertTriangle, Heart } from 'lucide-react';
import { failHeadline, failLines, type MapFailure } from '@/lib/mapFailure';

/** Long enough to read two short lines without becoming a wall between attempts. */
export const MAP_FAILED_MS = 4200;

interface Props {
  failure: MapFailure;
  /** Lives left after this one was docked, so the stakes are stated too. */
  livesLeft: number;
  accentColor?: string;
  /** Dismiss: remounts the level and starts the retry. */
  onDismiss: () => void;
}

export function MapFailedOverlay({ failure, livesLeft, accentColor = '#ff2244', onDismiss }: Props) {
  const { t } = useTranslation();
  const [lines] = useState(() => failLines(t, failure));

  // Auto-dismiss, so a player who has already read it is not made to tap, and
  // one who looked away still gets on with the retry.
  useEffect(() => {
    const id = setTimeout(onDismiss, MAP_FAILED_MS);
    return () => clearTimeout(id);
  }, [onDismiss]);

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center px-8"
      style={{ backgroundColor: 'rgba(4, 0, 2, 0.92)', fontFamily: "'JetBrains Mono', monospace" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDismiss}
      role="alertdialog"
      aria-label={t('mapFailure.title')}
    >
      <motion.div
        className="flex flex-col items-center gap-4 max-w-md w-full"
        initial={{ scale: 0.94, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <AlertTriangle className="w-10 h-10" style={{ color: accentColor }} />

        <h2
          className="text-2xl font-black tracking-widest uppercase text-center"
          style={{ fontFamily: 'Michroma, sans-serif', color: accentColor, textShadow: `0 0 22px ${accentColor}66` }}
        >
          {failHeadline(t, failure)}
        </h2>

        {lines.length > 0 && (
          <div
            className="w-full rounded-lg px-4 py-3"
            style={{ border: `1px solid ${accentColor}44`, backgroundColor: `${accentColor}0f` }}
          >
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: `${accentColor}cc` }}>
              {t('mapFailure.stillNeeded')}
            </p>
            <ul className="space-y-1">
              {lines.map((line, i) => (
                <li key={i} className="text-sm" style={{ color: '#e8fff0' }}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.85 }}>
          <Heart className="w-4 h-4" style={{ color: accentColor }} />
          <span>{t('mapFailure.livesLeft', { count: livesLeft })}</span>
        </div>

        <p className="text-xs mt-2" style={{ color: '#c8ffd8', opacity: 0.5 }}>
          {t('mapFailure.tapToRetry')}
        </p>
      </motion.div>
    </motion.div>
  );
}
