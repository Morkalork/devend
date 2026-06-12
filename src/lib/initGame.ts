/**
 * createInitialGameData — pure factory for level initialisation geometry.
 *
 * Builds all stationary world data (board, obstacles, balls, space grid,
 * regions) from a level config and active modifiers.  No React, no DOM.
 *
 * Called by GameCanvas's initGame() which then applies side-effects
 * (canvas repaints, React state setters, etc.) that cannot live here.
 */

import { LevelConfig, LevelMoverEntity, MoverCircleEntity, MoverRectEntity } from "@/types/level";
import { MoverState, buildMoverPolygon } from "@/lib/physics/moverState";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { Ball, Region, Vector2 } from "@/types/game";
import { Polygon } from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";
import { SpaceGrid, GridRegion } from "@/lib/spaceGrid";
import {
  vec2Length,
  pointInPolygon,
  polygonBounds,
  polygonCentroid,
  createRectPolygon,
  createPolygonFromShape,
  pointToSegmentDistance,
} from "@/lib/polygon";
import { createWallsFromPolygon } from "@/lib/wallGeometry";
import {
  createSpaceGrid,
  findGridRegions,
  isPositionActive,
} from "@/lib/spaceGrid";
import { generateRandomObstacles } from "@/lib/randomObstacles";
import { decoratePolygon } from "@/lib/obstacleDecorations";
import {
  getVarietyDecorationConfig,
  applyRectVariation,
  applyCircleVariation,
  applyPolygonVariation,
  resetRunSeed,
} from "@/lib/varietySystem";
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from "@/lib/boardConstants";
import {
  ARENA_MARGIN,
  BASE_BALL_RADIUS,
} from "@/lib/gameConstants";
import {
  generateRegionId,
  getRandomDirection,
  getBallSpeedLevelMultiplier,
} from "@/lib/gameUtils";
import { createBallEffectState } from "@/lib/ballEffects";

// ── Return type ────────────────────────────────────────────────────────────

export interface InitialGameData {
  walls: Wall[];
  obstaclePolygons: Polygon[];
  mirrorPolygons: Polygon[];
  boardPolygon: Polygon;
  originalArea: number;
  basePlayableArea: number;
  balls: Ball[];
  movers: MoverState[];
  initialSamplePoints: Vector2[];
  spaceGrid: SpaceGrid;
  gridRegions: GridRegion[];
  regions: Region[];
  fastestBallId: string | null;
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createInitialGameData(
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
): InitialGameData {
  const margin = Math.min(BOARD_WIDTH, BOARD_HEIGHT) * ARENA_MARGIN;
  const arenaWidth  = BOARD_WIDTH  - margin * 2;
  const arenaHeight = BOARD_HEIGHT - margin * 2;

  // startingCapturePercent (Equity Grant cert) shrinks the playable arena and
  // counts the trimmed margin as already-captured: the run starts below 100%.
  const startingCapture = Math.max(0, Math.min(40, activeModifiers.startingCapturePercent));
  const targetRemaining = 100 - startingCapture;
  const scaleFactor  = Math.sqrt(targetRemaining / 100);
  const shrunkWidth  = arenaWidth  * scaleFactor;
  const shrunkHeight = arenaHeight * scaleFactor;
  const centerX = BOARD_WIDTH  / 2;
  const centerY = BOARD_HEIGHT / 2;

  const left   = centerX - shrunkWidth  / 2;
  const top    = centerY - shrunkHeight / 2;
  const right  = centerX + shrunkWidth  / 2;
  const bottom = centerY + shrunkHeight / 2;

  const boardPolygon = createRectPolygon(left, top, right, bottom);

  // ── Build walls array (board edges → obstacle edges) ───────────────────
  const allWalls: Wall[] = createWallsFromPolygon(boardPolygon, "board");
  const obstaclePolygons: Polygon[] = [];
  const mirrorPolygons:   Polygon[] = [];

  // Reset run seed for new game/level (consistent variety per run)
  resetRunSeed();

  const variety = level.variety ?? 0;

  const randomObstacles = generateRandomObstacles(
    level.randomShapes ?? 20,
    level.entities || [],
    level.balls,
  );
  const allEntities = [...(level.entities || []), ...randomObstacles];

  if (allEntities.length > 0) {
    let obstacleIndex = 0;
    for (const entity of allEntities) {
      if (entity.kind === "wall") {
        const isMirror = !!entity.mirror;
        let basePolygon: Polygon;

        if (entity.shape === "rect") {
          if (isMirror) {
            basePolygon = createPolygonFromShape("rect", {
              x: entity.x, y: entity.y,
              width: entity.width, height: entity.height,
            });
          } else {
            const varied = applyRectVariation(
              entity.x, entity.y, entity.width, entity.height,
              variety, level.id, entity.id,
            );
            basePolygon = createPolygonFromShape("rect", {
              x: varied.x, y: varied.y,
              width: varied.width, height: varied.height,
            });
          }
        } else if (entity.shape === "polygon") {
          if (isMirror) {
            basePolygon = { vertices: entity.points.map(([x, y]) => ({ x, y })) };
          } else {
            const variedVertices = applyPolygonVariation(
              entity.points.map(([x, y]) => ({ x, y })),
              variety, level.id, entity.id,
            );
            basePolygon = { vertices: variedVertices };
          }
        } else if (entity.shape === "circle") {
          const radius = isMirror
            ? entity.radius
            : applyCircleVariation(entity.radius, variety, level.id, entity.id);
          const numSides = 64;
          const vertices: { x: number; y: number }[] = [];
          for (let i = 0; i < numSides; i++) {
            const angle = (i / numSides) * Math.PI * 2;
            vertices.push({
              x: entity.cx + Math.cos(angle) * radius,
              y: entity.cy + Math.sin(angle) * radius,
            });
          }
          basePolygon = { vertices };
        } else {
          continue;
        }

        let obstaclePolygon: Polygon;
        if (isMirror) {
          obstaclePolygon = basePolygon;
        } else {
          const decorationConfig = getVarietyDecorationConfig(
            variety, level.id, entity.id, obstacleIndex,
          );
          obstaclePolygon = variety > 0
            ? decoratePolygon(basePolygon, decorationConfig)
            : basePolygon;
        }
        obstacleIndex++;

        if (isMirror) {
          mirrorPolygons.push(obstaclePolygon);
        }
        obstaclePolygons.push(obstaclePolygon);
        const obstacleWalls = createWallsFromPolygon(obstaclePolygon, `obstacle-${entity.id}`, isMirror);
        allWalls.push(...obstacleWalls);
      }
    }
  }

  // ── Ball placement helpers ─────────────────────────────────────────────

  const bounds   = polygonBounds(boardPolygon);
  const rWidth   = bounds.maxX - bounds.minX;
  const rHeight  = bounds.maxY - bounds.minY;
  const centroid = polygonCentroid(boardPolygon);

  const isBallPositionValid = (pos: Vector2, radius: number): boolean => {
    const safeRadius = radius + 5;

    if (!pointInPolygon(pos, boardPolygon)) return false;

    const numPerimeterChecks = 16;
    for (let i = 0; i < numPerimeterChecks; i++) {
      const angle = (i / numPerimeterChecks) * Math.PI * 2;
      const p = { x: pos.x + Math.cos(angle) * safeRadius, y: pos.y + Math.sin(angle) * safeRadius };
      if (!pointInPolygon(p, boardPolygon)) return false;
    }

    for (const obstacle of obstaclePolygons) {
      if (pointInPolygon(pos, obstacle)) return false;

      for (let i = 0; i < numPerimeterChecks; i++) {
        const angle = (i / numPerimeterChecks) * Math.PI * 2;
        const p = { x: pos.x + Math.cos(angle) * safeRadius, y: pos.y + Math.sin(angle) * safeRadius };
        if (pointInPolygon(p, obstacle)) return false;
      }

      const obsBounds = polygonBounds(obstacle);
      if (pos.x + safeRadius > obsBounds.minX &&
          pos.x - safeRadius < obsBounds.maxX &&
          pos.y + safeRadius > obsBounds.minY &&
          pos.y - safeRadius < obsBounds.maxY) {
        for (let i = 0; i < obstacle.vertices.length; i++) {
          const v1 = obstacle.vertices[i];
          const v2 = obstacle.vertices[(i + 1) % obstacle.vertices.length];
          if (pointToSegmentDistance(pos, v1, v2) < safeRadius) return false;
        }
      }
    }

    if (pos.x - safeRadius < left  || pos.x + safeRadius > right ||
        pos.y - safeRadius < top   || pos.y + safeRadius > bottom) {
      return false;
    }

    return true;
  };

  const findValidSpawnPosition = (ballRadius: number): Vector2 => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const spreadFactor = Math.min(0.8, 0.3 + (attempt / 300) * 0.5);
      const pos = {
        x: centroid.x + (Math.random() - 0.5) * rWidth  * spreadFactor,
        y: centroid.y + (Math.random() - 0.5) * rHeight * spreadFactor,
      };
      if (isBallPositionValid(pos, ballRadius)) return pos;
    }

    // Grid search fallback
    const gridStep = ballRadius * 2;
    for (let x = left + ballRadius + 10; x < right - ballRadius - 10; x += gridStep) {
      for (let y = top + ballRadius + 10; y < bottom - ballRadius - 10; y += gridStep) {
        const pos = { x, y };
        if (isBallPositionValid(pos, ballRadius)) return pos;
      }
    }

    console.warn("Could not find valid spawn position for ball, using centroid as fallback");
    return { ...centroid };
  };

  // ── Create balls ───────────────────────────────────────────────────────

  const ballSpeedLevelMult   = getBallSpeedLevelMultiplier(levelNumber);
  const baseSpeedMultiplier  = 2.0;

  const balls: Ball[] = level.balls.map((ballConfig) => {
    const dir             = getRandomDirection();
    const levelScaledSpeed =
      ballConfig.initialSpeed * baseSpeedMultiplier * ballSpeedLevelMult * activeModifiers.ballSpeedMultiplier;
    const modifiedTopSpeed = ballConfig.topSpeed * baseSpeedMultiplier * activeModifiers.ballSpeedMultiplier;
    const modifiedSpeed    = Math.min(levelScaledSpeed, modifiedTopSpeed);

    const ballRadius = (ballConfig.radius ?? BASE_BALL_RADIUS) * activeModifiers.ballSizeMultiplier;

    let position: Vector2;
    if (ballConfig.startX !== undefined && ballConfig.startY !== undefined) {
      const configuredPos = { x: ballConfig.startX, y: ballConfig.startY };
      if (isBallPositionValid(configuredPos, ballRadius)) {
        position = configuredPos;
      } else {
        console.warn(`Ball ${ballConfig.id} configured position is invalid, finding alternative`);
        position = findValidSpawnPosition(ballRadius);
      }
    } else {
      position = findValidSpawnPosition(ballRadius);
    }

    return {
      id:            ballConfig.id,
      position,
      velocity:      { x: dir.x * modifiedSpeed, y: dir.y * modifiedSpeed },
      radius:        ballRadius,
      speed:         modifiedSpeed,
      baseSpeed:     modifiedSpeed,
      topSpeed:      modifiedTopSpeed,
      color:         `#${ballConfig.color}`,
      regionId:      "", // assigned after regions are created
      rotation:      Math.random() * Math.PI * 2,
      flashIntensity: 0,
      effects:       createBallEffectState(),
      state:         'active' as const,
      wonSpinSpeed:  0,
      wonTime:       0,
      assimScale:    1,
      assimColorFade: 0,
    };
  });

  // ── Space grid & initial region ───────────────────────────────────────

  const initGridSize = 15;
  const initBounds   = polygonBounds(boardPolygon);
  const initSamplePoints: Vector2[] = [];

  for (let x = initBounds.minX + initGridSize / 2; x < initBounds.maxX; x += initGridSize) {
    for (let y = initBounds.minY + initGridSize / 2; y < initBounds.maxY; y += initGridSize) {
      const point = { x, y };
      if (!pointInPolygon(point, boardPolygon)) continue;
      let insideObstacle = false;
      for (const obstacle of obstaclePolygons) {
        if (pointInPolygon(point, obstacle)) { insideObstacle = true; break; }
      }
      if (!insideObstacle) initSamplePoints.push(point);
    }
  }

  const spaceGrid   = createSpaceGrid(boardPolygon, obstaclePolygons, initGridSize);
  const gridRegions = findGridRegions(spaceGrid);

  // Inflate the percentage baseline so the remaining% starts at targetRemaining
  // instead of 100 — the shrunk-away margin counts as captured space.
  if (targetRemaining < 100) {
    spaceGrid.initialActiveCount = Math.round(spaceGrid.activeCount * 100 / targetRemaining);
  }

  const initialEstimatedArea = spaceGrid.initialActiveCount * initGridSize * initGridSize;
  const initialRegionId      = generateRegionId();

  const regions: Region[] = [{
    id:            initialRegionId,
    polygon:       boardPolygon,
    samplePoints:  initSamplePoints,
    estimatedArea: initialEstimatedArea,
  }];

  // Assign all balls to initial region
  for (const ball of balls) {
    ball.regionId = initialRegionId;
    if (!isPositionActive(spaceGrid, ball.position)) {
      console.warn(`[INIT] Ball ${ball.id} spawned in removed space, repositioning...`);
    }
  }

  // ── Build movers ──────────────────────────────────────────────────────

  const movers: MoverState[] = [];
  for (const entity of allEntities) {
    if (entity.kind !== "mover") continue;
    const e = entity as LevelMoverEntity;
    const phase  = e.phase ?? 0;
    const offset = phase * e.range - e.range / 2;

    let homeX: number, homeY: number;
    let shapeProps: Pick<MoverState, 'radius' | 'width' | 'height'> = {};
    if (e.shape === "circle") {
      const ce = e as MoverCircleEntity;
      homeX = ce.cx;
      homeY = ce.cy;
      shapeProps = { radius: ce.radius };
    } else {
      const re = e as MoverRectEntity;
      homeX = re.x + re.width  / 2;
      homeY = re.y + re.height / 2;
      shapeProps = { width: re.width, height: re.height };
    }

    const mover: MoverState = {
      id:        e.id,
      shape:     e.shape,
      homeX,
      homeY,
      axis:      e.axis,
      range:     e.range,
      speed:     e.speed,
      offset,
      direction: 1,
      polygon:   { vertices: [] },
      ...shapeProps,
    };
    mover.polygon = buildMoverPolygon(mover);
    movers.push(mover);
  }

  // ── Fastest ball ──────────────────────────────────────────────────────

  let fastestBallId: string | null = null;
  if (balls.length > 0) {
    let fastestSpeed = 0;
    fastestBallId = balls[0].id;
    for (const ball of balls) {
      const spd = vec2Length(ball.velocity);
      if (spd > fastestSpeed) { fastestSpeed = spd; fastestBallId = ball.id; }
    }
  }

  return {
    walls:               allWalls,
    obstaclePolygons,
    mirrorPolygons,
    boardPolygon,
    originalArea:        initialEstimatedArea,
    basePlayableArea:    initialEstimatedArea,
    balls,
    movers,
    initialSamplePoints: initSamplePoints,
    spaceGrid,
    gridRegions,
    regions,
    fastestBallId,
  };
}
