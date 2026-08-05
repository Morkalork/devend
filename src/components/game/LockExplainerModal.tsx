/**
 * LockExplainerModal — a one-time modal shown the FIRST time the player finishes
 * a map having locked ZERO balls, right before the bank / push-your-luck choice.
 * Just a picture of a locked ball + one line: locking is worth points and opens
 * the store. Dismiss with the button or a backdrop tap.
 */
import { useTranslation } from 'react-i18next';

const ACCENT = '#00ff88';

/** A ball sealed inside a fenced pocket, padlocked: "a locked ball". */
function LockedBallArt() {
  return (
    <svg width="132" height="132" viewBox="0 0 140 140" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="lb-ball" cx="50%" cy="40%" r="62%">
          <stop offset="0%" stopColor="#d6ffec" />
          <stop offset="45%" stopColor="#2bff9e" />
          <stop offset="100%" stopColor="#0a7a4c" />
        </radialGradient>
      </defs>
      {/* Sealed pocket (fences) with rounded corners */}
      <rect x="18" y="18" width="104" height="104" rx="16"
            fill="rgba(0,255,136,0.06)" stroke={ACCENT} strokeWidth="3" />
      {/* Fence-corner ticks so the pocket reads as "sealed" */}
      <g stroke={ACCENT} strokeWidth="3" strokeLinecap="round" opacity="0.85" fill="none">
        <path d="M18 42 V34 a16 16 0 0 1 16-16 H42" />
        <path d="M122 42 V34 a16 16 0 0 0-16-16 H98" />
        <path d="M18 98 V106 a16 16 0 0 0 16 16 H42" />
        <path d="M122 98 V106 a16 16 0 0 1-16 16 H98" />
      </g>
      {/* Glow + the ball */}
      <circle cx="70" cy="66" r="34" fill={ACCENT} opacity="0.16" />
      <circle cx="70" cy="66" r="27" fill="url(#lb-ball)" />
      {/* Padlock on the ball (dark so it reads on the bright body) */}
      <path d="M61 65 v-6 a9 9 0 0 1 18 0 v6" fill="none" stroke="#05130c"
            strokeWidth="4.5" strokeLinecap="round" />
      <rect x="57" y="63" width="26" height="20" rx="4" fill="#05130c" />
      {/* Keyhole, in accent so it pops on the dark lock */}
      <circle cx="70" cy="71" r="2.6" fill={ACCENT} />
      <rect x="68.6" y="71" width="2.8" height="7" rx="1.4" fill={ACCENT} />
    </svg>
  );
}

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
        className="w-full max-w-[18rem] rounded-xl overflow-hidden"
        style={{ backgroundColor: '#0b0f14', border: `1px solid ${ACCENT}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-6 pb-1">
          <LockedBallArt />
        </div>
        <p className="px-6 pt-1 pb-4 text-center text-sm leading-snug text-foreground">
          {t('game.lockExplainer.line')}
        </p>
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
