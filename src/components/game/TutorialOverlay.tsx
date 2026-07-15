import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

interface TutorialOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  body: string;
  arrowDirection?: 'up' | 'down' | 'none';
  showTapHint?: boolean;
  spotlightArea?: 'top' | 'bottom';
  spotlightHeightPx?: number;
  accentColor?: string;
}

export function TutorialOverlay({
  visible,
  onDismiss,
  title,
  body,
  arrowDirection = 'none',
  showTapHint = true,
  spotlightArea,
  spotlightHeightPx = 0,
  accentColor = '#00ff88',
}: TutorialOverlayProps) {
  const { t } = useTranslation();
  if (!visible) return null;

  const h = spotlightHeightPx;
  const hasSpotlight = !!spotlightArea && h > 0;

  const bgStyle = hasSpotlight
    ? spotlightArea === 'top'
      ? `linear-gradient(to bottom, transparent 0px, transparent ${h}px, rgba(0,0,0,0.82) ${h + 4}px)`
      : `linear-gradient(to top, transparent 0px, transparent ${h}px, rgba(0,0,0,0.82) ${h + 4}px)`
    : 'rgba(0,0,0,0.82)';

  const isArrowUp = hasSpotlight ? spotlightArea === 'top' : arrowDirection === 'up';

  const arrow = (
    <motion.div
      className="flex justify-center"
      animate={{ y: isArrowUp ? [0, -14, 0] : [0, 14, 0] }}
      transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
    >
      {isArrowUp ? (
        <svg width="60" height="220" viewBox="0 0 60 220" fill="none" style={{ filter: `drop-shadow(0 0 8px ${accentColor})` }}>
          {/* Shaft */}
          <rect x="22" y="90" width="16" height="130" fill={accentColor} />
          {/* Arrowhead */}
          <path d="M30 0L60 90H0L30 0Z" fill={accentColor} />
        </svg>
      ) : (
        <svg width="60" height="220" viewBox="0 0 60 220" fill="none" style={{ filter: `drop-shadow(0 0 8px ${accentColor})` }}>
          {/* Shaft */}
          <rect x="22" y="0" width="16" height="130" fill={accentColor} />
          {/* Arrowhead */}
          <path d="M30 220L0 130H60L30 220Z" fill={accentColor} />
        </svg>
      )}
    </motion.div>
  );

  const card = (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 16, boxShadow: '0 0 0px rgba(0,255,136,0), inset 0 0 0px rgba(0,255,136,0)' }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        boxShadow: [
          '0 0 18px rgba(0,255,136,0.14), inset 0 0 14px rgba(0,255,136,0.04)',
          '0 0 38px rgba(0,255,136,0.42), inset 0 0 20px rgba(0,255,136,0.08)',
          '0 0 18px rgba(0,255,136,0.14), inset 0 0 14px rgba(0,255,136,0.04)',
        ],
      }}
      exit={{ opacity: 0, scale: 0.92, y: 16, boxShadow: '0 0 0px rgba(0,255,136,0), inset 0 0 0px rgba(0,255,136,0)' }}
      transition={{
        opacity: { duration: 0.25 },
        scale: { duration: 0.25 },
        y: { duration: 0.25 },
        boxShadow: { duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 },
      }}
      className="relative w-full max-w-md mx-auto rounded-xl p-6 flex flex-col gap-3"
      style={{
        background: '#0a0f0a',
        border: `2px solid ${accentColor}`,
      }}
      onClick={e => e.stopPropagation()}
    >
      <h2
        className="text-lg sm:text-xl font-black tracking-widest uppercase text-center"
        style={{ fontFamily: 'Michroma, sans-serif', color: accentColor }}
      >
        {title}
      </h2>

      <p
        className="text-sm sm:text-base text-center leading-relaxed"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: '#c8ffd8' }}
      >
        {body}
      </p>

      {showTapHint && (
        <div
          className="text-center text-xs tracking-widest uppercase mt-1"
          style={{ fontFamily: 'Michroma, sans-serif', color: accentColor, opacity: 0.7 }}
        >
          {t('tutorialOverlay.tapToContinue')}
        </div>
      )}

      <div
        className="text-center text-[10px] tracking-wide uppercase mt-1"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: '#4a7a5a' }}
      >
        {t('tutorialOverlay.replayFromOptions')}
      </div>
    </motion.div>
  );

  return (
    <AnimatePresence>
      <motion.div
        key="tutorial-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[60] flex flex-col"
        style={{ background: bgStyle }}
        onClick={onDismiss}
      >
        {hasSpotlight ? (
          <>
            {/* Glowing border frame around the spotlight element */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                pointerEvents: 'none',
                height: `${h}px`,
                ...(spotlightArea === 'top' ? { top: 0 } : { bottom: 0 }),
                border: `2px solid ${accentColor}cc`,
                boxShadow: `0 0 32px 10px ${accentColor}55, inset 0 0 24px 6px ${accentColor}22`,
              }}
            />

            {/* Glowing separator at the spotlight boundary */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: '3px',
                background: accentColor,
                boxShadow: `0 0 20px 6px ${accentColor}`,
                ...(spotlightArea === 'top' ? { top: `${h}px` } : { bottom: `${h}px` }),
              }}
            />

            {spotlightArea === 'top' ? (
              <>
                {/* Transparent zone spacer — reveals the top bar beneath */}
                <div style={{ height: `${h}px`, flexShrink: 0 }} />
                {/* Dark section: arrow near separator, card near bottom */}
                <div className="flex-1 flex flex-col justify-between py-8 px-6">
                  {arrow}
                  {card}
                </div>
              </>
            ) : (
              <>
                {/* Dark section: card near top, arrow near separator */}
                <div className="flex-1 flex flex-col justify-between py-8 px-6">
                  {card}
                  {arrow}
                </div>
                {/* Transparent zone spacer — reveals the stats panel beneath */}
                <div style={{ height: `${h}px`, flexShrink: 0 }} />
              </>
            )}
          </>
        ) : (
          /* Non-spotlight: centered card, no arrows */
          <div className="flex-1 flex flex-col justify-center items-center px-6">
            {card}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
