/**
 * DoorDraftScreen — the every-5th-level assignment draft ("Next Assignment").
 *
 * Replaces the shop on assignment levels. The top panel briefs the next map
 * with real intel: the ball types it will spawn (the selection is
 * deterministic per map id, so this is exact), par cuts, capture target and
 * obstacle count. Below it the player MUST pick one of the rolled doors; the
 * chosen curse + blessing contract runs for the whole 5-level block until the
 * next assignment replaces it. Mirrors RunDraftScreen's card UI; the pick
 * rides the session's dynamic modifier fold (activeDoor).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Skull, Sparkles, Ticket, X } from 'lucide-react';
import { DoorConfig } from '@/types/door';
import { LevelConfig } from '@/types/level';
import { selectBallTypesForMap } from '@/lib/ballTypes';
import { CRTBackground } from './CRTBackground';
import { DraftCard } from './DraftCard';
import { contentText } from '@/i18n/content';

interface DoorDraftScreenProps {
  /** The map behind the doors (the run's next level). */
  nextLevel: LevelConfig;
  /** Rolled doors; picking one is mandatory. */
  offers: DoorConfig[];
  /** Called with the chosen door. */
  onSelect: (door: DoorConfig) => void;
  accentColor?: string;
}

export function DoorDraftScreen({
  nextLevel,
  offers,
  onSelect,
  accentColor = '#00ff88',
}: DoorDraftScreenProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Door whose press-and-hold detail overlay is open.
  const [detailId, setDetailId] = useState<string | null>(null);

  // Exact spawn preview: ball-type selection is deterministic per map id.
  const balls = useMemo(
    () => selectBallTypesForMap(nextLevel.id, nextLevel.level, nextLevel.maxBalls ?? 1),
    [nextLevel.id, nextLevel.level, nextLevel.maxBalls],
  );
  const obstacleCount = nextLevel.entities?.length ?? 0;
  const breakableCount = nextLevel.entities?.filter(e => 'breakable' in e && e.breakable).length ?? 0;
  const captureTarget = 100 - nextLevel.sizeThreshold;

  const confirm = () => {
    const door = offers.find(d => d.id === selectedId);
    if (door) onSelect(door);
  };

  const intel: Array<{ label: string; value: string }> = [
    { label: t('doorDraft.intelPar'), value: String(nextLevel.expectedCuts) },
    { label: t('doorDraft.intelCapture'), value: `${captureTarget}%` },
    {
      label: t('doorDraft.intelObstacles'),
      value: breakableCount > 0
        ? t('doorDraft.obstaclesWithBreakables', { count: obstacleCount, breakables: breakableCount })
        : String(obstacleCount),
    },
  ];

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center bg-background/90 p-4 sm:p-6 relative z-10 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 flex flex-col items-center gap-5 w-full max-w-3xl py-6"
        >
          {/* Header */}
          <div className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center"
              style={{
                border: `2px solid ${accentColor}`,
                backgroundColor: `${accentColor}22`,
                boxShadow: `0 0 40px ${accentColor}55`,
              }}
            >
              <Ticket className="w-9 h-9" style={{ color: accentColor }} />
            </motion.div>
            <h1
              className="text-3xl sm:text-4xl font-display font-black tracking-wider uppercase"
              style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}88` }}
            >
              {t('doorDraft.title')}
            </h1>
            <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {t('doorDraft.subtitle', { level: nextLevel.level })}
            </p>
          </div>

          {/* Next-map intel briefing */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="w-full rounded-lg p-3 flex flex-col sm:flex-row items-center justify-center gap-x-6 gap-y-2"
            style={{ border: `1px solid ${accentColor}44`, backgroundColor: 'rgba(255,255,255,0.03)' }}
          >
            {/* Ball spawn preview: deterministic, so this is what WILL spawn */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider" style={{ color: '#4a7a5a' }}>
                {t('doorDraft.intelBalls')}
              </span>
              <div className="flex items-center gap-1.5">
                {balls.map(b => (
                  <span key={b.id} className="flex items-center gap-1">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: b.color, boxShadow: `0 0 6px ${b.color}` }}
                    />
                    <span className="text-xs" style={{ color: '#c8ffd8' }}>{b.name}</span>
                  </span>
                ))}
              </div>
            </div>
            {intel.map(row => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: '#4a7a5a' }}>
                  {row.label}
                </span>
                <span className="text-xs font-bold" style={{ color: '#c8ffd8' }}>{row.value}</span>
              </div>
            ))}
          </motion.div>

          {/* Door cards: the rolled contracts, pick is mandatory */}
          <div
            className={`grid grid-cols-1 gap-3 w-full ${
              offers.length === 2 ? 'sm:grid-cols-2 sm:max-w-xl sm:mx-auto' : 'sm:grid-cols-3'
            }`}
          >
            {offers.map((door, i) => (
              <DraftCard
                key={door.id}
                index={i}
                accentColor={accentColor}
                selected={selectedId === door.id}
                onClick={() => setSelectedId(prev => (prev === door.id ? null : door.id))}
                onLongPress={() => setDetailId(door.id)}
                name={contentText.doorName(t, door)}
              >
                <div className="flex items-start gap-2 mb-2">
                  <Skull className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#ff6b6b' }} />
                  <p className="text-xs leading-relaxed" style={{ color: '#ff6b6b' }}>
                    {contentText.doorRisk(t, door)}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>
                    {contentText.doorReward(t, door)}
                  </p>
                </div>
              </DraftCard>
            ))}
          </div>

          {/* Press-and-hold discovery hint */}
          <p className="text-[11px] text-center" style={{ color: '#4a7a5a' }}>
            {t('doorDraft.holdHint')}
          </p>

          {/* Confirm */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!selectedId}
            onClick={confirm}
            whileHover={selectedId ? { scale: 1.02 } : undefined}
            whileTap={selectedId ? { scale: 0.98 } : undefined}
          >
            <Play className="w-5 h-5" />
            {selectedId ? t('doorDraft.enterButton') : t('doorDraft.pickHint')}
          </motion.button>
        </motion.div>
      </div>

      {/* Press-and-hold detail overlay: the fuller briefing for one door.
          Tapping the backdrop or the X closes it. */}
      <AnimatePresence>
        {detailId && (() => {
          const door = offers.find(d => d.id === detailId);
          if (!door) return null;
          const title = contentText.doorName(t, door);
          const clarify = contentText.doorClarify(t, door);

          return (
            <motion.div
              key="door-detail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailId(null)}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            >
              <motion.div
                initial={{ scale: 0.92, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.92, y: 8, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm rounded-xl border-2 bg-card p-5 shadow-xl"
                style={{ borderColor: `${accentColor}66` }}
              >
                <button
                  onClick={() => setDetailId(null)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  aria-label={t('doorDraft.closeDetail')}
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Header */}
                <div className="flex items-center gap-2 mb-3 pr-6">
                  <Ticket className="w-6 h-6 shrink-0" style={{ color: accentColor }} />
                  <div className="text-base font-display font-bold" style={{ color: accentColor }}>{title}</div>
                </div>

                {/* Risk / reward recap */}
                <div className="space-y-2 mb-3">
                  <div className="flex items-start gap-2">
                    <Skull className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#ff6b6b' }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#ff6b6b' }}>{contentText.doorRisk(t, door)}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>{contentText.doorReward(t, door)}</p>
                  </div>
                </div>

                {/* Clarification */}
                {clarify && (
                  <p className="text-sm leading-relaxed mb-3" style={{ color: '#c8ffd8', opacity: 0.9 }}>{clarify}</p>
                )}

                {/* Scope note */}
                <p
                  className="text-[11px] leading-relaxed pt-2.5"
                  style={{ color: '#4a7a5a', borderTop: `1px solid ${accentColor}22` }}
                >
                  {t('doorDraft.scopeNote')}
                </p>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </>
  );
}

