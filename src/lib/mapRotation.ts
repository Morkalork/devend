/**
 * mapRotation — show an authored map in one of four orientations.
 *
 * A designer builds every map in the standard orientation; at load time we pick
 * one of four rigid rotations (0°, 90° left, 180°, 90° right) and transform all
 * of the map's geometry into it. Because the board is SQUARE (BOARD_WIDTH ===
 * BOARD_HEIGHT), every rotation maps the board exactly onto itself, and a
 * rotation is an isometry — so areas, the win threshold, lock pockets, and
 * scoring are all preserved. The map is identical, just turned: "slightly
 * different every run, completely recognizable."
 *
 * The rotation is sourced from the run RNG (getRunRng), so normal runs vary per
 * run while a Daily Stand-up seed gives every player the same orientation.
 *
 * All map coordinates live in one world space, so this is applied once at load
 * (initGame rotates the concrete entity list; pickup spots use the same value)
 * and the rest of the engine never needs to know.
 */

import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { getRunRng } from "@/lib/runRng";
import type { LevelEntity, LockZone, ColoredArea, CircuitConfig, ChargeConfig, DataStreamConfig } from "@/types/level";

/** 0 = standard, 1 = turned left (CCW 90°), 2 = upside down, 3 = turned right (CW 90°). */
export type MapRotation = 0 | 1 | 2 | 3;

/** Levels below this always render in the standard orientation (tutorial band). */
export const ROTATION_MIN_LEVEL = 4;

// The board is square, so a single size drives both axes. (A non-square board
// would make 90° rotations swap width/height and not fit — this relies on it.)
const SIZE = BOARD_WIDTH;

/** Rotate a world point about the board centre. Square board: SIZE on both axes. */
export function rotatePoint(x: number, y: number, r: MapRotation): { x: number; y: number } {
  switch (r) {
    case 1: return { x: y,          y: SIZE - x }; // turned left  (CCW 90°)
    case 2: return { x: SIZE - x,   y: SIZE - y }; // upside down  (180°)
    case 3: return { x: SIZE - y,   y: x        }; // turned right (CW 90°)
    default: return { x, y };
  }
}

/** Rotate an axis-aligned rect; its four corners map to a new axis-aligned rect. */
function rotateRect(
  x: number, y: number, width: number, height: number, r: MapRotation,
): { x: number; y: number; width: number; height: number } {
  const corners = [
    rotatePoint(x, y, r),
    rotatePoint(x + width, y, r),
    rotatePoint(x + width, y + height, r),
    rotatePoint(x, y + height, r),
  ];
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const nx = Math.min(...xs);
  const ny = Math.min(...ys);
  return { x: nx, y: ny, width: Math.max(...xs) - nx, height: Math.max(...ys) - ny };
}

// A horizontal mover swings along ±x (phase 0 = left extreme, 1 = right); a
// vertical one along ±y (phase 0 = top, 1 = bottom). Under a 90° turn the axis
// swaps and, depending on the turn, the travel direction reverses — so the
// starting phase must flip to keep the motion consistent with the layout.
function rotateMoverAxisPhase(
  axis: "horizontal" | "vertical", phase: number | undefined, r: MapRotation,
): { axis: "horizontal" | "vertical"; phase: number | undefined } {
  const flip = (p: number | undefined) => (p === undefined ? undefined : 1 - p);
  switch (r) {
    case 1: // CCW: horizontal→vertical (reversed), vertical→horizontal
      return axis === "horizontal"
        ? { axis: "vertical", phase: flip(phase) }
        : { axis: "horizontal", phase };
    case 2: // 180°: axis unchanged, direction reversed
      return { axis, phase: flip(phase) };
    case 3: // CW: horizontal→vertical, vertical→horizontal (reversed)
      return axis === "horizontal"
        ? { axis: "vertical", phase }
        : { axis: "horizontal", phase: flip(phase) };
    default:
      return { axis, phase };
  }
}

/** Rotate one level entity (walls, movers) into the target orientation. */
export function rotateEntity(entity: LevelEntity, r: MapRotation): LevelEntity {
  if (r === 0) return entity;

  // Reveals rect (a sealed area a breakable gates) travels with its owner.
  const reveals = entity.kind === "wall" && entity.reveals
    ? rotateRect(entity.reveals.x, entity.reveals.y, entity.reveals.width, entity.reveals.height, r)
    : undefined;

  if (entity.kind === "mover") {
    const { axis, phase } = rotateMoverAxisPhase(entity.axis, entity.phase, r);
    if (entity.shape === "circle") {
      const c = rotatePoint(entity.cx, entity.cy, r);
      return { ...entity, cx: c.x, cy: c.y, axis, phase };
    }
    const rect = rotateRect(entity.x, entity.y, entity.width, entity.height, r);
    return { ...entity, ...rect, axis, phase };
  }

  // Wall entity: rotate whichever shape it carries.
  if (entity.shape === "circle") {
    const c = rotatePoint(entity.cx, entity.cy, r);
    return { ...entity, cx: c.x, cy: c.y, ...(reveals ? { reveals } : {}) };
  }
  if (entity.shape === "polygon") {
    const points = entity.points.map(([px, py]) => {
      const p = rotatePoint(px, py, r);
      return [p.x, p.y] as [number, number];
    });
    return { ...entity, points, ...(reveals ? { reveals } : {}) };
  }
  const rect = rotateRect(entity.x, entity.y, entity.width, entity.height, r);
  return { ...entity, ...rect, ...(reveals ? { reveals } : {}) };
}

/** Rotate a whole entity list (no-op at r === 0). */
export function rotateEntities(entities: LevelEntity[], r: MapRotation): LevelEntity[] {
  return r === 0 ? entities : entities.map(e => rotateEntity(e, r));
}

/** Rotate a bonus-lock zone (a rect + its multiplier) into the target orientation. */
export function rotateLockZone(zone: LockZone, r: MapRotation): LockZone {
  if (r === 0) return zone;
  const rect = rotateRect(zone.x, zone.y, zone.width, zone.height, r);
  return { ...rect, multiplier: zone.multiplier };
}

/** Rotate a Colored Area (a rect + its kind) into the target orientation. */
export function rotateColoredArea(area: ColoredArea, r: MapRotation): ColoredArea {
  if (r === 0) return area;
  const rect = rotateRect(area.x, area.y, area.width, area.height, r);
  return { ...rect, kind: area.kind };
}

/** Rotate a circuit (its terminal points + the reveal rect) into the orientation. */
export function rotateCircuit(circuit: CircuitConfig, r: MapRotation): CircuitConfig {
  if (r === 0) return circuit;
  return {
    ...circuit,
    terminals: circuit.terminals.map(t => rotatePoint(t.x, t.y, r)),
    reveals: rotateRect(circuit.reveals.x, circuit.reveals.y, circuit.reveals.width, circuit.reveals.height, r),
  };
}

/** Rotate a Deploy Charge (its fuse point) into the target orientation. The
 *  target obstacle is referenced by id, so it rotates via its own entity. */
export function rotateCharge(charge: ChargeConfig, r: MapRotation): ChargeConfig {
  if (r === 0) return charge;
  return { ...charge, fuse: rotatePoint(charge.fuse.x, charge.fuse.y, r) };
}

/** Rotate a Data Stream (its seam polyline) into the target orientation. */
export function rotateDataStream(ds: DataStreamConfig, r: MapRotation): DataStreamConfig {
  if (r === 0) return ds;
  return { ...ds, path: ds.path.map(p => rotatePoint(p.x, p.y, r)) };
}

/**
 * Pick this map's orientation. Deterministic under a run seed (Daily Stand-up
 * shares it) and random otherwise; the tutorial band (L1-3) stays standard.
 * Call ONCE per level init and reuse the result for every consumer.
 */
export function pickMapRotation(levelId: string, levelNumber: number): MapRotation {
  if (levelNumber < ROTATION_MIN_LEVEL) return 0;
  const roll = getRunRng(`rotation:${levelId}`)();
  return (Math.min(3, Math.floor(roll * 4)) % 4) as MapRotation;
}

// Reference the height so a future non-square board trips the type checker here
// rather than silently mis-rotating (this module assumes BOARD_WIDTH === BOARD_HEIGHT).
if (BOARD_WIDTH !== BOARD_HEIGHT) {
  console.error("[mapRotation] board is not square; 90° rotations will not fit.");
}
