/**
 * The plunger: drag back anywhere on the board, release, and the map begins.
 *
 * Board-aligned UI, so it is `absolute` inside GameCanvas's container and takes
 * the board box in CSS pixels. It must never be `fixed`: the page-transition
 * transform breaks viewport coordinates, which is the bug the interactive
 * tutorial overlay was already carrying when it was moved in here.
 *
 * The drag is read as a slingshot - the ball leaves OPPOSITE the pull - because
 * that is the gesture every catapult in every game has taught, and because
 * pulling toward yourself keeps the finger off the part of the board you are
 * aiming at. The cone, the power and the clamp all come from lib/launcher.ts;
 * nothing here decides anything about the shot.
 */
import { useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { BOARD_WIDTH, BOARD_HEIGHT } from '@/lib/boardConstants';
import {
  launchAim, bearingVector, LAUNCH_SPREAD, LAUNCH_MAX_POWER, LAUNCH_MIN_POWER,
  type LaunchAim, type LaunchFacing,
} from '@/lib/launcher';
import type { Vector2 } from '@/types/game';

interface Props {
  /** Board box in the container's CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
  /** Where the loaded ball is sitting, in world units. */
  ballPosition: Vector2;
  facing: LaunchFacing;
  /** Predicted path for an aim, in WORLD points. Supplied by the caller so the
   *  preview comes from the same physics the ball will obey. */
  predict: (aim: LaunchAim) => Vector2[];
  onFire: (aim: LaunchAim) => void;
}

export function LaunchOverlay({
  canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft,
  ballPosition, facing, predict, onFire,
}: Props) {
  const { t } = useTranslation();
  const [aim, setAim] = useState<LaunchAim | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const scale = canvasWidth > 0 ? canvasWidth / BOARD_WIDTH : 1;
  const sx = useCallback((wx: number) => canvasOffsetLeft + (wx / BOARD_WIDTH) * canvasWidth,
    [canvasOffsetLeft, canvasWidth]);
  const sy = useCallback((wy: number) => canvasOffsetTop + (wy / BOARD_HEIGHT) * canvasHeight,
    [canvasOffsetTop, canvasHeight]);

  const readAim = (e: React.PointerEvent): LaunchAim | null => {
    const start = startRef.current;
    if (!start) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // The pull is measured in WORLD units so the dead zone and the full-pull
    // length mean the same thing on a phone and on a desktop.
    return launchAim({ x: (px - start.x) / scale, y: (py - start.y) / scale }, facing);
  };

  const onDown = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    startRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (startRef.current) setAim(readAim(e));
  };
  const onUp = (e: React.PointerEvent) => {
    const finalAim = readAim(e);
    startRef.current = null;
    setAim(null);
    // A pull too short to register is not a weak launch, it is no launch: the
    // shot cannot be taken back, so a stray tap must not spend it.
    if (finalAim) onFire(finalAim);
  };

  const bx = sx(ballPosition.x);
  const by = sy(ballPosition.y);
  const bearing = bearingVector(facing);
  const baseAngle = Math.atan2(bearing.y, bearing.x);

  // Cone edges, drawn so the limit on the aim is visible rather than felt as
  // the shot refusing to go where the finger asked.
  const coneLen = Math.max(60, canvasWidth * 0.32);
  const coneEdge = (sign: number) => ({
    x: bx + Math.cos(baseAngle + sign * LAUNCH_SPREAD) * coneLen,
    y: by + Math.sin(baseAngle + sign * LAUNCH_SPREAD) * coneLen,
  });
  const edgeA = coneEdge(-1);
  const edgeB = coneEdge(1);

  const path = aim ? predict(aim) : [];
  const powerT = aim
    ? (aim.power - LAUNCH_MIN_POWER) / (LAUNCH_MAX_POWER - LAUNCH_MIN_POWER)
    : 0;

  return (
    <div
      className="absolute inset-0 touch-none"
      style={{ zIndex: 6 }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ overflow: 'visible' }}
      >
        {/* The cone the cup will accept. */}
        <path
          d={`M ${edgeA.x} ${edgeA.y} L ${bx} ${by} L ${edgeB.x} ${edgeB.y}`}
          fill="none"
          stroke="rgba(255,179,71,0.35)"
          strokeWidth={2}
          strokeDasharray="6 8"
        />

        {/* Predicted path, from the same physics the ball will obey. */}
        {path.length > 1 && (
          <polyline
            points={path.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')}
            fill="none"
            stroke="rgba(255,179,71,0.9)"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        )}

        {/* The stretched band, from the ball back along the pull. */}
        {aim && (
          <line
            x1={bx} y1={by}
            x2={bx - aim.direction.x * 46 * (0.4 + powerT)}
            y2={by - aim.direction.y * 46 * (0.4 + powerT)}
            stroke={aim.clamped ? '#ff6b6b' : '#ffb347'}
            strokeWidth={5}
            strokeLinecap="round"
          />
        )}

        <circle cx={bx} cy={by} r={7} fill="#ffb347" />
      </svg>

      {/* Read-out. Says what the pull BUYS, not just how hard it is: the whole
          reason to pull harder is the base multiplier, so the number the player
          is bidding for has to be on screen while they are bidding. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1"
        style={{ top: canvasOffsetTop + 8 }}
      >
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          <Zap className="w-3.5 h-3.5" style={{ color: '#ffb347' }} />
          {t('launcher.pullToLaunch')}
        </div>
        {aim && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${powerT * 100}%`, background: '#ffb347' }}
              />
            </div>
            <span className="text-sm font-bold tabular-nums" style={{ color: '#ffb347' }}>
              {t('launcher.basePay', { multiplier: aim.power.toFixed(1) })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
