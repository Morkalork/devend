import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Zap, Coins } from 'lucide-react';

interface PushYourLuckOverlayProps {
  remainingPercent: number;
  thresholdPercent: number;
  basePoints: number;
  onBank: () => void;
  onPush: () => void;
}

export function PushYourLuckOverlay({
  remainingPercent,
  thresholdPercent,
  basePoints,
  onBank,
  onPush,
}: PushYourLuckOverlayProps) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(false);
  // Each 25% of remaining area cleared = +1 OT
  const chunkSize = remainingPercent * 0.25;

  return (
    <>
      <style>{`
        @keyframes pushLuckFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (min-width: 640px) {
          .push-luck-modal {
            top: 50% !important;
            bottom: auto !important;
            left: 50% !important;
            right: auto !important;
            width: 384px !important;
            margin-left: -192px !important;
            margin-top: -140px !important;
          }
        }
        @media (max-width: 639px) {
          .push-luck-modal {
            bottom: 6rem !important;
          }
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="absolute inset-0 z-40 bg-background/50"
        style={{ animation: 'pushLuckFadeIn 500ms ease-out' }}
      />

      {/* Modal */}
      <div
        className="push-luck-modal absolute z-50 overflow-y-auto"
        style={{
          bottom: '1rem',
          left: '1rem',
          right: '1rem',
          animation: 'pushLuckFadeIn 500ms ease-out',
        }}
      >
        
        <div className="bg-black/60 backdrop-blur-md border-2 border-success rounded-xl p-4 sm:p-6 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-success" />
            </div>
            <h2 className="text-xl font-display font-bold text-success">{t('pushYourLuck.levelCleared')}</h2>
          </div>

          {/* Info */}
          <div className="text-center mb-4">
            <p className="text-muted-foreground text-sm mb-2">
              {t('pushYourLuck.remainingLabel')} <span className="text-foreground font-semibold">{remainingPercent}%</span>
              <span className="text-muted-foreground"> {t('pushYourLuck.targetSuffix', { threshold: thresholdPercent })}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {t('pushYourLuck.keepCuttingPrefix')} <span className="text-primary font-medium">{t('pushYourLuck.bonusPerRemoved', { percent: chunkSize.toFixed(0) })}</span>.
              <br />
              <span className="text-success">{t('pushYourLuck.noRisk')}</span>
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              disabled={chosen}
              onClick={() => { setChosen(true); onBank(); }}
              className="flex-1 px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 border hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
              style={{ 
                backgroundColor: '#22c55e',
                color: '#000000',
                borderColor: '#16a34a'
              }}
            >
              <Coins className="w-4 h-4" />
              {t('pushYourLuck.bankAndContinue')}
            </button>
            <button
              disabled={chosen}
              onClick={() => { setChosen(true); onPush(); }}
              className="flex-1 px-4 py-3 rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
              style={{ 
                backgroundColor: '#f97316',
                color: '#000000',
                boxShadow: '0 0 20px rgba(249, 115, 22, 0.6)'
              }}
            >
              <Zap className="w-4 h-4" />
              {t('pushYourLuck.pushYourLuck')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
