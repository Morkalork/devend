/**
 * The plunger: pull the band across the back of the barrel, release, and the
 * map begins.
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
  launchAim, muzzleVector, bandEnds, LAUNCH_SPREAD, LAUNCH_MAX_POWER, LAUNCH_MIN_POWER,
  LAUNCH_FULL_PULL,
  type LaunchAim, type LaunchFacing,
} from '@/lib/launcher';
import type { Vector2 } from '@/types/game';

interface Props {
  /** Board box in the container's CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
  /** Where the muzzle-end ball is sitting, in world units. */
  ballPosition: Vector2;
  /** The barrel's interior, in its own axis-aligned frame. */
  inner: { x: number; y: number; width: number; height: number };
  /** The barrel's turn in degrees; the muzzle is `facing` turned by this. */
  angle?: number;
  facing: LaunchFacing;
  /** Predicted path for an aim, in WORLD points. Supplied by the caller so the
   *  preview comes from the same physics the ball will obey. */
  predict: (aim: LaunchAim) => Vector2[];
  onFire: (aim: LaunchAim) => void;
}

export function LaunchOverlay({
  canvasWidth, canvasHeight, canvasOffsetTop, canvasOffsetLeft,
  ballPosition, inner, angle, facing, predict, onFire,
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
    return launchAim({ x: (px - start.x) / scale, y: (py - start.y) / scale }, facing, angle);
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
  const bearing = muzzleVector(facing, angle);
  const baseAngle = Math.atan2(bearing.y, bearing.x);

  // The band across the closed end: the thing that is actually pulled. It is
  // drawn from the barrel's real back corners rather than from the ball, so it
  // sits on the barrel at any angle and a longer barrel gets a longer draw.
  const band = bandEnds(inner, facing, angle);
  const bandA = { x: sx(band.a.x), y: sy(band.a.y) };
  const bandB = { x: sx(band.b.x), y: sy(band.b.y) };
  // How far the band's midpoint is dragged back, in screen pixels: the pull the
  // player is making, shown on the band they are making it with.
  const draw = aim
    ? ((aim.power - LAUNCH_MIN_POWER) / (LAUNCH_MAX_POWER - LAUNCH_MIN_POWER))
      * LAUNCH_FULL_PULL * scale * 0.5
    : 0;
  const bandMid = {
    x: (bandA.x + bandB.x) / 2 - bearing.x * draw,
    y: (bandA.y + bandB.y) / 2 - bearing.y * draw,
  };

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

        {/* The rubber band across the closed end, bowed back by the pull. A
            quadratic through the dragged midpoint, so it stretches the way a
            band does instead of hinging like a lever. Always drawn, at rest as
            well as under tension, because it is the control: a player has to be
            able to see what to pull before they have pulled it. */}
        {/* Drawn twice: a dark backing under a bright band, so it reads against
            the board's own greens and against the code behind it. A single thin
            stroke was reported as "there is no rubber band effect" - at a phone's
            scale the bore is about thirty pixels wide, and four pixels of line
            inside it is not a control anyone can see, let alone aim for. */}
        <path
          d={`M ${bandA.x} ${bandA.y} Q ${bandMid.x} ${bandMid.y} ${bandB.x} ${bandB.y}`}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={aim ? 13 : 10}
          strokeLinecap="round"
        />
        <path
          d={`M ${bandA.x} ${bandA.y} Q ${bandMid.x} ${bandMid.y} ${bandB.x} ${bandB.y}`}
          fill="none"
          stroke={aim?.clamped ? '#ff6b6b' : '#ffb347'}
          strokeWidth={aim ? 9 : 6}
          strokeLinecap="round"
        />
        {/* The posts the band is strung between, so it reads as attached to the
            barrel rather than floating across it. */}
        <circle cx={bandA.x} cy={bandA.y} r={4} fill="#ffb347" opacity={0.9} />
        <circle cx={bandB.x} cy={bandB.y} r={4} fill="#ffb347" opacity={0.9} />
        {/* The grip, at the middle of the band: the thing to put a thumb on. A
            halo at rest so it is findable before anything is moving. */}
        {!aim && (
          <circle cx={bandMid.x} cy={bandMid.y} r={20} fill="none"
            stroke="#ffb347" strokeWidth={2} opacity={0.45} />
        )}
        <circle
          cx={bandMid.x} cy={bandMid.y} r={aim ? 14 : 11}
          fill={aim?.clamped ? '#ff6b6b' : '#ffb347'}
          stroke="rgba(0,0,0,0.55)" strokeWidth={2}
        />

        {/* The loaded balls are NOT drawn here. The board keeps rendering
            behind this overlay while the barrel is held, so it is already
            drawing them, in their own colours; a second set of orange dots on
            top was two balls where the player has one. */}
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
