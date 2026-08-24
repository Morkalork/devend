/**
 * One line, under the board, saying why the last thing you tried did nothing.
 *
 * Sits in the fixed bottom stack above the ability bar rather than being pinned
 * under the board's own edge. Board-aligned UI has to be `absolute` inside the
 * canvas container or the page-transition transform breaks it (the tutorial
 * overlay learned that the hard way), and this needs none of that precision:
 * "below the board, above the controls" is exactly what the stack already is.
 *
 * Never covers the play area, which matters more than it sounds. The message
 * that explains a failed cut is useless if it hides the board you were cutting.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Info } from 'lucide-react';
import { MESSAGE_MS, messageExpired, type GameMessage } from '@/lib/gameMessages';

interface Props {
  message: GameMessage | null;
  accentColor?: string;
  /** Hidden the instant a map is won: nothing here may outlive the board. */
  visible: boolean;
}

export function GameMessageBar({ message, accentColor, visible }: Props) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<GameMessage | null>(null);

  useEffect(() => {
    if (!message) { setShown(null); return; }
    setShown(message);
    // Keyed on `at`, so a repeat of the SAME message restarts the countdown
    // without restarting the animation: the bar holds steady while a player
    // retries an illegal cut instead of flickering once per attempt.
    const id = setTimeout(() => {
      setShown(current => (current && messageExpired(current, Date.now()) ? null : current));
    }, MESSAGE_MS);
    return () => clearTimeout(id);
  }, [message]);

  const text = shown ? t(`gameMessages.${shown.id}`) : '';

  return (
    <div className="px-3 pb-1.5 pointer-events-none">
      <AnimatePresence mode="wait">
        {shown && visible && (
          <motion.div
            // Keyed on `seq`, which only changes for a DIFFERENT message, so
            // swapping messages animates and repeating one does not.
            key={shown.seq}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mx-auto max-w-4xl flex items-start gap-2 rounded-lg border px-3 py-2"
            style={{
              color: accentColor,
              borderColor: `${accentColor}55`,
              backgroundColor: 'rgba(0, 0, 0, 0.82)',
            }}
            role="status"
            aria-live="polite"
          >
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="text-xs leading-snug text-foreground">{text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
