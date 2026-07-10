/**
 * DoorDraftScreen — the between-maps door choice ("Next Assignment").
 *
 * Shown after every shop (when a door pool is loaded). The top panel briefs
 * the next map with real intel: the ball types it will spawn (the selection is
 * deterministic per map id, so this is exact), par cuts, capture target and
 * obstacle count. Below it the player picks how to take the assignment on:
 * the standard door (no modifiers) or one of the rolled risk doors, whose
 * curse + blessing bundle applies to that map only. Mirrors RunDraftScreen's
 * card UI; the pick rides the session's dynamic modifier fold (activeDoor).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { DoorOpen, Play, Skull, Sparkles, Ticket } from 'lucide-react';
import { DoorConfig } from '@/types/door';
import { LevelConfig } from '@/types/level';
import { selectBallTypesForMap } from '@/lib/ballTypes';
import { CRTBackground } from './CRTBackground';
import { DraftCard } from './DraftCard';
import { contentText } from '@/i18n/content';

interface DoorDraftScreenProps {
  /** The map behind the doors (the run's next level). */
  nextLevel: LevelConfig;
  /** Rolled risk doors; the standard door is rendered by this screen itself. */
  offers: DoorConfig[];
  /** Called with the chosen risk door, or null for the standard door. */
  onSelect: (door: DoorConfig | null) => void;
  accentColor?: string;
}

/** Sentinel id for the built-in standard door card. */
const STANDARD = '__standard__';

export function DoorDraftScreen({
  nextLevel,
  offers,
  onSelect,
  accentColor = '#00ff88',
}: DoorDraftScreenProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Exact spawn preview: ball-type selection is deterministic per map id.
  const balls = useMemo(
    () => selectBallTypesForMap(nextLevel.id, nextLevel.level, nextLevel.maxBalls ?? 1),
    [nextLevel.id, nextLevel.level, nextLevel.maxBalls],
  );
  const obstacleCount = nextLevel.entities?.length ?? 0;
  const breakableCount = nextLevel.entities?.filter(e => 'breakable' in e && e.breakable).length ?? 0;
  const captureTarget = 100 - nextLevel.sizeThreshold;

  const confirm = () => {
    if (!selectedId) return;
    onSelect(selectedId === STANDARD ? null : offers.find(d => d.id === selectedId) ?? null);
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

          {/* Door cards: the standard door first, then the rolled risk doors */}
          <div
            className={`grid grid-cols-1 gap-3 w-full ${
              offers.length === 1 ? 'sm:grid-cols-2 sm:max-w-xl sm:mx-auto' : 'sm:grid-cols-3'
            }`}
          >
            <DraftCard
              key={STANDARD}
              index={0}
              accentColor={accentColor}
              selected={selectedId === STANDARD}
              onClick={() => setSelectedId(prev => (prev === STANDARD ? null : STANDARD))}
              name={t('doorDraft.standardName')}
            >
              <div className="flex items-start gap-2">
                <DoorOpen className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#c8ffd8' }} />
                <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>
                  {t('doorDraft.standardDesc')}
                </p>
              </div>
            </DraftCard>
            {offers.map((door, i) => (
              <DraftCard
                key={door.id}
                index={i + 1}
                accentColor={accentColor}
                selected={selectedId === door.id}
                onClick={() => setSelectedId(prev => (prev === door.id ? null : door.id))}
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
    </>
  );
}

