/**
 * createInitialGameData — pure factory for level initialisation geometry.
 *
 * Builds all stationary world data (board, obstacles, balls, space grid,
 * regions) from a level config and active modifiers.  No React, no DOM.
 *
 * Called by GameCanvas's initGame() which then applies side-effects
 * (canvas repaints, React state setters, etc.) that cannot live here.
 */

import { LevelConfig, LevelMoverEntity, MoverCircleEntity, MoverRectEntity, WallEntity } from "@/types/level";
import { MoverState, buildMoverPolygon } from "@/lib/physics/moverState";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { Ball, Region, Vector2, DestructibleState, StackObject, ChainState, PhasingObjectState } from "@/types/game";
import { Polygon } from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";
import { SpaceGrid, GridRegion, resetGridRegionIds } from "@/lib/spaceGrid";
import {
  vec2Length,
  pointInPolygon,
  polygonBounds,
  polygonCentroid,
  createRectPolygon,
  createPolygonFromShape,
  pointToSegmentDistance,
  lineSegmentIntersection,
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
import { pickMapRotation, rotateEntities, rotateCircuit, rotateCharge, rotateDataStream, MapRotation } from "@/lib/mapRotation";
import type { CircuitRuntime, ChargeRuntime, DataStreamRuntime } from "@/types/gameState";
import { decoratePolygon } from "@/lib/obstacleDecorations";
import { weldRectToBoard, weldPolygonToBoard, pinnedSidesOf, type PinnedSides } from "@/lib/weldToBoard";
import { armTurnTimer, DEFAULT_TURN_INTERVAL } from "@/lib/physics/turnTimer";
import {
  getVarietyDecorationConfig,
  applyRectVariation,
  applyCircleVariation,
  applyPolygonVariation,
  resetRunSeed,
  setRunSeed,
} from "@/lib/varietySystem";
import { getRunSeedText, getRunRng, runStream, hashString } from "@/lib/runRng";
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
  resetMapIds,
} from "@/lib/gameUtils";
import { createBallEffectState } from "@/lib/ballEffects";
import { selectBallTypesForMap, getBallType, BallTypeDef, effectiveBallSpeedFactor } from "@/lib/ballTypes";
import { BIG_BALL_MIN_LEVEL, BIG_BALL_CHANCE, BIG_BALL_RADIUS_SCALE, BIG_BALL_LOCK_BONUS, CHAINED_MIN_LEVEL, CHAINED_CHANCE, canAnchorChain } from "@/lib/ballGifts";
import { makeChain } from "@/lib/physics/chain";

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
  const ball: Ball = {
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
    attractTurnRate: type.attractTurnRate,
    attractRadius: type.attractRadius,
  };
  // Compass: arm the first turn from the moment the ball enters the map, and
  // seed it per ball so two on one board never turn in lockstep, which would
  // read as one event rather than two independent hazards.
  if (type.ability === "turnTimer") {
    armTurnTimer(
      ball, spawnActiveSeconds,
      type.turnIntervalSeconds ?? DEFAULT_TURN_INTERVAL,
      getRunRng(`turnArm:${ball.id}`),
    );
  }
  return ball;
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
  /** Chains + phasing obstacles built for this map (issue #64). */
  chains: ChainState[];
  phasingObjects: PhasingObjectState[];
  /** Which of the four orientations this map was built in (0 = standard). */
  mapRotation: MapRotation;
  /** "Wire the Integration" circuit runtime, or null when the map has none. */
  circuit: CircuitRuntime | null;
  /** "Deploy Charge" fuses for this map (empty when none). */
  charges: ChargeRuntime[];
  /** "Data Stream" seam for this map, or null when none. */
  dataStream: DataStreamRuntime | null;
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createInitialGameData(
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
): InitialGameData {
  // A map's ids start from scratch, so the same seed deals the same names
  // whatever else the session has already played. See resetMapIds.
  resetMapIds();
  resetGridRegionIds();

  const margin = Math.min(BOARD_WIDTH, BOARD_HEIGHT) * ARENA_MARGIN;
  const arenaWidth  = BOARD_WIDTH  - margin * 2;
  const arenaHeight = BOARD_HEIGHT - margin * 2;

  // startingCapturePercent (Equity Grant cert) shrinks the playable arena and
  // counts the trimmed margin as already-captured: the run starts below 100%.
  const startingCapture = Math.max(0, Math.min(40, activeModifiers.startingCapturePercent));

  /**
   * Breaking Change: knock the reduction off an object's authored integrity.
   *
   * Applied here rather than by boosting impact damage, because the upgrade
   * promises FEWER HITS and this is the number that means that: the dent
   * rendering, the fatal-hit shatter and the "about three solid hits" feel all
   * key off it. Never below 1, so nothing becomes unbreakable-by-being-free.
   */
  const hitsReduction = Math.max(0, Math.round(activeModifiers.destructibleHitsReduction ?? 0));
  const integrity = (authored: number) => Math.max(1, Math.round(authored) - hitsReduction);
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
  // Phasing obstacles (#64): fade solid<->intangible on a cycle.
  const phasingObjects: PhasingObjectState[] = [];
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
  // Show the (square) board in one of four orientations. Rotate the concrete
  // authored + slot geometry before random shapes are placed, so everything
  // downstream (walls, obstacles, movers, spawns) lives in the rotated frame.
  // L1-3 stay standard. Pick once; pickup spots reuse `mapRotation` (below).
  const mapRotation: MapRotation = pickMapRotation(level.id, levelNumber);
  const authoredEntities = rotateEntities(
    [...(level.entities || []), ...slotEntities],
    mapRotation,
  );

  // "Wire the Integration" circuit (issue #73, rotated into the map's frame).
  // Each terminal boots a dormant ball; the balls + runtime are built below,
  // once the space grid exists (they reserve grid cells while asleep).
  const circuit = level.circuit ? rotateCircuit(level.circuit, mapRotation) : null;

  // "Deploy Charge" fuses (rotated into the map's frame). Each references its
  // target obstacle by id; no grid sealing needed (the target reopens its own
  // footprint through the breakable-destroy path when the charge detonates).
  const charges: ChargeRuntime[] = (level.charges ?? []).map(cfg => {
    const rc = rotateCharge(cfg, mapRotation);
    return {
      fuse: { x: rc.fuse.x, y: rc.fuse.y },
      radius: rc.radius,
      targetId: rc.targetId,
      blastRadius: rc.blastRadius ?? 220,
      delaySeconds: rc.delaySeconds ?? 1.2,
      armedAt: null,
      blown: false,
      announce: rc.announce,
    };
  });

  // "Data Stream" seam (rotated into the map's frame). One harvest flag per
  // seam segment; the mechanic (dataStream.ts) sets them as fences run along it.
  let dataStream: DataStreamRuntime | null = null;
  if (level.dataStream && level.dataStream.path.length >= 2) {
    const rs = rotateDataStream(level.dataStream, mapRotation);
    dataStream = {
      path: rs.path.map(p => ({ x: p.x, y: p.y })),
      width: rs.width,
      reward: { kind: rs.reward.kind, value: rs.reward.value },
      harvested: new Array(rs.path.length - 1).fill(false),
      freezeProgress: 0,
      announce: rs.announce,
    };
  }

  const randomObstacles = generateRandomObstacles(
    level.randomShapes ?? 20,
    authoredEntities, // random shapes avoid both fixed and slot-resolved entities
    // Ordinary balls need no avoidance: they are placed AFTER the obstacles, in
    // whatever open space is left. A circuit's sleepers are the exception and
    // the reason this is not an empty list - their positions are AUTHORED on the
    // map and fixed before anything random is rolled, so a decoration is free to
    // land on top of one. A sleeper inside a wall cannot be woken, and the space
    // it reserves cannot be cleared, which makes the map unwinnable with nothing
    // on screen to explain why.
    circuit?.terminals.map(t => ({ startX: t.ball.x, startY: t.ball.y })) ?? [],
    getRunRng(`obstacles:${level.id}`),
  );
  const allEntities = [...authoredEntities, ...randomObstacles];

  if (allEntities.length > 0) {
    let obstacleIndex = 0;
    for (const entity of allEntities) {
      if (entity.kind === "wall") {
        const isMirror = !!entity.mirror;
        let basePolygon: Polygon;
        // Which sides this obstacle was authored against, carried past the
        // decoration pass so it can be pulled back onto them.
        let pinned: PinnedSides | null = null;

        if (entity.shape === "rect") {
          if (isMirror) {
            basePolygon = createPolygonFromShape("rect", {
              x: entity.x, y: entity.y,
              width: entity.width, height: entity.height,
            });
          } else {
            const jittered = applyRectVariation(
              entity.x, entity.y, entity.width, entity.height,
              variety, level.id, entity.id,
            );
            // Variety jitters width and height around the CENTRE, so an edge
            // authored flush against the play boundary drifts off it and leaves
            // a sliver of board between the obstacle and the frame. Re-pin the
            // edges that were placed on the wall on purpose; the variation is
            // absorbed by the opposite side instead.
            const authoredRect = {
              x: entity.x, y: entity.y, width: entity.width, height: entity.height,
            };
            pinned = pinnedSidesOf(authoredRect, left, right);
            const varied = weldRectToBoard(authoredRect, jittered, left, right);
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
          // Decoration displaces the outline after the rect was welded, which
          // put a flush bar back off the wall by about three units. Pull the
          // authored-against sides home again.
          if (pinned) {
            obstaclePolygon = {
              ...obstaclePolygon,
              vertices: weldPolygonToBoard(obstaclePolygon.vertices, pinned, left, right),
            };
          }
        }
        obstacleIndex++;

        if (isMirror) {
          mirrorPolygons.push(obstaclePolygon);
          // Mirrors can be broken by the black ball (Phase 2).
          destructibles.push({
            id: entity.id,
            kind: 'mirror',
            hits: 0,
            maxHits: integrity(3),
            lastHitAt: 0,
            destroyed: false,
            mirrorPolygon: obstaclePolygon,
          });
        }
        obstaclePolygons.push(obstaclePolygon);
        const obstacleWalls = createWallsFromPolygon(obstaclePolygon, `obstacle-${entity.id}`, isMirror);
        allWalls.push(...obstacleWalls);

        // Phasing obstacle (#64): register it so the phasing tick can toggle its
        // collision + fire the phase-out shockwave. It stays a normal obstacle
        // (polygon + edge walls); the tick just skips it while phased out.
        if ((entity as WallEntity).isPhasing) {
          phasingObjects.push({
            id: entity.id,
            polygon: obstaclePolygon,
            wallIds: obstacleWalls.map(w => w.id),
            startedAt: 0,
            cycleSeconds: Math.max(2, (entity as WallEntity).phaseCycleSeconds ?? 10),
            phase: "in",
            alpha: 1,
          });
        }

        // Breakable obstacles + stack graph (issue #38). Mirrors are handled by
        // the #37 path above and don't participate in break-stacks.
        if (!isMirror) {
          // A treasure chest is a breakable too, even if `breakable` is omitted.
          const isBreakable = !!entity.breakable || !!entity.chest;
          obstacleEntities.push({ id: entity.id, polygon: obstaclePolygon, breakable: isBreakable });
          if (isBreakable) {
            const dest: DestructibleState = {
              id: entity.id,
              kind: 'breakable',
              hits: 0,
              maxHits: integrity(entity.hitsToBreak ?? 3),
              lastHitAt: 0,
              destroyed: false,
              obstaclePolygon,
              objective: !!entity.objective,
              fenceStyle: !!entity.fence,
              chest: !!entity.chest,
              chestRewards: entity.chestRewards,
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
      const spawnRoll = runStream("spawnPosition");
      const spreadFactor = Math.min(0.8, 0.3 + (attempt / 300) * 0.5);
      const pos = {
        // Seeded: WHERE the balls start is most of what makes one deal
        // different from another, so it is the first thing a shared seed has
        // to pin down.
        x: centroid.x + (spawnRoll() - 0.5) * rWidth  * spreadFactor,
        y: centroid.y + (spawnRoll() - 0.5) * rHeight * spreadFactor,
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
  /**
   * Load Balancer: the map's fastest ball TYPE, and only that one, is slowed.
   *
   * Picked by base speed rather than by whichever ball is quickest right now,
   * which would be a feedback loop - slow the leader, it stops being the
   * leader, it speeds back up, forever. Base speed belongs to the type, so the
   * target is settled the moment the map is dealt and stays settled.
   *
   * Ties go to the first, which is deterministic because selectBallTypesForMap
   * is. Two balls of the same type means the FIRST is the marked one; slowing
   * both would double an upgrade the card sells as singular.
   *
   * This is also why the line is gated behind Runtime Optimisation rather than
   * sold at level 1: level 1 spawns exactly one ball, so "the fastest" would be
   * "the only", and a 20% cut to it dwarfs Runtime Optimisation's flat 5%.
   * From level 2 there is a second ball and it becomes a real trade.
   */
  const slowPct = Math.max(0, activeModifiers.fastestBallSlowPercent ?? 0);
  let fastestIdx = -1;
  if (slowPct > 0 && selectedTypes.length > 0) {
    let best = -Infinity;
    selectedTypes.forEach((t, i) => {
      if (t.baseSpeed > best) { best = t.baseSpeed; fastestIdx = i; }
    });
  }
  /** The speed factor for ball `i`, with the Load Balancer cut if it is the one. */
  const scaleFor = (i: number): number => (
    i === fastestIdx
      // Floored the same way the global factor is: a stacked slow build must
      // not put a ball under half its normal speed (issue #42).
      ? effectiveBallSpeedFactor(activeModifiers.ballSpeedMultiplier * (1 - slowPct / 100), 1)
      : speedScale
  );

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

  // A chain must never be born already snagged on an object (#70). The rope
  // drapes over solid obstacles, so if the straight tether between the two
  // balls crosses (or ends inside) any obstacle at creation the pair spawns
  // permanently stuck. This returns true only when that segment is clear of
  // every obstacle (mirrors are in obstaclePolygons too, so they're covered).
  const chainSegmentClear = (a: Vector2, b: Vector2): boolean => {
    for (const obstacle of obstaclePolygons) {
      const v = obstacle.vertices;
      for (let i = 0; i < v.length; i++) {
        if (lineSegmentIntersection(a, b, v[i], v[(i + 1) % v.length])) return false;
      }
      if (pointInPolygon(a, obstacle) || pointInPolygon(b, obstacle)) return false;
    }
    return true;
  };

  const ballRadius = BASE_BALL_RADIUS * activeModifiers.ballSizeMultiplier;
  // Big-ball gift (#64): from L11 each ball has a 5% chance to spawn enlarged
  // (~1.3x, harder to fence, worth a touch more on lock). Seeded per map so
  // Daily runs share it. Rolled BEFORE placement so the spacing uses its radius.
  const enlargeRng = getRunRng(`enlarge:${level.id}`);
  const balls: Ball[] = selectedTypes.map((type, i) => {
    const enlarged = levelNumber >= BIG_BALL_MIN_LEVEL && enlargeRng() < BIG_BALL_CHANCE;
    const r = enlarged ? ballRadius * BIG_BALL_RADIUS_SCALE : ballRadius;
    const ball = createBall(type, findSpacedSpawn(r), scaleFor(i), r, `${type.id}-${i}`, spawnTime, 0);
    if (enlarged) {
      ball.enlarged = true;
      ball.lockMultiplier = ball.lockMultiplier + BIG_BALL_LOCK_BONUS;
    }
    return ball;
  });

  // Chains built this map (#64): the boss pair's fence-breaking chain (below)
  // and the yellow/purple gift chains (further down) both land here.
  const chains: ChainState[] = [];

  // Boss ball (issue #56, extended #64): a distinct big/fast antagonist. `count`
  // 2 spawns an interlinked PAIR (L20/L35); each must be trapped hp times to
  // defeat. It must be defeated (fenced into the area) to clear a boss map.
  let bossActive = false, bossHp = 0, bossMaxHp = 0;
  const bossBall = level.boss?.bossBall;
  if (bossBall) {
    const baseType = getBallType("red") ?? selectedTypes[0];
    if (baseType) {
      const hp = Math.max(1, Math.round(bossBall.hp ?? 3));
      const bossRadius = ballRadius * (bossBall.radiusScale ?? 2);
      const count = Math.max(1, Math.round(bossBall.count ?? 1));
      // Pre-pick spawn spots. For a chained pair, re-roll the second boss until
      // the straight tether to the first is clear of every obstacle (#70), so
      // the pair is never born already snagged on a pillar/mirror.
      const bossPositions: Vector2[] = [];
      for (let bi = 0; bi < count; bi++) bossPositions.push(findSpacedSpawn(bossRadius));
      if (bossBall.chained && count >= 2) {
        for (let attempt = 0; attempt < 30 && !chainSegmentClear(bossPositions[0], bossPositions[1]); attempt++) {
          bossPositions[1] = findSpacedSpawn(bossRadius);
        }
      }
      const bosses: Ball[] = [];
      for (let bi = 0; bi < count; bi++) {
        const boss = createBall(
          baseType, bossPositions[bi], speedScale * (bossBall.speedScale ?? 1.2),
          bossRadius, count > 1 ? `boss-rc-${bi}` : "boss-rc", spawnTime, 0,
        );
        boss.isBoss = true;
        boss.bossHp = hp;
        boss.bossMaxHp = hp;
        boss.bossFullRadius = bossRadius; // shrinks toward a normal ball as HP drains
        boss.bossMinRadius = ballRadius;  // last-life size = an ordinary ball
        boss.color = bossBall.color ?? "#ff2d55";
        balls.push(boss);
        bosses.push(boss);
      }
      // Interlinked pair: one fence-breaking chain between the two boss balls.
      if (bossBall.chained && bosses.length >= 2) {
        chains.push(makeChain(bosses[0], bosses[1], true));
      }
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

  // Chained-ball gift (#64): from L21, each yellow/purple ball has a 5% chance
  // to be chained to another (any-colour) ball on the map. Ordinary chains only
  // tether + snag (they never break fences). Seeded per map, boss balls excluded.
  if (levelNumber >= CHAINED_MIN_LEVEL) {
    const chainRng = getRunRng(`chain:${level.id}`);
    const pool = balls.filter(b => !b.isBoss);
    const used = new Set<string>();
    for (const anchor of pool) {
      if (used.has(anchor.id) || !canAnchorChain(anchor.ability)) continue;
      if (chainRng() >= CHAINED_CHANCE) continue;
      // Only pair with a partner whose straight tether to the anchor is clear of
      // obstacles (#70): a chain born crossing a mirror/pillar snags forever.
      const partner = pool.find(
        b => b.id !== anchor.id && !used.has(b.id) && chainSegmentClear(anchor.position, b.position),
      );
      if (!partner) continue;
      used.add(anchor.id); used.add(partner.id);
      chains.push(makeChain(anchor, partner, false));
    }
  }

  // ── Space grid & initial region ───────────────────────────────────────

  const initGridSize = 15;
  const initBounds   = polygonBounds(boardPolygon);
  const initSamplePoints: Vector2[] = [];

  const sealedPolys = [...sealedAreas.map(s => s.poly)];
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

  // Circuit dormant balls (#73): spawn one asleep per terminal at its authored
  // spot. A dormant ball anchors reachability (captureUnreachableCells), so it
  // HOLDS its region uncapturable until the player wires the terminal to boot it
  // (then traps it like a normal ball). No vault - the payoff IS the ball, and a
  // map can be entirely dormant (no live ball at start).
  let circuitRuntime: CircuitRuntime | null = null;
  if (circuit && circuit.terminals.length > 0) {
    const redType = getBallType("red");
    const terminals = circuit.terminals.map((t, i) => {
      const cfg = t.ball;
      const type = (cfg.typeId ? getBallType(cfg.typeId) : undefined) ?? selectedTypes[0] ?? redType!;
      const id = `dormant-${i}`;
      const ball = createBall(type, { x: cfg.x, y: cfg.y }, speedScale, ballRadius, id, spawnTime, 0);
      ball.state = "dormant";
      ball.speed = 0;
      ball.velocity = { x: 0, y: 0 };
      balls.push(ball);
      return { x: t.x, y: t.y, radius: circuit.radius, lit: false, ballId: id };
    });
    circuitRuntime = { terminals, announce: circuit.announce };
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
      maxHits: integrity(3),
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
    chains,
    phasingObjects,
    mapRotation,
    circuit: circuitRuntime,
    charges,
    dataStream,
  };
}
