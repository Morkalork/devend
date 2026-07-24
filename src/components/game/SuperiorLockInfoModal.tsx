/**
 * SuperiorLockInfoModal — the explainer opened by pressing-and-holding a
 * superior-lock's gold star on the board. Spells out the difference between a
 * standard lock and a superior lock. Dismiss on backdrop tap or the X.
 */
import { X, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const GOLD = '#ffd54a';

interface SuperiorLockInfoModalProps {
  onClose: () => void;
}

export function SuperiorLockInfoModal({ onClose }: SuperiorLockInfoModalProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl overflow-hidden"
        style={{ backgroundColor: '#0b0f14', border: `1px solid ${GOLD}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${GOLD}44` }}
        >
          <span
            className="font-display text-sm font-bold flex items-center gap-2"
            style={{ color: GOLD, textShadow: `0 0 10px ${GOLD}66` }}
          >
            <Star className="w-4 h-4" style={{ fill: GOLD, color: GOLD }} />
            {t('game.lockInfo.title')}
          </span>
          <button onClick={onClose} className="p-1 rounded" style={{ color: GOLD }} title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-4 text-sm">
          <div>
            <div className="text-[10px] font-bold tracking-wider mb-1 text-muted-foreground">
              {t('game.lockInfo.normalTitle')}
            </div>
            <p className="text-foreground leading-snug">{t('game.lockInfo.normalBody')}</p>
          </div>
          <div>
            <div
              className="text-[10px] font-bold tracking-wider mb-1 flex items-center gap-1"
              style={{ color: GOLD }}
            >
              <Star className="w-3 h-3" style={{ fill: GOLD, color: GOLD }} />
              {t('game.lockInfo.superiorTitle')}
            </div>
            <p className="text-foreground leading-snug">{t('game.lockInfo.superiorBody')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
