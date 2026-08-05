/**
 * LockExplainerModal — a one-time teaching modal shown the FIRST time the player
 * finishes a map having locked ZERO balls, right before the "bank / push your
 * luck" choice. Shrinking the board wins the map, but locking balls is where the
 * payoff is, so a player who never locks is leaving money on the table; this
 * spells out how locks work. Dismiss with the button or a backdrop tap.
 */
import { Lock, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ACCENT = '#00ff88';
const GOLD = '#ffd54a';

interface LockExplainerModalProps {
  onClose: () => void;
}

export function LockExplainerModal({ onClose }: LockExplainerModalProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl overflow-hidden"
        style={{ backgroundColor: '#0b0f14', border: `1px solid ${ACCENT}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: `1px solid ${ACCENT}44` }}
        >
          <Lock className="w-4 h-4" style={{ color: ACCENT }} />
          <span
            className="font-display text-sm font-bold"
            style={{ color: ACCENT, textShadow: `0 0 10px ${ACCENT}66` }}
          >
            {t('game.lockExplainer.title')}
          </span>
        </div>
        <div className="px-4 py-4 space-y-2.5 text-sm">
          <p className="text-foreground leading-snug">{t('game.lockExplainer.lead')}</p>
          <p className="text-foreground leading-snug">{t('game.lockExplainer.standard')}</p>
          <p className="leading-snug flex items-start gap-1" style={{ color: GOLD }}>
            <Star className="w-3 h-3 mt-0.5 shrink-0" style={{ fill: GOLD, color: GOLD }} />
            <span>{t('game.lockExplainer.superior')}</span>
          </p>
        </div>
        <div className="px-4 pb-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg py-2.5 font-display text-sm font-bold"
            style={{ backgroundColor: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: ACCENT }}
          >
            {t('game.lockExplainer.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
