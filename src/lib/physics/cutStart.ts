/**
 * cutStart — whether an existing wall should block STARTING a new fence at a
 * point.
 *
 * Fixes an intermittent "ghost wall" bug: player fences are added to `game.walls`
 * but never pruned when their region is captured, so an old cut line can end up
 * stranded inside already-captured (grey) space. The renderer never draws
 * `game.walls`, so such a wall is INVISIBLE, yet the fence-start check refused to
 * start within ~2 wall-thicknesses of ANY wall - making a legal-looking cut fail
 * for no visible reason.
 *
 * A wall should only block a start if it actually borders the ACTIVE region at
 * that point. A live boundary has the active region immediately on the start
 * side; a stranded wall has captured (REMOVED) cells between it and the start.
 * So we sample one cell off the wall toward the start point: active => real
 * boundary (block); removed => ghost stranded in dead space (ignore).
 *
 * This can only ever REDUCE false refusals: a genuine boundary (board edge,
 * obstacle edge, or a live fence) always has active space on the start side, so
 * it still blocks. Only invisible dead-space walls are newly ignored.
 */
import { Wall } from "@/lib/wallGeometry";
import { SpaceGrid, isPositionActive } from "@/lib/spaceGrid";
import { pointToSegmentDistance, closestPointOnSegment } from "@/lib/polygon";
import { Vector2 } from "@/types/game";

export function wallBlocksCutStart(worldPos: Vector2, wall: Wall, grid: SpaceGrid): boolean {
  const dist = pointToSegmentDistance(worldPos, wall.start, wall.end);
  if (dist >= wall.thickness * 2) return false; // not close enough to matter
  if (dist <= 0.001) return true;               // basically on the wall -> block

  const cp = closestPointOnSegment(worldPos, wall.start, wall.end);
  const dx = worldPos.x - cp.x, dy = worldPos.y - cp.y;
  const len = Math.hypot(dx, dy) || 1;
  const step = grid.cellSize || 15;
  const sample = { x: cp.x + (dx / len) * step, y: cp.y + (dy / len) * step };
  // Active border cell -> real boundary, block. Removed -> ghost wall, ignore.
  return isPositionActive(grid, sample);
}
