/**
 * LockExplainerModal — a one-time modal shown the FIRST time the player finishes
 * a map having locked ZERO balls, right before the bank / push-your-luck choice.
 * Just a picture of a locked ball + one line: locking is worth points and opens
 * the store. Dismiss with the button or a backdrop tap.
 */
import { useTranslation } from 'react-i18next';

const ACCENT = '#00ff88';

/**
 * The actual in-game lock: a ball sealed into a small captured pocket in the
 * corner of the board by two fences (the other two sides are board walls). Dark
 * board + dot grid, bright accent fences, a tinted captured pocket, snug ball.
 */
function LockedBallArt() {
  return (
    <svg width="152" height="134" viewBox="0 0 152 134" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="lb-ball" cx="42%" cy="38%" r="64%">
          <stop offset="0%" stopColor="#ffd7cf" />
          <stop offset="45%" stopColor="#ff5a52" />
          <stop offset="100%" stopColor="#8f1a16" />
        </radialGradient>
        <pattern id="lb-grid" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#2bff9e" opacity="0.12" />
        </pattern>
        <clipPath id="lb-board"><rect x="7" y="7" width="138" height="120" rx="12" /></clipPath>
      </defs>

      {/* The board: dark region + faint dot grid, with the captured pocket tinted */}
      <g clipPath="url(#lb-board)">
        <rect x="7" y="7" width="138" height="120" fill="#0f2117" />
        <rect x="7" y="7" width="138" height="120" fill="url(#lb-grid)" />
        <rect x="7" y="71" width="55" height="56" fill={ACCENT} opacity="0.2" />
      </g>
      <rect x="7" y="7" width="138" height="120" rx="12" fill="none" stroke="#24422f" strokeWidth="2" />

      {/* The two fences that seal the corner pocket (glow under, bright over) */}
      <path d="M7 71 H62 V127" fill="none" stroke={ACCENT} strokeWidth="7" strokeLinecap="round" opacity="0.28" />
      <path d="M7 71 H62 V127" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />

      {/* The locked ball, snug in the pocket */}
      <circle cx="34" cy="99" r="24" fill="#ff5a52" opacity="0.18" />
      <circle cx="34" cy="99" r="18" fill="url(#lb-ball)" />
      <circle cx="28" cy="93" r="5" fill="#ffffff" opacity="0.45" />
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
