/**
 * SpaceGrid - Authoritative 2D Grid Model for Game Space
 * ========================================================
 * 
 * CORE PRINCIPLE: Space is explicit and authoritative.
 * The grid is the single source of truth for what space is playable.
 * 
 * Every cell is either:
 * - ACTIVE: Part of the playable area
 * - REMOVED: Fenced off, obstacle, or outside board
 * 
 * This eliminates any inference from physics or collision outcomes.
 */

import { Vector2, Polygon, pointInPolygon, lineSegmentIntersection } from './polygon';

export enum CellState {
  ACTIVE = 0,
  REMOVED = 1,
}

export interface SpaceGrid {
  /** Grid resolution (cell size in world units) */
  cellSize: number;
  /** Number of cells in X direction */
  width: number;
  /** Number of cells in Y direction */
  height: number;
  /** Origin offset in world coordinates (top-left of grid) */
  originX: number;
  /** Origin offset in world coordinates */
  originY: number;
  /** Flat array of cell states [row * width + col] */
  cells: Uint8Array;
  /** Total number of cells that were ACTIVE at level start (for percentage calc) */
  initialActiveCount: number;
  /**
   * Current number of ACTIVE cells, maintained incrementally by the mutators
   * below so per-frame readers never have to scan the whole grid.
   */
  activeCount: number;
  /**
   * Region id of each ACTIVE cell (null = unpainted), repainted from the
   * regions' sample points after every cut. Lets physics answer "is this ball
   * still in its region?" with one array read instead of a sample-point scan.
   * Only meaningful for cells that are ACTIVE — removed cells may hold stale ids.
   */
  cellRegionIds: (string | null)[];
  /**
   * Indices of cells that are REMOVED because they belong to an obstacle (its
   * interior or sealed boundary), as opposed to board-outside or fences. Capture
   * treats these as passable so an obstacle can't leave an uncapturable pocket
   * behind it — see captureBallFreeGridRegions.
   */
  obstacleCells: number[];
}

export interface GridRegion {
  id: string;
  /** Indices into the grid's cells array */
  cellIndices: number[];
  /** World-space center of the region */
  centroid: Vector2;
  /** Number of cells (for percentage calculation) */
  cellCount: number;
}

/**
 * Create a new SpaceGrid for a game board.
 * Cells inside the board polygon are ACTIVE, cells inside obstacles are REMOVED.
 */
export function createSpaceGrid(
  boardPolygon: Polygon,
  obstacles: Polygon[],
  cellSize: number = 15
): SpaceGrid {
  // Get bounds of the board
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of boardPolygon.vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  
  // Add padding to ensure we cover edges
  const padding = cellSize;
  const originX = minX - padding;
  const originY = minY - padding;
  const width = Math.ceil((maxX - minX + padding * 2) / cellSize);
  const height = Math.ceil((maxY - minY + padding * 2) / cellSize);
  
  const cells = new Uint8Array(width * height);
  cells.fill(CellState.REMOVED); // Default to removed
  
  let initialActiveCount = 0;
  const obstacleCellSet = new Set<number>();

  // Mark cells inside board and outside obstacles as ACTIVE
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const worldX = originX + col * cellSize + cellSize / 2;
      const worldY = originY + row * cellSize + cellSize / 2;
      const point = { x: worldX, y: worldY };
      const index = row * width + col;

      // Must be inside board
      if (!pointInPolygon(point, boardPolygon)) continue;

      // Must not be inside any obstacle
      let insideObstacle = false;
      for (const obstacle of obstacles) {
        if (pointInPolygon(point, obstacle)) {
          insideObstacle = true;
          break;
        }
      }
      if (insideObstacle) { obstacleCellSet.add(index); continue; } // obstacle interior (inside board)

      // Cell is playable
      cells[index] = CellState.ACTIVE;
      initialActiveCount++;
    }
  }

  const grid: SpaceGrid = {
    cellSize,
    width,
    height,
    originX,
    originY,
    cells,
    initialActiveCount,
    activeCount: initialActiveCount,
    cellRegionIds: new Array<string | null>(cells.length).fill(null),
    obstacleCells: [],
  };

  // Seal obstacle boundaries into the grid. Removing only cells whose CENTER
  // falls inside an obstacle leaves a sparse, non-4-connected barrier for thin or
  // diagonal obstacles (mirrors especially): grid connectivity then leaks across
  // the obstacle, so space it physically separates stays one region and is never
  // isolated or captured (the persistent "shadow behind the obstacle"). Rasterize
  // each obstacle edge into a connected band of REMOVED cells — the same sealing
  // the game already applies to fence cuts — so the grid matches physical
  // reachability. Paths *around* a partial obstacle stay connected, since only
  // cells along the boundary are removed.
  for (const obstacle of obstacles) {
    const vs = obstacle.vertices;
    for (let i = 0; i < vs.length; i++) {
      for (const ci of rasterizeCutToGrid(grid, vs[i], vs[(i + 1) % vs.length], cellSize)) {
        obstacleCellSet.add(ci); // sealed obstacle boundary
      }
    }
  }
  grid.initialActiveCount = grid.activeCount;
  grid.obstacleCells = [...obstacleCellSet];

  return grid;
}

/**
 * Get the grid cell index for a world position.
 * Returns -1 if out of bounds.
 */
export function worldToGridIndex(grid: SpaceGrid, worldX: number, worldY: number): number {
  const col = Math.floor((worldX - grid.originX) / grid.cellSize);
  const row = Math.floor((worldY - grid.originY) / grid.cellSize);
  
  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) {
    return -1;
  }
  
  return row * grid.width + col;
}

/**
 * Get the world-space center of a grid cell.
 */
export function gridIndexToWorld(grid: SpaceGrid, index: number): Vector2 {
  const row = Math.floor(index / grid.width);
  const col = index % grid.width;
  
  return {
    x: grid.originX + col * grid.cellSize + grid.cellSize / 2,
    y: grid.originY + row * grid.cellSize + grid.cellSize / 2,
  };
}

/**
 * Get grid row and column from index.
 */
export function indexToRowCol(grid: SpaceGrid, index: number): { row: number; col: number } {
  return {
    row: Math.floor(index / grid.width),
    col: index % grid.width,
  };
}

/**
 * Check if a cell is ACTIVE.
 */
export function isCellActive(grid: SpaceGrid, index: number): boolean {
  if (index < 0 || index >= grid.cells.length) return false;
  return grid.cells[index] === CellState.ACTIVE;
}

/**
 * Mark a cell as REMOVED.
 */
export function markCellRemoved(grid: SpaceGrid, index: number): void {
  if (index >= 0 && index < grid.cells.length) {
    if (grid.cells[index] === CellState.ACTIVE) grid.activeCount--;
    grid.cells[index] = CellState.REMOVED;
  }
}

/**
 * Restore previously removed cells to ACTIVE (Ascension fence breaks).
 * Only flips cells that are currently REMOVED, keeping activeCount exact.
 */
export function restoreCells(grid: SpaceGrid, indices: number[]): void {
  for (const index of indices) {
    if (index >= 0 && index < grid.cells.length && grid.cells[index] === CellState.REMOVED) {
      grid.cells[index] = CellState.ACTIVE;
      grid.activeCount++;
    }
  }
}

/**
 * Rasterize a line segment into the grid, marking all intersected cells as REMOVED.
 * This is used when a cut is completed.
 */
export function rasterizeCutToGrid(
  grid: SpaceGrid,
  start: Vector2,
  end: Vector2,
  thickness: number = 6
): number[] {
  const removedIndices: number[] = [];
  const halfThickness = thickness / 2;
  
  // Get line direction and perpendicular
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.001) return removedIndices;
  
  const dirX = dx / length;
  const dirY = dy / length;
  const perpX = -dirY;
  const perpY = dirX;
  
  // Check every cell for intersection with the thick line segment
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const index = row * grid.width + col;
      
      // Skip already removed cells
      if (grid.cells[index] === CellState.REMOVED) continue;
      
      const cellCenter = gridIndexToWorld(grid, index);
      
      // Distance from cell center to line
      const toStart = { x: cellCenter.x - start.x, y: cellCenter.y - start.y };
      const alongLine = toStart.x * dirX + toStart.y * dirY;
      
      // Project onto line
      let closestOnLine: Vector2;
      if (alongLine <= 0) {
        closestOnLine = start;
      } else if (alongLine >= length) {
        closestOnLine = end;
      } else {
        closestOnLine = { x: start.x + dirX * alongLine, y: start.y + dirY * alongLine };
      }
      
      const distToLine = Math.sqrt(
        (cellCenter.x - closestOnLine.x) ** 2 + 
        (cellCenter.y - closestOnLine.y) ** 2
      );
      
      // Cell is intersected if its center is within (thickness/2 + cellSize/2) of the line
      // This ensures we mark cells that the line passes through
      if (distToLine < halfThickness + grid.cellSize / 2) {
        grid.cells[index] = CellState.REMOVED;
        grid.activeCount--;
        removedIndices.push(index);
      }
    }
  }
  
  return removedIndices;
}

/**
 * Count current ACTIVE cells.
 * O(1): the count is maintained incrementally by markCellRemoved /
 * rasterizeCutToGrid / removeRegion (the only cell mutators), so callers —
 * including the per-frame progress bar — never scan the grid.
 */
export function countActiveCells(grid: SpaceGrid): number {
  return grid.activeCount;
}

/**
 * Calculate remaining percentage of playable area.
 * This is exact and authoritative.
 */
export function getRemainingPercent(grid: SpaceGrid): number {
  if (grid.initialActiveCount === 0) return 0;
  return (grid.activeCount / grid.initialActiveCount) * 100;
}

/**
 * Calculate removed/fenced percentage of area.
 */
export function getFencedPercent(grid: SpaceGrid): number {
  return 100 - getRemainingPercent(grid);
}

/**
 * Find all connected regions of ACTIVE cells using flood-fill.
 * Returns array of regions, each containing the indices of connected cells.
 */
let regionIdCounter = 0;
export function findGridRegions(grid: SpaceGrid): GridRegion[] {
  const regions: GridRegion[] = [];
  const visited = new Uint8Array(grid.cells.length);
  
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] !== CellState.ACTIVE || visited[i]) continue;
    
    // Start new region with flood-fill
    const cellIndices: number[] = [];
    // Use a head index instead of Array.shift() (which is O(n) and makes the
    // whole flood-fill O(n²) on large grids — this runs on every cut).
    const queue: number[] = [i];
    let head = 0;
    visited[i] = 1;

    let sumX = 0, sumY = 0;

    while (head < queue.length) {
      const current = queue[head++];
      cellIndices.push(current);
      
      const center = gridIndexToWorld(grid, current);
      sumX += center.x;
      sumY += center.y;
      
      const { row, col } = indexToRowCol(grid, current);
      
      // Check 4-connected neighbors (cardinal directions)
      const neighbors = [
        row > 0 ? current - grid.width : -1,                    // up
        row < grid.height - 1 ? current + grid.width : -1,       // down
        col > 0 ? current - 1 : -1,                              // left
        col < grid.width - 1 ? current + 1 : -1,                 // right
      ];
      
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && 
            grid.cells[neighbor] === CellState.ACTIVE && 
            !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    
    if (cellIndices.length > 0) {
      regions.push({
        id: `grid-region-${++regionIdCounter}`,
        cellIndices,
        centroid: { 
          x: sumX / cellIndices.length, 
          y: sumY / cellIndices.length 
        },
        cellCount: cellIndices.length,
      });
    }
  }
  
  return regions;
}

/**
 * Find which region a world position belongs to.
 */
export function findRegionForPosition(
  grid: SpaceGrid, 
  regions: GridRegion[], 
  pos: Vector2
): GridRegion | null {
  const index = worldToGridIndex(grid, pos.x, pos.y);
  if (index < 0 || grid.cells[index] !== CellState.ACTIVE) return null;
  
  for (const region of regions) {
    if (region.cellIndices.includes(index)) {
      return region;
    }
  }
  
  return null;
}

/**
 * Get the percentage of total board that a region occupies.
 */
export function getRegionPercentage(grid: SpaceGrid, region: GridRegion): number {
  if (grid.initialActiveCount === 0) return 0;
  return (region.cellCount / grid.initialActiveCount) * 100;
}

/**
 * Mark an entire region as REMOVED.
 */
export function removeRegion(grid: SpaceGrid, region: GridRegion): void {
  for (const index of region.cellIndices) {
    if (grid.cells[index] === CellState.ACTIVE) grid.activeCount--;
    grid.cells[index] = CellState.REMOVED;
  }
}

/**
 * Get all ACTIVE cell world positions (for rendering).
 */
export function getActiveCellPositions(grid: SpaceGrid): Vector2[] {
  const positions: Vector2[] = [];
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === CellState.ACTIVE) {
      positions.push(gridIndexToWorld(grid, i));
    }
  }
  return positions;
}

/**
 * Get cell positions for a specific region (for rendering).
 */
export function getRegionCellPositions(grid: SpaceGrid, region: GridRegion): Vector2[] {
  return region.cellIndices.map(index => gridIndexToWorld(grid, index));
}

/**
 * Check if a position is in ACTIVE space (not removed).
 */
export function isPositionActive(grid: SpaceGrid, pos: Vector2): boolean {
  const index = worldToGridIndex(grid, pos.x, pos.y);
  return isCellActive(grid, index);
}

/**
 * Get neighbors of a cell that are ACTIVE (for connectivity checks).
 */
export function getActiveNeighbors(grid: SpaceGrid, index: number): number[] {
  const { row, col } = indexToRowCol(grid, index);
  const neighbors: number[] = [];

  // 4-connected neighbors
  if (row > 0) {
    const up = index - grid.width;
    if (isCellActive(grid, up)) neighbors.push(up);
  }
  if (row < grid.height - 1) {
    const down = index + grid.width;
    if (isCellActive(grid, down)) neighbors.push(down);
  }
  if (col > 0) {
    const left = index - 1;
    if (isCellActive(grid, left)) neighbors.push(left);
  }
  if (col < grid.width - 1) {
    const right = index + 1;
    if (isCellActive(grid, right)) neighbors.push(right);
  }

  return neighbors;
}

/**
 * Build a Map from cell index → GridRegion for O(1) ball-in-region lookups.
 * Call once per frame when you need repeated lookups across multiple balls.
 */
export function buildGridRegionMap(gridRegions: GridRegion[]): Map<number, GridRegion> {
  const map = new Map<number, GridRegion>();
  for (const region of gridRegions) {
    for (const idx of region.cellIndices) {
      map.set(idx, region);
    }
  }
  return map;
}

/**
 * Find the GridRegion a ball belongs to, even when the ball's direct grid cell is
 * REMOVED (e.g. ball center fractionally inside a mirror-polygon boundary).
 *
 * Tries the direct cell first; if that is not in any region, expands outward up to
 * SEARCH_RADIUS cells looking for an ACTIVE cell that IS in a region.  The search
 * is performed in spiral order so the nearest valid cell wins.
 */
export function findGridRegionForBall(
  grid: SpaceGrid,
  regionMap: Map<number, GridRegion>,
  ballX: number,
  ballY: number,
): GridRegion | null {
  const directIndex = worldToGridIndex(grid, ballX, ballY);
  if (directIndex < 0) return null;

  // Fast path: direct cell is active and mapped
  const direct = regionMap.get(directIndex);
  if (direct !== undefined) return direct;

  // Fallback: search a 5×5 neighbourhood (±2 cells) for the nearest active region cell
  const col = directIndex % grid.width;
  const row = Math.floor(directIndex / grid.width);
  // Search in order of Manhattan distance so the closest match wins
  for (let radius = 1; radius <= 2; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue; // only the shell
        const r2 = row + dr;
        const c2 = col + dc;
        if (r2 < 0 || r2 >= grid.height || c2 < 0 || c2 >= grid.width) continue;
        const idx = r2 * grid.width + c2;
        const region = regionMap.get(idx);
        if (region !== undefined) return region;
      }
    }
  }

  return null;
}
