/**
 * Ascension fence durability — breaking worn-out fences.
 *
 * While ascended, every fence segment gets a hit budget (assigned in
 * applyCut). updateBall decrements it on ball impacts and queues exhausted
 * segments in game.pendingWallBreaks; the game loop calls processWallBreaksFn
 * after the physics step.
 *
 * THE VOID RULE: a fence may only break where BOTH sides of it are still
 * active space. Fences are the only physical barrier between a region and
 * captured (removed) space — breaking one against the void would let balls
 * fall out of the world. Such fences become permanent instead ("fused").
 * Consequently a break always re-merges two live areas: the segment's own
 * rasterized grid cells are restored and the regions are rebuilt from the
 * grid, so the two sides become one region again.
 */
import { CanvasGameState } from "@/types/gameState";
import { Wall } from "@/lib/wallGeometry";
import {
  isPositionActive,
  restoreCells,
  findGridRegions,
  removeRegion,
  getRemainingPercent,
  getRegionCellPositions,
  worldToGridIndex,
} from "@/lib/spaceGrid";
import { buildPolygonFromSamples } from "@/lib/regionSplit";
import { reassignBallsToRegions, paintCellRegionIds } from "@/lib/regionOwnership";
import { Region } from "@/types/game";
import { generateRegionId } from "@/lib/gameUtils";

export interface WallBreakCallbacks {
  repaintRegionCanvas: () => void;
  setRemainingPercent: (percent: number) => void;
  /** Optional feedback hook (sound/flash) fired once per processed batch. */
  onFenceBroke?: () => void;
}

/**
 * True when the wall can break without exposing captured space: probe points
 * along the segment must have ACTIVE cells on BOTH sides. Conservative — any
 * void contact anywhere along the segment makes the fence permanent.
 */
function isBreakSafe(game: CanvasGameState, wall: Wall): boolean {
  const grid = game.spaceGrid;
  if (!grid) return false;

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return false;

  // Perpendicular offset clears the fence's own removed cell row
  const offset = grid.cellSize * 1.25 + wall.thickness / 2;
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;

  const PROBES = 5;
  for (let i = 0; i < PROBES; i++) {
    // Pull endpoints slightly inward so probes don't sample past the segment
    const tt = 0.08 + (i / (PROBES - 1)) * 0.84;
    const px = wall.start.x + dx * tt;
    const py = wall.start.y + dy * tt;
    if (
      !isPositionActive(grid, { x: px + nx, y: py + ny }) ||
      !isPositionActive(grid, { x: px - nx, y: py - ny })
    ) {
      return false;
    }
  }
  return true;
}

/** Rebuild game.gridRegions + game.regions from the space grid (post-merge). */
function rebuildRegionsFromGrid(game: CanvasGameState): void {
  const grid = game.spaceGrid!;
  const gridRegions = findGridRegions(grid);

  const withBalls = [];
  for (const region of gridRegions) {
    let hasBall = false;
    for (const ball of game.balls) {
      if (ball.state === 'won') continue;
      const index = worldToGridIndex(grid, ball.position.x, ball.position.y);
      if (index >= 0 && region.cellIndices.includes(index)) { hasBall = true; break; }
    }
    if (hasBall) withBalls.push(region);
    else removeRegion(grid, region); // stray ball-less slivers (shouldn't happen)
  }
  game.gridRegions = withBalls;

  const regions: Region[] = [];
  for (const gridRegion of withBalls) {
    // Grid cell centers sit on the same 15-unit lattice as region sample points
    const samples = getRegionCellPositions(grid, gridRegion);
    const built = buildPolygonFromSamples(samples, samples.length);
    if (built) {
      regions.push({
        id: generateRegionId(),
        polygon: built.polygon,
        estimatedArea: built.estimatedArea,
        samplePoints: built.samplePoints,
      });
    }
  }
  game.regions = regions;

  reassignBallsToRegions(game.balls, game.regions, game.walls);
  paintCellRegionIds(grid, game.regions);
}

export function processWallBreaksFn(game: CanvasGameState, callbacks: WallBreakCallbacks): void {
  const pending = game.pendingWallBreaks;
  game.pendingWallBreaks = [];
  if (pending.length === 0 || !game.spaceGrid) return;

  let anyBroke = false;
  for (const wall of pending) {
    if (!game.walls.includes(wall)) continue;

    if (!isBreakSafe(game, wall)) {
      // Fused to the void — this fence is load-bearing and never breaks
      wall.hitsLeft = undefined;
      wall.maxHits = undefined;
      continue;
    }

    game.walls.splice(game.walls.indexOf(wall), 1);
    if (wall.rasterCells) restoreCells(game.spaceGrid, wall.rasterCells);
    anyBroke = true;
  }

  if (!anyBroke) return;

  rebuildRegionsFromGrid(game);
  callbacks.repaintRegionCanvas();
  callbacks.setRemainingPercent(Math.round(getRemainingPercent(game.spaceGrid)));
  callbacks.onFenceBroke?.();
}
