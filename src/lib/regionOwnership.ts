/**
 * Region Ownership System
 * ========================
 * 
 * CORE INVARIANT: Every ball must belong to exactly one valid playable region at all times.
 * 
 * A ball must NEVER exist in:
 * - Removed regions
 * - Sealed-off regions without balls  
 * - Undefined space
 * 
 * This invariant is enforced continuously.
 */

import { Vector2 } from './polygon';
import { Region, Ball } from '@/types/game';
import { 
  vec2Distance, 
  vec2Sub, 
  vec2Add, 
  vec2Scale, 
  vec2Normalize,
  vec2Dot,
  pointInPolygon,
  lineSegmentIntersection,
  polygonCentroid
} from './polygon';
import { Wall } from './wallGeometry';
import { SAMPLE_GRID_SIZE } from './regionSplit';
import { SpaceGrid, CellState, worldToGridIndex } from './spaceGrid';

// Re-export under the legacy name so existing callers don't need updating.
export const REGION_SAMPLE_GRID_SIZE = SAMPLE_GRID_SIZE;

// Margin for containment checks (2x grid size for safety)
export const CONTAINMENT_MARGIN = REGION_SAMPLE_GRID_SIZE * 2;

/**
 * Paint each region's id onto the space grid's cellRegionIds.
 *
 * Region sample points sit on the same 15-unit lattice as the grid's cell
 * centers, so every sample maps to exactly one cell. Must be called whenever
 * `game.regions` is (re)assigned — level init and after every cut — so the
 * per-physics-step ownership check below stays in sync.
 */
export function paintCellRegionIds(grid: SpaceGrid, regions: Region[]): void {
  grid.cellRegionIds.fill(null);
  for (const region of regions) {
    if (!region.samplePoints) continue;
    for (const sample of region.samplePoints) {
      const index = worldToGridIndex(grid, sample.x, sample.y);
      if (index >= 0 && grid.cells[index] === CellState.ACTIVE) {
        grid.cellRegionIds[index] = region.id;
      }
    }
  }
}

/**
 * O(1) fast-accept ownership check: true when the ball's position falls in an
 * ACTIVE cell painted with its own region id. Fence cells are always REMOVED
 * (rasterizeCutToGrid removes every cell a cut passes through), so an ACTIVE
 * painted cell can never straddle a wall — no wall-crossing check is needed.
 *
 * A `false` result does NOT mean the ball escaped — cells near walls and
 * region edges may be unpainted. Callers must fall back to the sample-scan
 * validation (isBallInRegion) before correcting anything.
 */
export function isBallCellInRegion(grid: SpaceGrid, position: Vector2, regionId: string): boolean {
  const index = worldToGridIndex(grid, position.x, position.y);
  return index >= 0 &&
    grid.cells[index] === CellState.ACTIVE &&
    grid.cellRegionIds[index] === regionId;
}

/**
 * Result of a region ownership validation
 */
export interface OwnershipValidationResult {
  isValid: boolean;
  ballId: string;
  assignedRegionId: string;
  actualRegionId: string | null;
  requiresCorrection: boolean;
  correctionPosition?: Vector2;
  correctionRegionId?: string;
}

/**
 * Find which region contains a ball position using sample-point proximity.
 * This is the authoritative way to determine ball-region membership.
 * 
 * @returns The region containing the ball, or null if none
 */
export function findContainingRegion(
  position: Vector2, 
  regions: Region[],
  walls: Wall[]
): Region | null {
  // Primary check: find nearest sample point that ball can reach without crossing walls
  let bestRegion: Region | null = null;
  let bestDistance = Infinity;
  
  for (const region of regions) {
    if (!region.samplePoints || region.samplePoints.length === 0) {
      // Fallback to polygon check if no sample points
      if (pointInPolygon(position, region.polygon)) {
        return region;
      }
      continue;
    }
    
    for (const sample of region.samplePoints) {
      const dist = vec2Distance(position, sample);
      
      // Must be within containment margin
      if (dist > CONTAINMENT_MARGIN) continue;
      
      // Check if path to sample is clear (no wall crossings)
      let pathBlocked = false;
      for (const wall of walls) {
        if (lineSegmentIntersection(position, sample, wall.start, wall.end)) {
          pathBlocked = true;
          break;
        }
      }
      
      if (!pathBlocked && dist < bestDistance) {
        bestDistance = dist;
        bestRegion = region;
      }
    }
  }
  
  return bestRegion;
}

/**
 * Validate that a ball is in its assigned region.
 * Returns detailed validation result with correction info if needed.
 */
export function validateBallOwnership(
  ball: Ball,
  regions: Region[],
  walls: Wall[]
): OwnershipValidationResult {
  const assignedRegion = regions.find(r => r.id === ball.regionId);
  
  // Case 1: Assigned region no longer exists
  if (!assignedRegion) {
    const actualRegion = findContainingRegion(ball.position, regions, walls);
    
    if (actualRegion) {
      return {
        isValid: false,
        ballId: ball.id,
        assignedRegionId: ball.regionId,
        actualRegionId: actualRegion.id,
        requiresCorrection: true,
        correctionRegionId: actualRegion.id
      };
    }
    
    // Ball is orphaned - find nearest valid position
    const correction = findNearestValidPosition(ball.position, regions, walls);
    return {
      isValid: false,
      ballId: ball.id,
      assignedRegionId: ball.regionId,
      actualRegionId: null,
      requiresCorrection: true,
      correctionPosition: correction.position,
      correctionRegionId: correction.regionId
    };
  }
  
  // Case 2: Check if ball is actually in its assigned region
  const isInAssigned = isBallInRegion(ball.position, assignedRegion, walls);
  
  if (isInAssigned) {
    return {
      isValid: true,
      ballId: ball.id,
      assignedRegionId: ball.regionId,
      actualRegionId: ball.regionId,
      requiresCorrection: false
    };
  }
  
  // Case 3: Ball is not in assigned region - check other regions
  const actualRegion = findContainingRegion(ball.position, regions, walls);
  
  if (actualRegion) {
    return {
      isValid: false,
      ballId: ball.id,
      assignedRegionId: ball.regionId,
      actualRegionId: actualRegion.id,
      requiresCorrection: true,
      correctionRegionId: actualRegion.id
    };
  }
  
  // Case 4: Ball is not in ANY region - find nearest valid position
  const correction = findNearestValidPosition(ball.position, regions, walls);
  return {
    isValid: false,
    ballId: ball.id,
    assignedRegionId: ball.regionId,
    actualRegionId: null,
    requiresCorrection: true,
    correctionPosition: correction.position,
    correctionRegionId: correction.regionId
  };
}

/**
 * Check if a ball position is within a specific region.
 * Uses sample-point proximity with wall-crossing validation.
 */
export function isBallInRegion(
  position: Vector2,
  region: Region,
  walls: Wall[]
): boolean {
  if (!region.samplePoints || region.samplePoints.length === 0) {
    return pointInPolygon(position, region.polygon);
  }
  
  for (const sample of region.samplePoints) {
    const dist = vec2Distance(position, sample);
    
    if (dist > CONTAINMENT_MARGIN) continue;
    
    // Check if path is clear
    let pathBlocked = false;
    for (const wall of walls) {
      if (lineSegmentIntersection(position, sample, wall.start, wall.end)) {
        pathBlocked = true;
        break;
      }
    }
    
    if (!pathBlocked) return true;
  }
  
  return false;
}

/**
 * Find the nearest valid position for a ball that has escaped all regions.
 */
export function findNearestValidPosition(
  position: Vector2,
  regions: Region[],
  walls: Wall[]
): { position: Vector2; regionId: string } {
  let nearestSample: Vector2 | null = null;
  let nearestRegionId: string | null = null;
  let minDist = Infinity;
  
  for (const region of regions) {
    const samples = region.samplePoints || [];
    for (const sample of samples) {
      const dist = vec2Distance(position, sample);
      if (dist < minDist) {
        minDist = dist;
        nearestSample = sample;
        nearestRegionId = region.id;
      }
    }
  }
  
  if (nearestSample && nearestRegionId) {
    return { position: { ...nearestSample }, regionId: nearestRegionId };
  }
  
  // Ultimate fallback: use centroid of first region
  if (regions.length > 0) {
    const centroid = polygonCentroid(regions[0].polygon);
    return { position: centroid, regionId: regions[0].id };
  }
  
  // Should never happen but satisfy TypeScript
  return { position: { x: 450, y: 300 }, regionId: 'fallback' };
}

/**
 * MANDATORY VALIDATION STEP
 * =========================
 * Must be called after ANY structural change:
 * - Wall completion
 * - Region removal
 * - Region split
 * 
 * This ensures every ball is in a valid region before simulation resumes.
 * 
 * @returns true if all balls are valid, false if corrections were needed
 */
export function validateAllBallOwnership(
  balls: Ball[],
  regions: Region[],
  walls: Wall[]
): { allValid: boolean; corrections: OwnershipValidationResult[] } {
  const corrections: OwnershipValidationResult[] = [];
  let allValid = true;
  
  for (const ball of balls) {
    const result = validateBallOwnership(ball, regions, walls);
    
    if (!result.isValid) {
      allValid = false;
      corrections.push(result);
      
      // Apply correction immediately
      if (result.correctionRegionId) {
        ball.regionId = result.correctionRegionId;
      }
      if (result.correctionPosition) {
        ball.position = { ...result.correctionPosition };
      }
      
    }
  }
  
  return { allValid, corrections };
}

/**
 * Reassign all balls to correct regions based on their positions.
 * Called after regions are rebuilt following a cut.
 * 
 * CRITICAL: This is the authoritative region assignment.
 */
export function reassignBallsToRegions(
  balls: Ball[],
  regions: Region[],
  walls: Wall[]
): void {
  for (const ball of balls) {
    const containingRegion = findContainingRegion(ball.position, regions, walls);
    
    if (containingRegion) {
      if (ball.regionId !== containingRegion.id) {
        ball.regionId = containingRegion.id;
      }
    } else {
      // Ball is orphaned - this should trigger an error condition
      console.error(`[OWNERSHIP] CRITICAL: Ball ${ball.id} has no valid region!`);
      
      // Attempt recovery
      const recovery = findNearestValidPosition(ball.position, regions, walls);
      ball.position = recovery.position;
      ball.regionId = recovery.regionId;
    }
  }
}

/**
 * Check if a proposed wall would orphan any ball (leave it in a region with no sample points).
 * This is called BEFORE finalizing a cut to prevent invalid states.
 */
export function wouldWallOrphanBall(
  wallStart: Vector2,
  wallEnd: Vector2,
  balls: Ball[],
  regions: Region[],
  existingWalls: Wall[]
): boolean {
  // Create a temporary wall for testing
  const testWalls = [
    ...existingWalls,
    { id: 'test-wall', start: wallStart, end: wallEnd, thickness: 6 }
  ];
  
  for (const ball of balls) {
    // Skip dead balls
    if (ball.speed === 0) continue;
    
    // Check if ball can still reach sample points without crossing the new wall
    const region = regions.find(r => r.id === ball.regionId);
    if (!region || !region.samplePoints) continue;
    
    let canReachAnySample = false;
    
    for (const sample of region.samplePoints) {
      let blocked = false;
      
      for (const wall of testWalls) {
        if (lineSegmentIntersection(ball.position, sample, wall.start, wall.end)) {
          blocked = true;
          break;
        }
      }
      
      if (!blocked) {
        canReachAnySample = true;
        break;
      }
    }
    
    if (!canReachAnySample) {
      console.warn(`[OWNERSHIP] Wall would orphan ball ${ball.id}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Constrain a ball's position to stay within its assigned region.
 * Called during physics updates to prevent boundary crossings.
 * 
 * @returns The constrained position and whether a correction was made
 */
export function constrainBallToRegion(
  ball: Ball,
  region: Region,
  walls: Wall[]
): { position: Vector2; corrected: boolean; newVelocity?: Vector2 } {
  // Check if already valid
  if (isBallInRegion(ball.position, region, walls)) {
    return { position: ball.position, corrected: false };
  }
  
  // Find nearest sample point within the region
  if (!region.samplePoints || region.samplePoints.length === 0) {
    return { position: ball.position, corrected: false };
  }
  
  let nearestSample: Vector2 | null = null;
  let minDist = Infinity;
  // Track the nearest sample irrespective of wall-blocking, used as a safe
  // fallback: sample points are inside the region by construction, whereas a
  // polygon centroid can fall outside a non-convex (e.g. L-shaped) region.
  let nearestAnySample: Vector2 | null = null;
  let minAnyDist = Infinity;

  for (const sample of region.samplePoints) {
    const dist = vec2Distance(ball.position, sample);
    if (dist < minAnyDist) {
      minAnyDist = dist;
      nearestAnySample = sample;
    }
    if (dist < minDist) {
      // Verify this sample is accessible (no wall between ball and sample)
      let blocked = false;
      for (const wall of walls) {
        if (lineSegmentIntersection(ball.position, sample, wall.start, wall.end)) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        minDist = dist;
        nearestSample = sample;
      }
    }
  }

  // Reverse velocity to bounce back
  const newVelocity = vec2Scale(ball.velocity, -0.8);

  if (nearestSample) {
    // Move toward the nearest accessible sample
    return { position: { ...nearestSample }, corrected: true, newVelocity };
  }

  // Fallback: nearest sample (guaranteed inside the region), not the centroid.
  if (nearestAnySample) {
    return { position: { ...nearestAnySample }, corrected: true, newVelocity };
  }

  // Last resort: region centroid (only if the region has no samples at all).
  return { position: polygonCentroid(region.polygon), corrected: true, newVelocity };
}
