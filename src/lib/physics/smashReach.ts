/**
 * You cannot bury something you still have to break.
 *
 * A breakable is smashed by driving a BALL into it, so it needs two things to
 * stay possible: an un-smashed slab, and open ground beside it for a ball to
 * come from. Fencing that ground away takes the second one, and nothing on the
 * board says so - the slab is still drawn, still yellow, still pulsing as a win
 * target, and it can no longer be hit by anything. The map is over and keeps
 * running.
 *
 * That is the worst failure shape this game has: not a loss, a silence. The
 * clock eventually runs out and the reason given is the clock, which is true
 * and useless.
 *
 * Two rules come out of it, and they are deliberately different:
 *
 *   WITH A BALL INSIDE   the seal is REFUSED as a lock. The pocket stays open
 *                        and the ball keeps bouncing, so the slab is still
 *                        yours to break. Costs nothing; you simply do not get
 *                        paid for a pocket you were not allowed to close.
 *   WITH NO BALL INSIDE  there is no ball to refuse for and the ground is
 *                        already claimed. The map is unwinnable from that
 *                        instant, so it is failed at that instant.
 *
 * The precedent for the first is the portal rule in checkBallWonState: "a
 * pocket with a portal in it is not a pocket", for the same reason - sealing
 * it does not mean what sealing normally means.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";
import type { SpaceGrid } from "@/lib/spaceGrid";
import { CellState, rasterizeCutToGrid, captureUnreachableCells } from "@/lib/spaceGrid";
import type { Vector2 } from "@/lib/polygon";
import type { WinSpec } from "@/types/winSpec";

/**
 * How far outside a slab a ball's CENTRE can sit and still be able to hit it.
 *
 * A ball strikes with its rim, so its centre is a radius away at the moment of
 * contact, and the cell it occupies has to be open. Two extra cells of slack on
 * top: the grid is 15-unit cells against an 18-unit radius, so a ring measured
 * exactly at the radius can fall between cells and report a slab unreachable
 * with a whole lane still open beside it. Erring wide is the safe direction -
 * it fails to fire when it should rather than firing when it should not, and
 * this rule ends maps.
 */
const STRIKE_MARGIN_CELLS = 2;

/** Bounding box of a destructible, or null if it has no polygon to measure. */
function boundsOf(d: DestructibleState): { x0: number; y0: number; x1: number; y1: number } | null {
  const verts = d.obstaclePolygon?.vertices;
  if (!verts || verts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of verts) {
    if (v.x < x0) x0 = v.x;
    if (v.y < y0) y0 = v.y;
    if (v.x > x1) x1 = v.x;
    if (v.y > y1) y1 = v.y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Grid cells a ball could occupy while still able to strike `d`.
 *
 * The box around the slab, grown by a ball radius plus the margin above. Cells
 * INSIDE the slab are included and harmless: they are REMOVED (that is what an
 * obstacle is on this grid), so they never count as open ground below.
 */
export function strikeCells(
  grid: SpaceGrid, d: DestructibleState, ballRadius: number,
): number[] {
  const b = boundsOf(d);
  if (!b) return [];
  const reach = ballRadius + grid.cellSize * STRIKE_MARGIN_CELLS;
  const c0 = Math.max(0, Math.floor((b.x0 - reach - grid.originX) / grid.cellSize));
  const c1 = Math.min(grid.width - 1, Math.ceil((b.x1 + reach - grid.originX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((b.y0 - reach - grid.originY) / grid.cellSize));
  const r1 = Math.min(grid.height - 1, Math.ceil((b.y1 + reach - grid.originY) / grid.cellSize));
  const out: number[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) out.push(row * grid.width + col);
  }
  return out;
}

/** Smallest radius among the balls still in play; the game's default when none. */
function strikingRadius(game: CanvasGameState): number {
  const live = game.balls.filter(b => b.state !== "won");
  if (live.length === 0) return 18;
  return Math.min(...live.map(b => b.radius));
}

/**
 * Can a ball still get to this slab?
 *
 * True when any cell in its strike ring is still ACTIVE. That reads as a
 * geometric test and is really a reachability one: captureUnreachableCells has
 * already taken every ACTIVE cell no ball can reach, so a cell left ACTIVE
 * after it runs is, by that function's own contract, somewhere a ball can be.
 * Reusing that beats a second flood fill which could disagree with it.
 */
export function canStillStrike(
  game: CanvasGameState, d: DestructibleState,
): boolean {
  const grid = game.spaceGrid;
  if (!grid) return true;
  if (d.destroyed) return false;
  // A slab with no polygon cannot be located, and UNKNOWN IS NOT LOST. Reading
  // "I cannot measure this" as "nothing can reach it" points the error the
  // dangerous way: this rule ends maps, so a slab it cannot see has to be
  // assumed fine. Caught by a fixture whose destructible carried no polygon,
  // which failed a map that was still perfectly playable.
  if (!boundsOf(d)) return true;
  const radius = strikingRadius(game);
  for (const i of strikeCells(grid, d, radius)) {
    if (grid.cells[i] === CellState.ACTIVE) return true;
  }
  return false;
}

/** Breakables only. Mirrors and movers are destructible scenery, not a job. */
function breakables(game: CanvasGameState): DestructibleState[] {
  return (game.destructibles ?? []).filter(d => d.kind === "breakable");
}

/** How many smashes this map's win asks for; 0 when it asks for none. */
export function requiredSmashes(spec: WinSpec): number {
  let n = 0;
  for (const c of spec.require) if (c.kind === "smashed") n = Math.max(n, c.count);
  return n;
}

/**
 * Is the smash requirement still satisfiable?
 *
 * Counts what is already broken plus what can still be reached. A map with four
 * slabs and a `smashed 1` clause can lose three of them and be perfectly fine,
 * so the test is against the REQUIREMENT rather than against any single slab -
 * failing a map for burying a slab it did not need would be its own bug.
 */
export function smashesStillPossible(game: CanvasGameState): number {
  let n = 0;
  for (const d of breakables(game)) {
    if (d.destroyed || canStillStrike(game, d)) n++;
  }
  return n;
}

/**
 * The map can no longer meet its smash clause: everything reachable has been
 * broken or walled off, and the count still falls short.
 */
export function smashRequirementLost(game: CanvasGameState, spec: WinSpec): boolean {
  const need = requiredSmashes(spec);
  if (need === 0) return false;
  // A map with a smash clause and NO breakables on it was unwinnable before the
  // player touched it. That is an authoring fault - winSpecProblems refuses a
  // count above the breakable count, and the builder shows the flag - and
  // failing the player for it would report their cut as the cause of a map that
  // never had a chance. Nothing here can be "lost" if there was nothing to lose.
  if (breakables(game).length === 0) return false;
  return smashesStillPossible(game) < need;
}

/**
 * Does this pocket hold a slab the map still needs broken?
 *
 * Asked of a region a ball is about to be locked into. "Still needs" is the
 * whole condition: once the clause is satisfied the slabs stop being objectives
 * and sealing a pocket around one is an ordinary lock again. Refusing forever
 * would take a legitimate pocket away from the player on every breakable map
 * for no benefit.
 *
 * Deliberately per-SLAB rather than per-requirement. A pocket around any
 * unbroken slab is refused while smashes are outstanding, even on a map with
 * slack, because the alternative is telling the player "this seal is allowed,
 * that identical one is not" on a distinction they cannot see.
 */
export function regionHoldsNeededSlab(
  game: CanvasGameState, spec: WinSpec, cellIndices: number[],
): boolean {
  const grid = game.spaceGrid;
  const need = requiredSmashes(spec);
  if (!grid || need === 0) return false;
  const done = breakables(game).filter(d => d.destroyed).length;
  if (done >= need) return false;

  const cells = new Set(cellIndices);
  const radius = strikingRadius(game);
  for (const d of breakables(game)) {
    if (d.destroyed) continue;
    for (const i of strikeCells(grid, d, radius)) {
      if (cells.has(i)) return true;
    }
  }
  return false;
}

/**
 * Would this cut, if it landed, leave the map unable to meet its smash clause?
 *
 * The third rule, and the one the other two left a hole for. Sealing a pocket
 * WITH a ball in it is refused as a lock; sealing one with no ball in it fails
 * the map. That second case is correct when the clause asks for one slab out of
 * many - you have to go out of your way to bury the only one that counts - and
 * it turns vicious the moment the clause asks for HALF of them, because then an
 * ordinary early cut across a run of bricks can put the map beyond reach on the
 * second fence, at 88% of the board still live, with nothing having gone wrong
 * that the player could see.
 *
 * Measured, on the eight-seed sweep, when act I's counts went to half: level 6
 * fell from 7 wins to 3, level 7 from 7 to 4, level 13 from 8 to 3, and every
 * single loss was objectiveBuried. The counts were not the problem - a map that
 * asks you to break six of twelve bricks is a fine map - the problem was that
 * getting the ORDER wrong cost a life instead of a cut.
 *
 * So the cut is refused instead, exactly as a ball-orphaning cut already is
 * (applyCut's "reject walls that would orphan a ball"): the fence does not
 * land, nothing is spent, and the board is unchanged. The player tries
 * somewhere else, which is the correct lesson and a free one.
 *
 * ── The prediction ─────────────────────────────────────────────────────────
 *
 * Simulated on a COPY of the grid rather than reasoned about: rasterise the
 * candidate segments, run the same capture the real cut would run, and count
 * what could still be struck afterwards. The alternative - working out which
 * slabs a line would orphan by geometry - is a second implementation of
 * reachability that would be free to disagree with the first, and this rule is
 * only as trustworthy as its agreement with what actually happens.
 *
 * A map whose clause is ALREADY beyond reach refuses nothing. That state
 * belongs to smashRequirementLost, which ends the map and says why; refusing
 * every subsequent cut instead would leave the player fencing at a board that
 * silently declines to change.
 */
export function cutWouldBurySmashes(
  game: CanvasGameState,
  spec: WinSpec,
  segments: ReadonlyArray<{ start: Vector2; end: Vector2 }>,
  thickness: number,
): boolean {
  const need = requiredSmashes(spec);
  if (need === 0) return false;
  const grid = game.spaceGrid;
  if (!grid || segments.length === 0) return false;
  if (breakables(game).length === 0) return false;
  // Already lost: not this cut's doing, and not this rule's to report.
  if (smashesStillPossible(game) < need) return false;

  const after: SpaceGrid = {
    ...grid,
    cells: Uint8Array.from(grid.cells),
    cellRegionIds: [...grid.cellRegionIds],
  };
  for (const seg of segments) {
    rasterizeCutToGrid(after, seg.start, seg.end, thickness);
  }
  captureUnreachableCells(after, game.balls, [...game.walls, ...segments]);

  const probe = { ...game, spaceGrid: after } as CanvasGameState;
  let possible = 0;
  for (const d of breakables(game)) {
    if (d.destroyed || canStillStrike(probe, d)) possible++;
  }
  return possible < need;
}
