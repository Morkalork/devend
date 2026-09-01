/**
 * createInitialGameData — pure factory for level initialisation geometry.
 *
 * Builds all stationary world data (board, obstacles, balls, space grid,
 * regions) from a level config and active modifiers.  No React, no DOM.
 *
 * Called by GameCanvas's initGame() which then applies side-effects
 * (canvas repaints, React state setters, etc.) that cannot live here.
 */

import { BendShapeFields, LevelConfig, LevelMoverEntity, MoverCircleEntity, MoverRectEntity, WallEntity } from "@/types/level";
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
import { bendOutline, bowOutline, hasAngle, hasBend, shapeOutline, turnOutline } from "@/lib/bend";
import { isEmptyRule, type ObstacleRule, type ObstacleRuleMap } from "@/lib/physics/obstacleRules";
import { INWARD_FROM_MOUTH, type DeliveryBoxState, type Mouth } from "@/lib/physics/deliveryBox";
import { type LauncherState } from "@/lib/physics/launcher";
import { muzzleVector, type LaunchFacing } from "@/lib/launcher";
import { rotateFenceZones } from "@/lib/mapRotation";
import type { FenceZone } from "@/lib/physics/fenceZones";
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
  BOX_WALL_THICKNESS,
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
  /** Pass rules for the obstacles above, keyed by polygon identity. */
  obstacleRules: ObstacleRuleMap;
  /** Delivery boxes: four walls with a membrane mouth, and what each wants. */
  deliveryBoxes: DeliveryBoxState[];
  launchers: LauncherState[];
  /** Fence-speed ground, already rotated into this deal's orientation. */
  fenceZones?: FenceZone[];
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
  // Keyed by polygon identity, not by index: updateBall walks a flat Polygon[]
  // and the phasing system already looks obstacles up this way. A parallel
  // array would be one careless insert from applying the wrong rule.
  const obstacleRules: ObstacleRuleMap = new Map();
  const deliveryBoxes: DeliveryBoxState[] = [];
  const launchers: LauncherState[] = [];
  // Collected in the entity pass and turned into sleeping balls after the
  // roster is built, the same two-stage shape the circuit's terminals use.
  const launcherSpecs: Array<{
    id: string; facing: LaunchFacing; angle?: number; ballType?: string;
    inner: { x: number; y: number; width: number; height: number };
  }> = [];
  const reservingBoxes: Array<{ id: string; poly: Polygon }> = [];
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
      if (entity.kind === "launcher") {
        // THREE walls, not four: the side named by `facing` is left open so the
        // balls can leave and so the empty shell is still worth fencing around
        // afterwards. Otherwise identical to a delivery box, deliberately - a
        // barrel and a box are the same construction with a different missing
        // side.
        const T = BOX_WALL_THICKNESS;
        const { x, y, width: w, height: h } = entity;
        const sides: Array<{ side: LaunchFacing; poly: Polygon }> = [
          { side: "up",    poly: createRectPolygon(x,         y,         x + w,     y + T) },
          { side: "down",  poly: createRectPolygon(x,         y + h - T, x + w,     y + h) },
          { side: "left",  poly: createRectPolygon(x,         y,         x + T,     y + h) },
          { side: "right", poly: createRectPolygon(x + w - T, y,         x + w,     y + h) },
        ];
        // The whole barrel turns as one piece, about the barrel's centre rather
        // than each wall's own centre - turnOutline pivots on the bounds it is
        // given, so rotating the sides individually would spin three small
        // rects in place and leave the cup in pieces.
        const cx = x + w / 2, cy = y + h / 2;
        const turn = hasAngle(entity.angle) ? (entity.angle! * Math.PI) / 180 : 0;
        const spin = (poly: Polygon): Polygon => {
          if (!turn) return poly;
          const cos = Math.cos(turn), sin = Math.sin(turn);
          return {
            ...poly,
            vertices: poly.vertices.map(v => {
              const dx = v.x - cx, dy = v.y - cy;
              return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
            }),
          };
        };
        for (const { side, poly } of sides) {
          if (side === entity.facing) continue; // the muzzle
          const turned = spin(poly);
          obstaclePolygons.push(turned);
          allWalls.push(...createWallsFromPolygon(turned, `launcher-${entity.id}-${side}`, false));
        }
        launcherSpecs.push({
          id: entity.id,
          facing: entity.facing,
          angle: entity.angle,
          ballType: entity.ballType,
          // Kept axis-aligned and un-turned on purpose: it is the barrel's own
          // frame, and every consumer (the ball stack, the band, the muzzle
          // vector) turns it by the same angle when it needs world coordinates.
          // Two independently-rotated copies of one rectangle is exactly how the
          // band would come to sit somewhere the balls are not.
          inner: { x: x + T, y: y + T, width: w - 2 * T, height: h - 2 * T },
        });
        continue;
      }
      if (entity.kind === "box") {
        // Four walls around the rect, one of them a membrane. Built here rather
        // than authored as four entities so a box is one thing a designer moves
        // and one thing a lint can check; the sides are ordinary walls, so
        // fences stop against them exactly as they would against anything else.
        const T = BOX_WALL_THICKNESS;
        const { x, y, width: w, height: h } = entity;
        const sides: Array<{ side: Mouth; poly: Polygon }> = [
          { side: "up",    poly: createRectPolygon(x,         y,         x + w,     y + T) },
          { side: "down",  poly: createRectPolygon(x,         y + h - T, x + w,     y + h) },
          { side: "left",  poly: createRectPolygon(x,         y,         x + T,     y + h) },
          { side: "right", poly: createRectPolygon(x + w - T, y,         x + w,     y + h) },
        ];
        for (const { side, poly } of sides) {
          obstaclePolygons.push(poly);
          const walls = createWallsFromPolygon(poly, `box-${entity.id}-${side}`, false);
          if (side === entity.mouth) {
            // The mouth admits balls travelling INTO the box: a lid on top is
            // crossed by a ball moving down.
            const rule: ObstacleRule = { oneWay: INWARD_FROM_MOUTH[entity.mouth] };
            obstacleRules.set(poly, rule);
            for (const wl of walls) wl.passRule = rule;
          }
          allWalls.push(...walls);
        }
        if (entity.reserves) reservingBoxes.push({ id: entity.id, poly: createRectPolygon(x + T, y + T, x + w - T, y + h - T) });
        deliveryBoxes.push({
          id: entity.id,
          inner: { x: x + T, y: y + T, width: w - 2 * T, height: h - 2 * T },
          mouth: entity.mouth,
          capacity: Math.max(1, Math.round(entity.capacity)),
          delivered: 0,
          reservedCells: [],
        });
        continue;
      }
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

        // Edge curves are indexed against the AUTHORED points, so they are
        // applied here, before decoration adds vertices of its own. The
        // whole-object bow waits until after (see below).
        const bendFields: BendShapeFields = entity;
        if (bendFields.curves?.some(c => !!c)) {
          basePolygon = { vertices: shapeOutline(basePolygon.vertices, bendFields.curves) };
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

        // The bow goes last: it subdivides the outline down to ~9 units, and
        // decoratePolygon skips any edge under 20, so bowing earlier would
        // leave every bent wall silently undecorated. Applied to mirrors too -
        // they skip variety, not geometry.
        if (bendFields.bend) {
          obstaclePolygon = {
            ...obstaclePolygon,
            vertices: bowOutline(obstaclePolygon.vertices, bendFields.bend, bendFields.bendAxis),
          };
        }
        // The turn goes after the bow: a bend runs along the shape's own long
        // axis, so bending then turning gives "a bent bar, turned". Turning
        // first would re-aim the bow every time the angle was nudged.
        if (hasAngle(bendFields.angle)) {
          obstaclePolygon = {
            ...obstaclePolygon,
            vertices: turnOutline(obstaclePolygon.vertices, bendFields.angle),
          };
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
        // One-way membranes and ball-type gates. Recorded only when they say
        // something, so an ordinary wall costs nothing and the map stays empty
        // of no-op entries.
        const rule: ObstacleRule = {
          ...(entity.oneWay ? { oneWay: entity.oneWay } : {}),
          ...(entity.passTypes?.length ? { passTypes: entity.passTypes } : {}),
        };
        const obstacleWalls = createWallsFromPolygon(obstaclePolygon, `obstacle-${entity.id}`, isMirror);
        if (!isEmptyRule(rule)) {
          obstacleRules.set(obstaclePolygon, rule);
          // The SAME object on both, so a future edit cannot update one path
          // and leave the other solid.
          for (const w of obstacleWalls) w.passRule = rule;
        }
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

  // A reserving box holds its interior off the board until it is satisfied, the
  // same way a sleeper's pocket is held until it is woken - so feeding the box
  // is how you get the space to clear, not an optional side quest that makes
  // the rest of the map easier.
  const sealedPolys = [...sealedAreas.map(s => s.poly), ...reservingBoxes.map(b => b.poly)];
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
  // The same for a reserving box, so satisfying it hands back exactly its own
  // interior and nothing else.
  for (const rb of reservingBoxes) {
    const box = deliveryBoxes.find(b => b.id === rb.id);
    if (!box) continue;
    const b = polygonBounds(rb.poly);
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
        if (pointInPolygon({ x: wx, y: wy }, rb.poly)) box.reservedCells.push(idx);
      }
    }
  }

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

  // Launcher barrels: the map's WHOLE roster loaded in, asleep.
  //
  // Not one ball in a cup with the rest already loose on the board. That made
  // the launch a curiosity happening in a corner of an otherwise ordinary map -
  // you pulled, one ball left, and the other two had been bouncing since the
  // first frame. Loading the roster is what makes the pull the map: nothing
  // moves at all until you fire, and then everything does.
  //
  // The balls already exist (they were spawned with the rest of the map above),
  // so they are MOVED into the barrel rather than created here. Creating extras
  // would leave the originals loose and quietly change the map's ball count,
  // which is the number every win condition and every payout is scaled against.
  //
  // Dormant for the same reason the circuit's sleepers are, and it is doing
  // more work here than it looks: a dormant ball anchors reachability, so the
  // region holding an unfired barrel cannot be captured. Without that a player
  // could fence the balls in before ever pulling the band and take the map
  // without making the wager.
  for (const spec of launcherSpecs) {
    // Bosses stay where they spawned: a boss map is about the boss arriving on
    // its own terms, and stuffing it down a barrel would let the player choose
    // its speed for the whole fight.
    const loaded = balls.filter(b => !b.isBoss && b.state !== "dormant");
    if (loaded.length === 0) continue;

    const dir = muzzleVector(spec.facing, spec.angle);
    const alongX = Math.abs(dir.x) > Math.abs(dir.y);
    const barrelLength = alongX ? spec.inner.width : spec.inner.height;
    const cx = spec.inner.x + spec.inner.width / 2;
    const cy = spec.inner.y + spec.inner.height / 2;

    // Stacked down the barrel, muzzle-end first, so a longer barrel visibly
    // holds more and the front ball is the one at the opening.
    //
    // The pad is a ball's radius plus the barrel's own wall: without it the
    // hindmost ball sits with its edge exactly on the inner face of the back
    // wall, which is cells the grid has already removed - "spawned in removed
    // space" in the init log, and a ball that starts life overlapping a solid.
    const endPad = ballRadius + BOX_WALL_THICKNESS;
    const usable = Math.max(0, barrelLength - 2 * endPad);
    const gap = loaded.length > 1 ? usable / (loaded.length - 1) : 0;
    loaded.forEach((ball, i) => {
      // +half the usable run is the muzzle end, so index 0 sits at the front.
      const offset = usable / 2 - i * gap;
      ball.position = { x: cx + dir.x * offset, y: cy + dir.y * offset };
      ball.state = "dormant";
      ball.speed = 0;
      ball.velocity = { x: 0, y: 0 };
    });

    launchers.push({
      id: spec.id,
      inner: spec.inner,
      facing: spec.facing,
      angle: spec.angle,
      ballIds: loaded.map(b => b.id),
      fired: false,
    });
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
    // A bent mover carries its arc as an offset-from-home outline, computed
    // once here. See MoverState.bentOutline for why it cannot be per-step.
    if (hasBend(e)) {
      const straight = buildMoverPolygon({ ...mover, offset: 0 }).vertices;
      const bent = bendOutline(straight, { bend: e.bend, bendAxis: e.bendAxis, curves: e.curves });
      mover.bentOutline = bent.map(v => ({ x: v.x - homeX, y: v.y - homeY }));
    }
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
    obstacleRules,
    deliveryBoxes,
    launchers,
    // Rotated here rather than at the consumer: a zone is a rect on the board
    // and has to turn with everything else on it.
    fenceZones: rotateFenceZones(level.fenceZones, mapRotation),
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
