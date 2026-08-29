/**
 * The ability mark, drawn as SVG for the UI.
 *
 * The board draws these marks with Pixi (see ballLayer.drawMark). This draws
 * the same marks in the codex, where the player reads what they mean - and it
 * reads them out of the same BALL_MARKS table rather than redrawing them by
 * hand, because two hand-kept copies of a symbol set is exactly the sort of
 * thing that drifts silently and then teaches the player the wrong glyph.
 *
 * The viewBox is the unit ball, so the coordinates in ballMark.ts drop straight
 * in with no conversion.
 */
import { markFor, markColor, markWidth } from '@/lib/rendering/sleek/ballMark';

interface Props {
  /** The ball's ability id. A ball with none renders nothing. */
  ability: string | undefined | null;
  /** The ball's colour, which decides whether the mark is drawn light or dark. */
  color: string;
  /** Rendered diameter in px, used only to match the board's stroke weight. */
  size: number;
}

export function BallMark({ ability, color, size }: Props) {
  const strokes = markFor(ability);
  if (!strokes) return null;

  const r = size / 2;
  const ink = `#${markColor(color).toString(16).padStart(6, '0')}`;
  // markWidth is in pixels at a given ball radius; the viewBox is the unit
  // ball, so dividing by that radius puts it in the same space as the points.
  const width = markWidth(r) / r;

  return (
    <svg
      viewBox="-1 -1 2 2"
      width={size}
      height={size}
      aria-hidden
      style={{ position: 'absolute', inset: 0, opacity: 0.92 }}
    >
      {strokes.map((s, i) =>
        s.kind === 'dot' ? (
          <circle key={i} cx={s.at[0]} cy={s.at[1]} r={s.r} fill={ink} />
        ) : (
          <polyline
            key={i}
            points={(s.close ? [...s.pts, s.pts[0]] : s.pts).map(p => `${p[0]},${p[1]}`).join(' ')}
            fill="none"
            stroke={ink}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}
