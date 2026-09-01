/**
 * The Rubber Band's drag: stretch it, see what it will catch, let go.
 *
 * Board-aligned UI, so it is `absolute` inside GameCanvas's container and takes
 * the board box in CSS pixels. It must never be `fixed`: the page-transition
 * transform breaks viewport coordinates, which is the bug both the launcher
 * overlay and the interactive tutorial were already carrying when they were
 * moved in here.
 *
 * Mounted only while the ability is ARMED, which is what makes a one-finger
 * drag unambiguous - the game already knows this gesture is an aim and not a
 * cut, so there is nothing to disambiguate with a second finger.
 *
 * ── Why the catch is shown DURING the drag ──────────────────────────────────
 *
 * The whole ability is a decision about which balls to throw and what to break,
 * and a charge cannot be taken back. Showing the caught balls only on release
 * would make every use a bet on geometry the player cannot see. They are ringed
 * live instead, and the ring updates as the band moves, so letting go is a
 * confirmation rather than a guess.
 */
import { useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Spline } from 'lucide-react';
import { BOARD_WIDTH, BOARD_HEIGHT } from '@/lib/boardConstants';
import {
  bandShape, inBandSweep, BAND_MAX_POWER, BAND_MIN_POWER, type BandShape,
} from '@/lib/rubberBand';
import { InteractiveTutorialOverlay } from './InteractiveTutorialOverlay';
import type { Vector2 } from '@/types/game';

/** One-time flag, same shape as the lock and creep explainers. */
const TUTORIAL_KEY = 'devend_rubberband_tutorial_seen';

function tutorialSeen(): boolean {
  try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return true; }
}

export interface BandTarget {
  x: number;
  y: number;
  radius: number;
  /** Balls are ringed; destructibles are boxed, so the two reads differ. */
  kind: 'ball' | 'object';
}

interface Props {
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
  /** Everything the band could catch, in world units. Supplied by the caller so
   *  the highlight comes from the same board the effect will read. */
  targets: BandTarget[];
  onFire: (shape: BandShape) => void;
  onCancel: () => void;
}

export function RubberBandOverlay({
  canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft, targets, onFire, onCancel,
}: Props) {
  const { t } = useTranslation();
  const [shape, setShape] = useState<BandShape | null>(null);
  const [dragging, setDragging] = useState(false);
  // Read once, on mount: the flag is written on the first band that actually
  // fires, so re-reading it mid-drag would pull the hand away a frame early.
  const [showTutorial, setShowTutorial] = useState(() => !tutorialSeen());
  const startRef = useRef<Vector2 | null>(null);

  const scale = canvasWidth > 0 ? canvasWidth / BOARD_WIDTH : 1;
  const sx = useCallback((wx: number) => canvasOffsetLeft + (wx / BOARD_WIDTH) * canvasWidth,
    [canvasOffsetLeft, canvasWidth]);
  const sy = useCallback((wy: number) => canvasOffsetTop + (wy / BOARD_HEIGHT) * canvasHeight,
    [canvasOffsetTop, canvasHeight]);

  /** Pointer position in WORLD units, so the dead zone and full pull mean the
   *  same thing on a phone and on a desktop. */
  const world = (e: React.PointerEvent): Vector2 => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) - canvasOffsetLeft) / scale,
      y: ((e.clientY - rect.top) - canvasOffsetTop) / scale,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    startRef.current = world(e);
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (startRef.current) setShape(bandShape(startRef.current, world(e)));
  };
  const onUp = (e: React.PointerEvent) => {
    const start = startRef.current;
    const final = start ? bandShape(start, world(e)) : null;
    startRef.current = null;
    setShape(null);
    setDragging(false);
    // A tap is not a band. The charge cannot be taken back, so a stray touch
    // while reading the board must disarm rather than spend it.
    if (final) {
      // Retire the hand only once a band has really been thrown. A cancelled
      // tap means the gesture did NOT land, which is exactly when the hint is
      // still worth showing.
      if (showTutorial) {
        setShowTutorial(false);
        try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* private mode */ }
      }
      onFire(final);
    } else {
      onCancel();
    }
  };

  const caught = shape ? targets.filter(tg => inBandSweep({ x: tg.x, y: tg.y }, shape)) : [];
  const powerT = shape?.powerT ?? 0;
  // Teal at rest through to a hot amber at full stretch: the colour IS the
  // power reading, so the player is not asked to watch a bar while aiming.
  const colour = powerT >= 1 ? '#ffb347' : '#7fe3d4';

  return (
    <div
      className="absolute inset-0 touch-none"
      style={{ zIndex: 6 }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
        {shape && (
          <>
            {/* The stretch, from where the band started to where it is now. */}
            <line
              x1={sx(shape.centre.x - shape.heading.x * 0)} y1={sy(shape.centre.y - shape.heading.y * 0)}
              x2={sx(shape.centre.x + shape.heading.x * 46)} y2={sy(shape.centre.y + shape.heading.y * 46)}
              stroke={colour} strokeWidth={2} strokeDasharray="5 6" opacity={0.7}
            />
            {/* The band itself: dark backing under a bright cord, so it reads
                against the board's greens and against the code behind it. */}
            <line
              x1={sx(shape.a.x)} y1={sy(shape.a.y)} x2={sx(shape.b.x)} y2={sy(shape.b.y)}
              stroke="rgba(0,0,0,0.55)" strokeWidth={(9 + powerT * 5) * scale} strokeLinecap="round"
            />
            <line
              x1={sx(shape.a.x)} y1={sy(shape.a.y)} x2={sx(shape.b.x)} y2={sy(shape.b.y)}
              stroke={colour} strokeWidth={(5 + powerT * 4) * scale} strokeLinecap="round"
            />
            {/* Its posts, so it reads as strung between two points. */}
            {[shape.a, shape.b].map((p, i) => (
              <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={Math.max(3, 5 * scale)} fill={colour} />
            ))}
            {/* Everything it would catch, ringed LIVE. The charge cannot be
                taken back, so letting go has to be a confirmation. */}
            {caught.map((tg, i) => (
              <circle
                key={i}
                data-band-catch={tg.kind}
                cx={sx(tg.x)} cy={sy(tg.y)} r={Math.max(8, (tg.radius + 8) * scale)}
                fill="none" stroke={colour}
                strokeWidth={Math.max(2, 2.5 * scale)}
                strokeDasharray={tg.kind === 'object' ? '4 4' : undefined}
              />
            ))}
          </>
        )}
      </svg>

      <div
        className="absolute left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1"
        style={{ top: canvasOffsetTop + 8 }}
      >
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          <Spline className="w-3.5 h-3.5" style={{ color: colour }} />
          {t('rubberBand.pullToFire')}
        </div>
        {shape && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${powerT * 100}%`, background: colour }} />
            </div>
            <span className="text-sm font-bold tabular-nums" style={{ color: colour }}>
              {t('rubberBand.power', {
                power: (BAND_MIN_POWER + powerT * (BAND_MAX_POWER - BAND_MIN_POWER)).toFixed(1),
                // `n`, not `count`: `count` would send i18next looking for
                // plural variants of the key that these locales do not define.
                n: caught.length,
              })}
            </span>
          </div>
        )}
      </div>

      {/* The map-1 hand, reused. It is pointer-events-none, so it demonstrates
          the drag over the very surface that is listening for it. */}
      {showTutorial && (
        <>
          <InteractiveTutorialOverlay
            tutorialStep="showingHint"
            isPlayerDragging={dragging}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            canvasOffsetTop={canvasOffsetTop}
            canvasOffsetLeft={canvasOffsetLeft}
          />
          {!dragging && (
            <div
              className="absolute left-1/2 -translate-x-1/2 pointer-events-none px-3 py-1.5 rounded-lg bg-background/85 border border-border text-xs text-center max-w-[18rem]"
              style={{ top: canvasOffsetTop + canvasHeight - 48, zIndex: 51 }}
            >
              {t('rubberBand.tutorial')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
