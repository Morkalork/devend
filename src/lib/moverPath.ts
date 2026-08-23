/**
 * Where a mover starts, where it gets to, and how long it takes.
 *
 * A mover is authored as a HOME position plus a `range`, and it patrols
 * `home +/- range/2` along its axis. That is a fine runtime shape and a poor
 * authoring one: the two places it actually reaches are the things that collide
 * with walls, and neither of them is a number in the file. Every mover in
 * map.yml was placed by doing this arithmetic in your head and then playtesting
 * to find out whether the far end had walked into something.
 *
 * These helpers turn the authored form into the two endpoints and the start,
 * so the builder can draw what a mover will actually do before it is run once.
 */
import type { LevelEntity, LevelMoverEntity, MoverCircleEntity, MoverRectEntity } from "@/types/level";
import type { Vector2 } from "@/lib/polygon";

/**
 * A new mover's travel and speed: the MEDIAN of the thirteen already on the
 * ladder, not the gentlest of them.
 *
 * The shipped spread is range 240..500 and speed 120..170, and it climbs with
 * the acts: level 4's debut pair patrol 280 at 130, level 29's at 340 and 170.
 * Seeding a new mover from the debut map would make every one you place feel
 * like an act-I set piece; the median puts it in the middle of the ladder so it
 * reads as an ordinary obstacle you then tune up or down.
 */
export const DEFAULT_MOVER_RANGE = 300;
export const DEFAULT_MOVER_SPEED = 150;

export function isMoverEntity(entity: LevelEntity): entity is LevelMoverEntity {
  return entity.kind === "mover";
}

/**
 * The centre a mover oscillates around.
 *
 * Rect movers are authored by their top-left like every other rect, but they
 * patrol around their CENTRE, which is a trap worth keeping in one place: read
 * `x` as the left edge when you draw and as the middle of the patrol when you
 * reason about the path, and the two disagree by half the width.
 */
export function moverHome(entity: LevelMoverEntity): Vector2 {
  if (entity.shape === "circle") {
    const c = entity as MoverCircleEntity;
    return { x: c.cx, y: c.cy };
  }
  const r = entity as MoverRectEntity;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The mover's centre once it has travelled `offset` from home. */
export function moverCenterAt(entity: LevelMoverEntity, offset: number): Vector2 {
  const home = moverHome(entity);
  return entity.axis === "horizontal"
    ? { x: home.x + offset, y: home.y }
    : { x: home.x, y: home.y + offset };
}

/**
 * The offset a mover begins at, from its `phase`.
 *
 * Matches initGame exactly: `phase * range - range / 2`, so 0 is the left/top
 * extreme, 0.5 the centre and 1 the right/bottom extreme. Anything else and the
 * builder would draw a start marker the game does not honour.
 */
export function moverStartOffset(entity: LevelMoverEntity): number {
  const phase = entity.phase ?? 0;
  return phase * entity.range - entity.range / 2;
}

/** Home, both extremes and the starting position, as centre points. */
export interface MoverPath {
  home: Vector2;
  /** The left or top extreme (offset -range/2), where phase 0 begins. */
  min: Vector2;
  /** The right or bottom extreme (offset +range/2). */
  max: Vector2;
  /** Where it actually is on the first frame, from `phase`. */
  start: Vector2;
}

export function moverPath(entity: LevelMoverEntity): MoverPath {
  const half = entity.range / 2;
  return {
    home: moverHome(entity),
    min: moverCenterAt(entity, -half),
    max: moverCenterAt(entity, half),
    start: moverCenterAt(entity, moverStartOffset(entity)),
  };
}

/**
 * Seconds for one end-to-end traverse.
 *
 * Plain `range / speed` despite the easing at the turns, and that is exact
 * rather than approximate: moverEase normalises its curve so a full traverse
 * takes precisely as long as the constant-speed one it replaced. Eleven shipped
 * maps time their necks against these patrols, which is why the curve is
 * allowed to change and the schedule is not.
 */
export function moverTraverseSeconds(entity: Pick<LevelMoverEntity, "range" | "speed">): number {
  if (!(entity.speed > 0)) return 0;
  return entity.range / entity.speed;
}

/**
 * The range implied by dragging an endpoint handle to `pointer`.
 *
 * The handle sits at one extreme, so its distance from home is half the range.
 * Doubling it keeps the patrol centred on the mover you placed, which is what
 * makes dragging one end feel like stretching a path rather than moving the
 * whole object.
 */
export function rangeFromHandle(
  home: Vector2, pointer: Vector2, axis: "horizontal" | "vertical",
): number {
  const reach = axis === "horizontal" ? Math.abs(pointer.x - home.x) : Math.abs(pointer.y - home.y);
  return Math.max(0, Math.round(reach * 2));
}

/**
 * Which axis a drag was mostly along.
 *
 * Lets the endpoint handle flip a mover from horizontal to vertical by simply
 * dragging it that way, instead of setting the axis in one panel and then
 * discovering in another that the path now runs through a wall.
 */
export function axisFromDelta(dx: number, dy: number): "horizontal" | "vertical" {
  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
}

/**
 * A mover's footprint at a given offset, as a rect in world units.
 *
 * Circles report their bounding box, which is all the builder needs to draw a
 * ghost and all a bounds check needs to know.
 */
export function moverFootprintAt(
  entity: LevelMoverEntity, offset: number,
): { x: number; y: number; width: number; height: number } {
  const c = moverCenterAt(entity, offset);
  if (entity.shape === "circle") {
    const r = (entity as MoverCircleEntity).radius;
    return { x: c.x - r, y: c.y - r, width: r * 2, height: r * 2 };
  }
  const re = entity as MoverRectEntity;
  return { x: c.x - re.width / 2, y: c.y - re.height / 2, width: re.width, height: re.height };
}

/**
 * Does the patrol leave the playable board at either end?
 *
 * The single most common way an authored mover goes wrong, and invisible until
 * you run the map: the home position sits comfortably inside the arena and the
 * far extreme is half a range past the wall.
 */
export function moverEscapesBoard(
  entity: LevelMoverEntity, boardSize: number, margin: number,
): boolean {
  const lo = margin, hi = boardSize - margin;
  const half = entity.range / 2;
  for (const offset of [-half, half]) {
    const f = moverFootprintAt(entity, offset);
    if (f.x < lo || f.y < lo || f.x + f.width > hi || f.y + f.height > hi) return true;
  }
  return false;
}
