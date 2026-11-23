/**
 * The bot looks before it fences, where bricks are owed.
 *
 * The game no longer turns away a fence that walls off bricks the win still
 * needs (BRICKS_PLAN.md): the fence lands, and the map is lost if the win can
 * no longer be met. A player sees the bricks and does not draw that fence. The
 * bot's policy knows nothing of bricks, so without this it drew it most of the
 * time and every brick map read as lost to a mistake no player makes.
 *
 * So the bot asks the question a player answers by looking: would the board
 * after this fence still let the win be met? Simulated on a copy of the grid
 * with the game's own capture pass and the game's own reach check, so it
 * cannot disagree with what the game then does.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Vector2 } from "@/types/game";
import type { WinSpec } from "@/types/winSpec";
import type { Wall } from "@/lib/wallGeometry";
import { castRayWithReflections, cuttableWalls } from "@/lib/wallGeometry";
import { rasterizeCutToGrid, captureUnreachableCells, type SpaceGrid } from "@/lib/spaceGrid";
import { smashDemands, smashRequirementLost } from "@/lib/physics/smashReach";
import { vec2Normalize } from "@/lib/polygon";

/** The fence a cut from `origin` along `direction` would become, as segments. */
function fenceSegments(game: CanvasGameState, origin: Vector2, direction: Vector2): { start: Vector2; end: Vector2 }[] {
  const dir = vec2Normalize(direction);
  const out: { start: Vector2; end: Vector2 }[] = [];
  for (const heading of [dir, { x: -dir.x, y: -dir.y }]) {
    const ray = castRayWithReflections(origin, heading, cuttableWalls(game.walls));
    if (!ray) {
      return [];
    }
    for (let i = 1; i < ray.waypoints.length; i++) {
      out.push({ start: ray.waypoints[i - 1], end: ray.waypoints[i] });
    }
  }
  return out;
}

/** Would this fence put the bricks the win still needs beyond every ball? */
export function fenceWouldLoseTheBricks(
  game: CanvasGameState, spec: WinSpec, origin: Vector2, direction: Vector2, thickness: number,
): boolean {
  const grid = game.spaceGrid;
  if (!grid || smashDemands(spec).length === 0) {
    return false;
  }
  // Already lost: not this fence's doing.
  if (smashRequirementLost(game, spec)) {
    return false;
  }
  const segments = fenceSegments(game, origin, direction);
  if (segments.length === 0) {
    return false;
  }
  const after: SpaceGrid = {
    ...grid,
    cells: Uint8Array.from(grid.cells),
    cellRegionIds: [...grid.cellRegionIds],
  };
  for (const seg of segments) {
    rasterizeCutToGrid(after, seg.start, seg.end, thickness);
  }
  const fences = segments.map((s, i) => ({ id: `lookahead-${i}`, start: s.start, end: s.end }) as unknown as Wall);
  const walls = [...game.walls, ...fences];
  captureUnreachableCells(after, game.balls, walls);
  return smashRequirementLost({ ...game, spaceGrid: after, walls } as CanvasGameState, spec);
}
