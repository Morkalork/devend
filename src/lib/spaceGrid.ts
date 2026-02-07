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
  
  // Mark cells inside board and outside obstacles as ACTIVE
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const worldX = originX + col * cellSize + cellSize / 2;
      const worldY = originY + row * cellSize + cellSize / 2;
      const point = { x: worldX, y: worldY };
      
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
      if (insideObstacle) continue;
      
      // Cell is playable
      const index = row * width + col;
      cells[index] = CellState.ACTIVE;
      initialActiveCount++;
    }
  }
  
  return {
    cellSize,
    width,
    height,
    originX,
    originY,
    cells,
    initialActiveCount,
  };
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
    grid.cells[index] = CellState.REMOVED;
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
        removedIndices.push(index);
      }
    }
  }
  
  return removedIndices;
}

/**
 * Count current ACTIVE cells.
 */
export function countActiveCells(grid: SpaceGrid): number {
  let count = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === CellState.ACTIVE) count++;
  }
  return count;
}

/**
 * Calculate remaining percentage of playable area.
 * This is exact and authoritative.
 */
export function getRemainingPercent(grid: SpaceGrid): number {
  if (grid.initialActiveCount === 0) return 0;
  const active = countActiveCells(grid);
  return (active / grid.initialActiveCount) * 100;
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
    const queue: number[] = [i];
    visited[i] = 1;
    
    let sumX = 0, sumY = 0;
    
    while (queue.length > 0) {
      const current = queue.shift()!;
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
