/**
 * The head-start strip: a starting capture, shown as ground already taken.
 *
 * Onboarding and the Equity Grant certificate start a map with part of the
 * board captured. initGame does that by shrinking the play area evenly inside
 * the arena and counting the trimmed margin as captured. The renderer used to
 * frame the SHRUNK board, so the trimmed strip fell outside the frame and the
 * board just looked a little smaller: the upgrade promised "8% already
 * captured" and nothing on screen was. Reported from play as "what 8% has
 * been removed?".
 *
 * So the frame stays on the full arena, the strip inside it is drawn as
 * captured ground, and the trimmed edge is drawn as a fence: the shape a
 * capture always has on this board, which is ground on the far side of a
 * fence you did not have to draw.
 *
 * Drawing only. Physics keeps the shrunk `boardPolygon`; nothing here moves a
 * wall or a ball.
 */
import type { Polygon, Vector2 } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";

type Outlines = Pick<CanvasGameState, "boardPolygon" | "arenaPolygon">;

/** True when the board was trimmed inside a larger arena. */
export function hasHeadStartStrip(game: Outlines): boolean {
  return !!game.arenaPolygon && game.arenaPolygon.vertices.length >= 3
    && !!game.boardPolygon && game.boardPolygon.vertices.length >= 3;
}

/**
 * The outline the board is framed and clipped to: the untrimmed arena when
 * there is a strip, so the strip is inside the board and not outside it.
 */
export function visibleOutline(game: Outlines): Polygon | null {
  return hasHeadStartStrip(game) ? game.arenaPolygon! : game.boardPolygon;
}

/**
 * A polygon's edges, each pushed OUTWARD along its own normal by `push` and
 * extended by `push` at both ends, so a wall of thickness 2 x push drawn on
 * them has its inner face on the polygon and mitres into its neighbours.
 *
 * Per edge rather than radially from the centroid: a radial push is a
 * scale-out, which on a rectangle moves corners further than edge midpoints.
 */
export function outwardEdges(poly: Polygon, push: number): { start: Vector2; end: Vector2 }[] {
  const vs = poly.vertices;
  const n = vs.length;
  if (n < 3) return [];
  const cx = vs.reduce((s, v) => s + v.x, 0) / n;
  const cy = vs.reduce((s, v) => s + v.y, 0) / n;
  const out: { start: Vector2; end: Vector2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1) continue;
    let nx = -ey / len, ny = ex / len;
    // Away from the middle of the board.
    const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    const tx = (ex / len) * push, ty = (ey / len) * push;
    out.push({
      start: { x: a.x + nx * push - tx, y: a.y + ny * push - ty },
      end: { x: b.x + nx * push + tx, y: b.y + ny * push + ty },
    });
  }
  return out;
}

/**
 * Where the fence along the trimmed edge is drawn: on the strip's side of the
 * play boundary, so its inner face is exactly where a ball bounces and it
 * covers none of the live ground. Empty when there is no strip.
 */
export function headStartFenceSegments(game: Outlines, thickness: number): { start: Vector2; end: Vector2 }[] {
  if (!hasHeadStartStrip(game)) return [];
  return outwardEdges(game.boardPolygon!, thickness / 2);
}
