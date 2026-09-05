/**
 * The objects a map's win actually depends on, so the board can point at them.
 *
 * The startup pulse already announced every floor marking, on the sound
 * argument that a marking painted ON the floor is designed not to compete with
 * the objects standing on it and is therefore the first thing an eye skips.
 * That covers colored areas and delivery boxes and nothing else, which was
 * fine while a win was "clear the board" - and became actively misleading the
 * moment a map could ask you to break something.
 *
 * Level 5 is the case that showed it: the win requires the slab smashed, the
 * slab got no announcement at all, and the one thing that DID pulse was a
 * bonus zone the win does not care about. A player reading the board was being
 * pointed at the optional thing and away from the required one.
 *
 * ── Read from the spec, never from the map's shape ─────────────────────────
 *
 * Derived from resolveWinSpec, the same reading the gate itself uses, so a
 * highlight cannot point at something the win does not want. The temptation is
 * to highlight "every breakable" or "every zone" because that is easy from the
 * level data; it is also how the board comes to promise something the win
 * check disagrees with. A bonus area (`required: false`) is deliberately not
 * here for exactly that reason - it keeps its own marking pulse, which says
 * "worth your time", not "you must".
 */
import type { CanvasGameState } from "@/types/gameState";
import type { WinSpec } from "@/types/winSpec";
import { gateAreas } from "@/lib/coloredAreas";

/** A board-space rectangle to draw an announcement around. */
export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The axis-aligned bounds of a polygon.
 *
 * Breakables are rects in the level file and POLYGONS at runtime, because the
 * map rotation turns everything on the board. Reading the authored x/y/width/
 * height would draw the ring where the slab was authored rather than where it
 * is, which is the authored-vs-runtime mistake this codebase keeps finding.
 */
function polygonBounds(vertices: ReadonlyArray<{ x: number; y: number }>): HighlightRect | null {
  if (vertices.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Everything the win requires, as rectangles to announce.
 *
 * Only `require` is read. An alternative is a door the player may choose not
 * to take, and pointing at it as though it were the job would make every
 * optional route look mandatory - the same reason the HUD's gate chips ignore
 * alsoWinIf.
 */
export function winHighlightRects(
  spec: WinSpec,
  game: Pick<CanvasGameState, "destructibles" | "coloredAreas" | "deliveryBoxes">,
): HighlightRect[] {
  const out: HighlightRect[] = [];

  for (const c of spec.require) {
    if (c.kind === "smashed") {
      // Breakables only, matching the clause: mirrors and movers are
      // destructible too and are scenery, not a job.
      for (const d of game.destructibles ?? []) {
        if (d.kind !== "breakable" || d.destroyed) continue;
        const poly = d.obstaclePolygon;
        const rect = poly ? polygonBounds(poly.vertices) : null;
        if (rect) out.push(rect);
      }
    } else if (c.kind === "area") {
      for (const a of gateAreas(game.coloredAreas ?? [])) {
        out.push({ x: a.x, y: a.y, width: a.width, height: a.height });
      }
    } else if (c.kind === "delivered") {
      for (const b of game.deliveryBoxes ?? []) out.push({ ...b.inner });
    }
  }

  return out;
}
