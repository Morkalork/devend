/**
 * Colored Areas: typed var/let/const lock zones (MAP_DESIGN_GUIDELINES.md).
 *
 * Every area pays its kind's multiplier to a ball locked inside, easiest
 * (biggest, by convention) to hardest (smallest): var 1.5x < let 2x < const 3x.
 * What differs is the stakes, per `ColoredArea.required`:
 * - GATE (default): the map's SOLE win path. Lock a TARGET ball inside one (boss
 *   map: the boss ball; otherwise any ball) to win; locking the target OUTSIDE
 *   fails the map (lose a life, restart).
 * - BONUS (`required: false`): the greed hook. Pays the multiplier, gates
 *   nothing; the map is won the normal way whether or not it is used.
 *
 * Pure geometry + kind lookups; the win/fail decision lives in checkBallWonState
 * + evaluateWinConditions, and rendering in the two renderers.
 */
import type { AreaKind, ColoredArea } from "@/types/level";
import { gridIndexToWorld, worldToGridIndex, CellState, type SpaceGrid } from "@/lib/spaceGrid";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";

export interface AreaStyle {
  /** Centred label = the kind keyword. */
  label: string;
  /** Light fill/border colour (#rrggbb). */
  color: string;
  /** Lock-points multiplier for a ball locked inside. */
  multiplier: number;
}

export const AREA_KINDS: Record<AreaKind, AreaStyle> = {
  var:   { label: "var",   color: "#ff9ebf", multiplier: 1.5 }, // light pink
  let:   { label: "let",   color: "#ffbf80", multiplier: 2 },   // light orange
  const: { label: "const", color: "#7fe3d4", multiplier: 3 },   // light teal
};

export function areaStyle(kind: AreaKind): AreaStyle {
  return AREA_KINDS[kind] ?? AREA_KINDS.var;
}

/**
 * Starting size (square, world units) for a new area of each kind. Encodes the
 * authoring convention: var is the easiest kind so it's drawn biggest, const the
 * hardest so it's smallest.
 */
export const AREA_DEFAULT_SIZE: Record<AreaKind, number> = {
  var: 340,
  let: 260,
  const: 180,
};

/** Smallest area the editors allow: below this a ball can't be fenced in. */
export const AREA_MIN_SIZE = 100;

/**
 * A fresh area for the map editors: kind-sized, placed top-right (where the
 * level-10 boss area sits) and nudged per already-placed area so a second one
 * doesn't land exactly on the first.
 */
export function makeColoredArea(kind: AreaKind, existingCount = 0): ColoredArea {
  const size = AREA_DEFAULT_SIZE[kind];
  const offset = existingCount * 40;
  return {
    kind,
    x: Math.min(500 + offset, BOARD_WIDTH - size - 45),
    y: Math.min(45 + offset, BOARD_HEIGHT - size - 45),
    width: size,
    height: size,
  };
}

/**
 * True when an area gates the win (the default). A `required: false` area is a
 * bonus pocket: it pays, but it never decides the map.
 */
export function isGateArea(a: ColoredArea): boolean {
  return a.required !== false;
}

/** Only the areas that gate the win. Empty = the map is won the normal way. */
export function gateAreas(areas: ColoredArea[]): ColoredArea[] {
  return areas.filter(isGateArea);
}

/** True when a world point is inside the area rect (boundary counts). */
export function pointInArea(x: number, y: number, a: ColoredArea): boolean {
  return x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height;
}

/** The colored area containing a world point, or null. */
export function coloredAreaAt(x: number, y: number, areas: ColoredArea[]): ColoredArea | null {
  for (const a of areas) if (pointInArea(x, y, a)) return a;
  return null;
}

/**
 * True when EVERY cell of a region sits inside some colored area, i.e. the
 * region is fully sealed within the area(s). Early-exits on the first
 * out-of-area cell. An empty region/area set is not contained.
 * (Retained as a geometry utility; the win gate now uses regionCoversAreas.)
 */
export function regionWithinAreas(
  grid: SpaceGrid,
  cellIndices: number[],
  areas: ColoredArea[],
): boolean {
  if (areas.length === 0 || cellIndices.length === 0) return false;
  for (const idx of cellIndices) {
    const w = gridIndexToWorld(grid, idx);
    if (coloredAreaAt(w.x, w.y, areas) === null) return false;
  }
  return true;
}

/**
 * True when a locked region COVERS at least `minFraction` of the colored area's
 * cells (issue: colored-area win gate should be forgiving). The denominator is
 * the AREA, not the region: your pocket may spill outside the zone, it just has
 * to capture most of the zone. This is what settles the win gate + a fenced-in
 * boss, without the pocket having to fit entirely inside the area.
 *
 * Counts grid cells whose CENTRE lies inside an area rect as that area's cells;
 * of those, the fraction present in the region's cell set must be >= minFraction.
 */
export function regionCoversAreas(
  grid: SpaceGrid,
  cellIndices: number[],
  areas: ColoredArea[],
  minFraction: number,
): boolean {
  return regionCoverFraction(grid, cellIndices, areas) >= minFraction;
}

/**
 * The fraction of the given areas' cells that the region covers, 0 when there
 * is nothing to measure. Split out of regionCoversAreas so diagnostics can
 * report HOW CLOSE a lock came, which is the difference between "the rule is
 * too strict" and "that cut was nowhere near".
 */
export function regionCoverFraction(
  grid: SpaceGrid,
  cellIndices: number[],
  areas: ColoredArea[],
): number {
  if (areas.length === 0 || cellIndices.length === 0) return 0;
  const region = new Set(cellIndices);
  const cells = areaCellIndices(grid, areas);
  if (cells.length === 0) return 0;
  let covered = 0;
  for (const idx of cells) if (region.has(idx)) covered++;
  return covered / cells.length;
}

/**
 * Every grid cell whose CENTRE lies inside one of these areas.
 *
 * The single definition of "the cells of a zone", because two readers ask about
 * them and they must not disagree: the coverage fraction above grades whether a
 * lock counts, and the reachability test below decides whether a lock is still
 * possible at all. A map declared unwinnable against one set of cells while a
 * lock is graded against another is a map that ends for no visible reason.
 *
 * Overlapping areas contribute a shared cell twice. That is the behaviour the
 * coverage fraction has always had, and no shipped map overlaps two zones.
 */
export function areaCellIndices(grid: SpaceGrid, areas: ColoredArea[]): number[] {
  const out: number[] = [];
  const { originX, originY, cellSize, width, height } = grid;
  for (const a of areas) {
    const c0 = Math.max(0, Math.floor((a.x - originX) / cellSize));
    const c1 = Math.min(width - 1, Math.floor((a.x + a.width - originX) / cellSize));
    const r0 = Math.max(0, Math.floor((a.y - originY) / cellSize));
    const r1 = Math.min(height - 1, Math.floor((a.y + a.height - originY) / cellSize));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const wx = originX + col * cellSize + cellSize / 2;
        const wy = originY + row * cellSize + cellSize / 2;
        if (pointInArea(wx, wy, a)) out.push(row * width + col);
      }
    }
  }
  return out;
}

/**
 * The area a completed lock counts as being "in", or null.
 *
 * One rule for BOTH the payout and the zone lighting up, because a lock that
 * pays but does not light (or the reverse) is unreadable. It is also the same
 * forgiving test the win gate already uses, rather than a stricter one: a lock
 * good enough to WIN a gate map should certainly be good enough to pay.
 *
 * A single point is not enough on its own. The pocket you fence around a zone
 * routinely extends past it, which drags the settled position outside the rect
 * even though the zone is plainly captured - so covering the zone counts too,
 * and so does a small pocket sitting entirely inside it.
 *
 * Ties break toward the richer zone, matching coloredAreaMultiplierAt.
 */
export function areaForLock(
  grid: SpaceGrid,
  cellIndices: number[],
  ballX: number,
  ballY: number,
  areas: ColoredArea[],
  minFraction: number,
): ColoredArea | null {
  let best: ColoredArea | null = null;
  let bestMult = 0;
  for (const a of areas) {
    const one = [a];
    const qualifies =
      pointInArea(ballX, ballY, a)
      || regionWithinAreas(grid, cellIndices, one)
      || regionCoversAreas(grid, cellIndices, one, minFraction);
    if (!qualifies) continue;
    const m = areaStyle(a.kind).multiplier;
    if (m > bestMult) { bestMult = m; best = a; }
  }
  return best;
}

/** Lock-points multiplier at a world point: the max among containing areas, or 1. */
export function coloredAreaMultiplierAt(x: number, y: number, areas: ColoredArea[]): number {
  let m = 1;
  for (const a of areas) {
    if (pointInArea(x, y, a)) {
      const km = areaStyle(a.kind).multiplier;
      if (km > m) m = km;
    }
  }
  return m;
}

/**
 * Is there still a ball that could reach a gate zone, or has the map become
 * unwinnable?
 *
 * A gate-area map is lost the moment no target can ever land in the zone again
 * (see applyCut's areaUnreachable). "Could reach it" is any ball not already
 * locked away - and on a boss map, the boss specifically, since only the boss
 * satisfies the gate there.
 *
 * DORMANT and FROZEN balls count as live targets. A dormant ball is one that
 * has not entered play yet (a circuit sleeper waiting to be wired, a launcher's
 * roster waiting to be fired); a frozen ball is at rest and will thaw. An
 * earlier version tested `speed > 0`, which predates dormant balls and read a
 * ball at rest as a ball that was gone - so a gate map whose targets all
 * started dormant failed on its first frame.
 */
/**
 * The balls that could still satisfy a gate zone. One definition, two readers -
 * the reachability test below and the tests - so "target" cannot come to mean
 * different things in the same rule.
 */
export function gateTargets<T extends { state: string; isBoss?: boolean }>(
  balls: ReadonlyArray<T>,
): T[] {
  const hasBoss = balls.some(b => b.isBoss);
  return balls.filter(b => b.state !== "won" && (!hasBoss || b.isBoss));
}

/**
 * Can any target still REACH a gate zone, or has the board sealed it off?
 *
 * The roster above only says a target is ALIVE, and a live
 * ball is not the same as a ball that can get there. Reported from level 8: two
 * balls still bouncing, the var zone fenced away in ground they could no longer
 * enter, and the map running on until the clock ran out - so the reason
 * eventually given was the clock, which was true and useless.
 *
 * ── Why "shares a region with the zone" is the whole test ──────────────────
 *
 * A ball cannot cross into another region; that is the game. Cutting only ever
 * SPLITS the region it is in, so every region a ball can ever be in from now on
 * is a subset of the one it is in today. And every way a lock can count for a
 * zone - the ball settling inside it, the pocket sitting within it, the pocket
 * covering enough of it (see areaForLock) - requires the locked region to hold
 * at least one cell of that zone. So a target whose region holds no zone cell
 * can never satisfy the gate, and one whose region does might still.
 *
 * ── Every uncertainty resolves toward "keep playing" ───────────────────────
 *
 * This costs a life, so a false positive takes a map the player could still
 * have won. A zone with no ACTIVE cell left is claimed ground and is genuinely
 * gone; but active cells with no painted owner, or a ball standing on a cell
 * with none, mean the paint is not telling us - and not knowing is never a
 * reason to end someone's map.
 */
export function anyGateTargetCanReach(
  grid: SpaceGrid,
  balls: ReadonlyArray<{ state: string; isBoss?: boolean; position: { x: number; y: number } }>,
  areas: ColoredArea[],
): boolean {
  if (areas.length === 0) return true;          // no zone to be cut off from
  const targets = gateTargets(balls);
  if (targets.length === 0) return false;       // nothing alive to reach it

  // Which regions still own a piece of a zone. Read off the same painted
  // ownership the ball side reads below, so the two cannot disagree.
  const owners = new Set<string>();
  let activeZoneCells = 0;
  for (const idx of areaCellIndices(grid, areas)) {
    if (grid.cells[idx] !== CellState.ACTIVE) continue;
    activeZoneCells++;
    const rid = grid.cellRegionIds[idx];
    if (rid !== null) owners.add(rid);
  }
  // Claimed ground: nothing can be locked in there by anyone, ever.
  if (activeZoneCells === 0) return false;
  // Open ground the paint has no opinion about. Unknown, so: keep playing.
  if (owners.size === 0) return true;

  for (const b of targets) {
    const idx = worldToGridIndex(grid, b.position.x, b.position.y);
    const rid = idx >= 0 && grid.cells[idx] === CellState.ACTIVE
      ? grid.cellRegionIds[idx] : null;
    if (rid === null) return true;              // cannot place this one: keep playing
    if (owners.has(rid)) return true;
  }
  return false;
}
