/**
 * The four boards this map will actually be dealt as.
 *
 * Every map above level 3 is rotated into one of four orientations when it is
 * dealt, chosen from the run seed. The editor has always drawn orientation 0
 * and nothing else, so three quarters of what ships has never been looked at -
 * while eleven test files exist specifically because rotation breaks things.
 *
 * These are previews, not editors, and deliberately so. Letting someone drag a
 * wall in a rotated frame means writing rotated coordinates back into a map
 * authored in the unrotated one, and every bug that follows would be a
 * coordinate-space bug, which is the worst kind to chase. Look here, fix
 * upright.
 *
 * The geometry comes from rotateEntities and the same bend pipeline the game
 * uses, so a bent wall previews bent and previews rotated correctly - the
 * property bendRotation.test.ts pins.
 */
import { useEffect, useRef } from 'react';
import { BOARD_WIDTH } from '@/lib/boardConstants';
import { rotateEntities, rotateColoredArea, rotateFenceZones, ROTATION_MIN_LEVEL, type MapRotation } from '@/lib/mapRotation';
import { hasBend } from '@/lib/bend';
import { previewOutline } from '@/lib/admin/bendHandles';
import { isMirrorEntity, type LevelConfig, type LevelEntity } from '@/types/level';
import { isMoverEntity } from '@/lib/moverPath';

const ROTATIONS: MapRotation[] = [0, 1, 2, 3];
const SIZE = 104;

/** An entity's outline in world space, bent if it is bent. Mirrors MapCanvas. */
function outlineOf(e: LevelEntity): { x: number; y: number }[] {
  const base = e.shape === 'rect'
    ? [{ x: e.x, y: e.y }, { x: e.x + e.width, y: e.y },
       { x: e.x + e.width, y: e.y + e.height }, { x: e.x, y: e.y + e.height }]
    : e.shape === 'polygon'
      ? e.points.map(([x, y]) => ({ x, y }))
      : Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          return { x: e.cx + Math.cos(a) * e.radius, y: e.cy + Math.sin(a) * e.radius };
        });
  return hasBend(e)
    ? previewOutline({ points: base, bend: e.bend, bendAxis: e.bendAxis, curves: e.curves, angle: e.angle })
    : base;
}

function drawBoard(
  ctx: CanvasRenderingContext2D, level: LevelConfig, r: MapRotation, size: number,
): void {
  const s = size / BOARD_WIDTH;
  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = '#0a1c13';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#1c4030';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  // Fence ground first: it is terrain, and everything else sits on it.
  for (const z of rotateFenceZones(level.fenceZones, r) ?? []) {
    ctx.fillStyle = z.speed < 1 ? 'rgba(91, 141, 217, 0.22)' : 'rgba(224, 149, 74, 0.22)';
    ctx.fillRect(z.x * s, z.y * s, z.width * s, z.height * s);
  }

  for (const area of (level.coloredAreas ?? []).map(a => rotateColoredArea(a, r))) {
    ctx.fillStyle = 'rgba(52, 211, 153, 0.18)';
    ctx.fillRect(area.x * s, area.y * s, area.width * s, area.height * s);
  }

  for (const e of rotateEntities((level.entities ?? []) as LevelEntity[], r)) {
    const pts = outlineOf(e);
    if (pts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * s, pts[0].y * s);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * s, pts[i].y * s);
    ctx.closePath();
    ctx.fillStyle = isMoverEntity(e)
      ? 'rgba(251, 191, 36, 0.55)'
      : isMirrorEntity(e)
        ? 'rgba(136, 221, 255, 0.55)'
        : 'rgba(255, 100, 100, 0.55)';
    ctx.fill();
  }

  for (const w of level.gravityWells ?? []) {
    // Wells are a rect in the config; a dot at the centre is enough at this size.
    ctx.fillStyle = 'rgba(192, 140, 255, 0.7)';
    ctx.beginPath();
    ctx.arc((w.x + w.width / 2) * s, (w.y + w.height / 2) * s, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function Thumb({ level, rotation }: { level: LevelConfig; rotation: MapRotation }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // The side panel is zoomed up on a desktop screen (.admin-chrome-zoom), and
    // devicePixelRatio knows nothing about that: the canvas would be drawn at
    // SIZE x dpr and then displayed over a larger box, so these thumbnails - the
    // one place in the panel that is a picture rather than text - would be the
    // only thing that got blurrier as the panel got bigger.
    //
    // Measured rather than read from the CSS, because the zoom is a media query
    // and the factor lives in the stylesheet. Asking the element how big it
    // actually is cannot fall out of step with it.
    const box = c.getBoundingClientRect().width;
    const zoom = box > 0 ? box / SIZE : 1;
    const dpr = (window.devicePixelRatio || 1) * zoom;
    c.width = Math.round(SIZE * dpr);
    c.height = Math.round(SIZE * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(ctx, level, rotation, SIZE);
  }, [level, rotation]);

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={ref}
        style={{ width: SIZE, height: SIZE }}
        className="rounded border border-border"
      />
      <span className="text-[10px] text-muted-foreground">
        {rotation === 0 ? 'upright' : `${rotation * 90}°`}
      </span>
    </div>
  );
}

export function RotationStrip({ level }: { level: LevelConfig }) {
  const rotates = level.level >= ROTATION_MIN_LEVEL;

  return (
    <div className="p-3 border-t border-border space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">Orientations</h3>
      {rotates ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {ROTATIONS.map(r => <Thumb key={r} level={level} rotation={r} />)}
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            This map is dealt as one of these four, picked from the run seed. Preview only:
            edit upright and check here.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Thumb level={level} rotation={0} />
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Levels below {ROTATION_MIN_LEVEL} are always dealt upright, so this is the only
            board it can produce.
          </p>
        </>
      )}
    </div>
  );
}
