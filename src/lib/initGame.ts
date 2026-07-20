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
import { Ball, Region, Vector2, DestructibleState, StackObject } from "@/types/game";
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
  CellState,
} from "@/lib/spaceGrid";
import { generateRandomObstacles } from "@/lib/randomObstacles";
import { resolveSlots, PROCEDURAL_MIN_LEVEL } from "@/lib/mapSlots";
import { decoratePolygon } from "@/lib/obstacleDecorations";
import {
  getVarietyDecorationConfig,
  applyRectVariation,
  applyCircleVariation,
  applyPolygonVariation,
  resetRunSeed,
  setRunSeed,
} from "@/lib/varietySystem";
import { getRunSeedText, getRunRng, hashString } from "@/lib/runRng";
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
} from "@/lib/gameUtils";
import { createBallEffectState } from "@/lib/ballEffects";
import { selectBallTypesForMap, getBallType, BallTypeDef, effectiveBallSpeedFactor } from "@/lib/ballTypes";

/**
 * Build one ball of a given type at a position. Shared by map init and the
 * rainbow ball's timed spit-out so a spawned ball is indistinguishable from an
 * authored one. `speedScale` is the effective ball-speed factor; `radius` the
 * scaled ball radius; `spawnActiveSeconds` anchors any spawn timer (0 at init).
 */
export function createBall(
  type: BallTypeDef,
  position: Vector2,
  speedScale: number,
  radius: number,
  id: string,
  spawnTime: number,
  spawnActiveSeconds: number,
): Ball {
  const dir = getRandomDirection();
  const speed = type.baseSpeed * speedScale;
  const speedRange: [number, number] | undefined = type.speedRange
    ? [type.speedRange[0] * speedScale, type.speedRange[1] * speedScale]
    : undefined;
  return {
    id,
    position,
    velocity: { x: dir.x * speed, y: dir.y * speed },
    radius,
    speed,
    baseSpeed: speed,
    topSpeed: speed, // flat speed; the danger tint uses an absolute reference
    color: type.color,
    regionId: "", // assigned after regions are created (or inherited by a spawner)
    rotation: Math.random() * Math.PI * 2,
    flashIntensity: 0,
    effects: createBallEffectState(),
    state: 'active' as const,
    wonSpinSpeed: 0,
    wonTime: 0,
    assimScale: 1,
    assimColorFade: 0,
    typeId: type.id,
    ability: type.ability,
    lockMultiplier: type.lockMultiplier,
    spawnTime,
    minimumSpeed: type.minimumSpeed * speedScale,
    speedReduction: type.speedReduction !== undefined ? type.speedReduction * speedScale : undefined,
    speedRange,
    lastSpeedStepAt: 0,
    spawnActiveSeconds,
    rainbowSpawnCount: 0,
  };
}

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
  destructibles: DestructibleState[];
  stackObjects: StackObject[];
  objectivesTotal: number;
  initialSamplePoints: Vector2[];
  spaceGrid: SpaceGrid;
  gridRegions: GridRegion[];
  regions: Region[];
  fastestBallId: string | null;
  // Boss ball (issue #56): seeded when the level has a boss.bossBall.
  bossActive: boolean;
  bossHp: number;
  bossMaxHp: number;
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
  const destructibles:    DestructibleState[] = [];
  // Non-mirror obstacles participating in the break/topple support graph (#38).
  const obstacleEntities: Array<{ id: string; polygon: Polygon; breakable: boolean }> = [];
  // Sealed areas gated by a breakable (issue #38): carved out at init, re-opened
  // when their gate breaks. Paired with their descriptor to record cell indices.
  const sealedAreas: Array<{ destructible: DestructibleState; poly: Polygon }> = [];
  let objectivesTotal = 0;

  // Reset run seed for new game/level (consistent variety per run). Seeded
  // (daily) runs pin it per map instead, so obstacle variation is shared by
  // every player on the seed (HIGHSCORES.md Phase D).
  const seedText = getRunSeedText();
  if (seedText !== null) {
    setRunSeed(hashString(`${seedText}::variety:${level.id}`));
  } else {
    resetRunSeed();
  }

  const variety = level.variety ?? 0;

  // Procedural slots (issue #53): from PROCEDURAL_MIN_LEVEL on, a level's `slots`
  // resolve through the run seed into extra entities, so the board varies per run
  // (and is shared per Daily seed). L1-10 stay authored/fixed (teaching cadence).
  const slotEntities =
    level.slots && level.slots.length > 0 && levelNumber >= PROCEDURAL_MIN_LEVEL
      ? resolveSlots(level, getRunRng(`slots:${level.id}`))
      : [];
  const authoredEntities = [...(level.entities || []), ...slotEntities];

  const randomObstacles = generateRandomObstacles(
    level.randomShapes ?? 20,
    authoredEntities, // random shapes avoid both fixed and slot-resolved entities
    [], // balls now spawn at game-chosen positions (after obstacles), so none to avoid here
    getRunRng(`obstacles:${level.id}`),
  );
  const allEntities = [...authoredEntities, ...randomObstacles];

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
          // Mirrors can be broken by the black ball (Phase 2).
          destructibles.push({
            id: entity.id,
            kind: 'mirror',
            hits: 0,
            maxHits: 3,
            lastHitAt: 0,
            destroyed: false,
            mirrorPolygon: obstaclePolygon,
          });
        }
        obstaclePolygons.push(obstaclePolygon);
        const obstacleWalls = createWallsFromPolygon(obstaclePolygon, `obstacle-${entity.id}`, isMirror);
        allWalls.push(...obstacleWalls);

        // Breakable obstacles + stack graph (issue #38). Mirrors are handled by
        // the #37 path above and don't participate in break-stacks.
        if (!isMirror) {
          obstacleEntities.push({ id: entity.id, polygon: obstaclePolygon, breakable: !!entity.breakable });
          if (entity.breakable) {
            const dest: DestructibleState = {
              id: entity.id,
              kind: 'breakable',
              hits: 0,
              maxHits: Math.max(1, Math.round(entity.hitsToBreak ?? 3)),
              lastHitAt: 0,
              destroyed: false,
              obstaclePolygon,
              objective: !!entity.objective,
              fenceStyle: !!entity.fence,
            };
            destructibles.push(dest);
            if (entity.objective) objectivesTotal++;
            if (entity.reveals) {
              const r = entity.reveals;
              sealedAreas.push({ destructible: dest, poly: createRectPolygon(r.x, r.y, r.x + r.width, r.y + r.height) });
            }
          }
        }
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

    // Never spawn inside a sealed (locked) area.
    for (const sealed of sealedAreas) {
      if (pointInPolygon(pos, sealed.poly)) return false;
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
  // Issue #37: the game (not the map) decides which balls to use. The map only
  // supplies a maximum; the ball TYPES are chosen deterministically from those
  // eligible at this level. Speeds are flat (literal base-speed × the upgrade
  // multiplier) — no per-level scaling, no per-cut acceleration ramp.

  // Floor the low end so a slow-stacked run never spawns balls below
  // MIN_BALL_SPEED_FACTOR of normal (issue #42); >1 (ascension, Crunch Time)
  // is unaffected.
  const speedScale = effectiveBallSpeedFactor(activeModifiers.ballSpeedMultiplier, 1);
  const maxBalls   = level.maxBalls ?? level.balls?.length ?? 1;
  // Admin override (Playground): when `ballTypeIds` is provided, spawn exactly
  // those types — even an empty list, which means "no balls". Only when the
  // field is absent do we fall back to the normal deterministic selection.
  let selectedTypes: BallTypeDef[];
  if (level.ballTypeIds !== undefined) {
    selectedTypes = level.ballTypeIds.map(id => getBallType(id)).filter((t): t is BallTypeDef => !!t);
  } else {
    selectedTypes = selectBallTypesForMap(level.id, levelNumber, maxBalls);
  }
  const spawnTime  = performance.now();

  // Keep spawned balls from overlapping each other (findValidSpawnPosition only
  // avoids walls/obstacles, not other balls).
  const placed: Vector2[] = [];
  const findSpacedSpawn = (radius: number): Vector2 => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = findValidSpawnPosition(radius);
      if (placed.every(q => Math.hypot(p.x - q.x, p.y - q.y) > radius * 3)) {
        placed.push(p);
        return p;
      }
    }
    const p = findValidSpawnPosition(radius);
    placed.push(p);
    return p;
  };

  const ballRadius = BASE_BALL_RADIUS * activeModifiers.ballSizeMultiplier;
  const balls: Ball[] = selectedTypes.map((type, i) =>
    createBall(type, findSpacedSpawn(ballRadius), speedScale, ballRadius, `${type.id}-${i}`, spawnTime, 0),
  );

  // Boss ball (issue #56): a distinct big/fast antagonist spawned alongside the
  // normal balls. It must be defeated (trapped hp times) to clear a boss map.
  let bossActive = false, bossHp = 0, bossMaxHp = 0;
  const bossBall = level.boss?.bossBall;
  if (bossBall) {
    const baseType = getBallType("red") ?? selectedTypes[0];
    if (baseType) {
      const hp = Math.max(1, Math.round(bossBall.hp ?? 3));
      const bossRadius = ballRadius * (bossBall.radiusScale ?? 2);
      const boss = createBall(
        baseType, findSpacedSpawn(bossRadius), speedScale * (bossBall.speedScale ?? 1.2),
        bossRadius, "boss-rc", spawnTime, 0,
      );
      boss.isBoss = true;
      boss.bossHp = hp;
      boss.bossMaxHp = hp;
      boss.bossFullRadius = bossRadius; // shrinks toward a normal ball as HP drains
      boss.bossMinRadius = ballRadius;  // last-life size = an ordinary ball
      boss.color = bossBall.color ?? "#ff2d55";
      balls.push(boss);
      bossActive = true; bossHp = hp; bossMaxHp = hp;
    }
  }

  // Runtime Optimisation tier-3 option B: cripple ONE random ball each map. All
  // its speed fields scale (physics normalises toward baseSpeed, so scaling only
  // velocity would be undone).
  const slowFactor = activeModifiers.slowOneBallFactor;
  if (slowFactor > 0 && slowFactor < 1 && balls.length > 0) {
    const victim = balls[Math.floor(Math.random() * balls.length)];
    victim.speed *= slowFactor;
    victim.baseSpeed *= slowFactor;
    victim.topSpeed *= slowFactor;
    victim.minimumSpeed *= slowFactor;
    victim.velocity = { x: victim.velocity.x * slowFactor, y: victim.velocity.y * slowFactor };
    if (victim.speedReduction !== undefined) victim.speedReduction *= slowFactor;
    if (victim.speedRange) victim.speedRange = [victim.speedRange[0] * slowFactor, victim.speedRange[1] * slowFactor];
  }

  // ── Space grid & initial region ───────────────────────────────────────

  const initGridSize = 15;
  const initBounds   = polygonBounds(boardPolygon);
  const initSamplePoints: Vector2[] = [];

  const sealedPolys = sealedAreas.map(s => s.poly);
  const insideSealed = (p: Vector2) => sealedPolys.some(poly => pointInPolygon(p, poly));

  for (let x = initBounds.minX + initGridSize / 2; x < initBounds.maxX; x += initGridSize) {
    for (let y = initBounds.minY + initGridSize / 2; y < initBounds.maxY; y += initGridSize) {
      const point = { x, y };
      if (!pointInPolygon(point, boardPolygon)) continue;
      if (insideSealed(point)) continue; // sealed areas aren't playable until opened
      let insideObstacle = false;
      for (const obstacle of obstaclePolygons) {
        if (pointInPolygon(point, obstacle)) { insideObstacle = true; break; }
      }
      if (!insideObstacle) initSamplePoints.push(point);
    }
  }

  // Sealed areas are carved out of the grid like obstacles (removed, and NOT
  // counted in initialActiveCount), so they read as locked until their gate
  // breaks and restores them.
  const spaceGrid   = createSpaceGrid(boardPolygon, sealedPolys.length ? [...obstaclePolygons, ...sealedPolys] : obstaclePolygons, initGridSize);
  // Record each sealed area's grid cells so its gate can re-open exactly those.
  for (const sealed of sealedAreas) {
    const b = polygonBounds(sealed.poly);
    const cells: number[] = [];
    const c0 = Math.max(0, Math.floor((b.minX - spaceGrid.originX) / spaceGrid.cellSize));
    const c1 = Math.min(spaceGrid.width - 1, Math.ceil((b.maxX - spaceGrid.originX) / spaceGrid.cellSize));
    const r0 = Math.max(0, Math.floor((b.minY - spaceGrid.originY) / spaceGrid.cellSize));
    const r1 = Math.min(spaceGrid.height - 1, Math.ceil((b.maxY - spaceGrid.originY) / spaceGrid.cellSize));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const idx = row * spaceGrid.width + col;
        if (spaceGrid.cells[idx] !== CellState.REMOVED) continue;
        const wx = spaceGrid.originX + col * spaceGrid.cellSize + spaceGrid.cellSize / 2;
        const wy = spaceGrid.originY + row * spaceGrid.cellSize + spaceGrid.cellSize / 2;
        if (pointInPolygon({ x: wx, y: wy }, sealed.poly)) cells.push(idx);
      }
    }
    sealed.destructible.sealedCells = cells;
  }
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
    // Movers can be broken by the black ball (Phase 2).
    destructibles.push({
      id: e.id,
      kind: 'mover',
      hits: 0,
      maxHits: 3,
      lastHitAt: 0,
      destroyed: false,
      moverId: mover.id,
    });
  }

  // ── Stack / support graph (issue #38) ────────────────────────────────────
  // "Down" is the board bottom. Each obstacle rests on the obstacle directly
  // beneath it (its bottom edge meets that one's top edge with x-overlap) or on
  // the ground. When a support is removed, whatever rests on it topples.
  const stackObjects: StackObject[] = [];
  {
    const SUPPORT_TOL = 30; // world units of slack for "resting on"
    const boxes = obstacleEntities.map(o => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of o.polygon.vertices) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      }
      return { id: o.id, minX, minY, maxX, maxY };
    });
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      let supporterId: string | null = null;
      const onGround = Math.abs(bottom - a.maxY) <= SUPPORT_TOL;
      if (!onGround) {
        let best = Infinity;
        for (let j = 0; j < boxes.length; j++) {
          if (i === j) continue;
          const b = boxes[j];
          const xOverlap = a.minX < b.maxX && a.maxX > b.minX;
          if (!xOverlap) continue;
          const gap = b.minY - a.maxY; // b sits just below a when this ≈ 0
          if (gap >= -SUPPORT_TOL && gap <= SUPPORT_TOL && Math.abs(gap) < best) {
            best = Math.abs(gap);
            supporterId = b.id;
          }
        }
      }
      stackObjects.push({
        id: a.id,
        polygon: obstacleEntities[i].polygon,
        breakable: obstacleEntities[i].breakable,
        supporterId,
        toppled: false,
      });
    }
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
    destructibles,
    stackObjects,
    objectivesTotal,
    initialSamplePoints: initSamplePoints,
    spaceGrid,
    gridRegions,
    regions,
    fastestBallId,
    bossActive,
    bossHp,
    bossMaxHp,
  };
}
