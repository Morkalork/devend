/**
 * You cannot fence off the zone you still have to lock a ball in.
 *
 * The gate-area sibling of smashReach.cutWouldBurySmashes, and it exists for
 * the same reason. A cut that seals a gate zone with no ball inside claims that
 * ground, nothing can ever be locked there again, and the map is over. That
 * used to be charged as a lost life on the spot (applyCut's areaUnreachable),
 * while the same mistake against a slab the win needed was refused as a cut
 * with a line of text. Two answers to one mistake, and the harsher one fell on
 * the map that introduces the zone: level 3, where a player is learning what
 * the box is for, lost a life for fencing it the wrong way round.
 *
 * So the cut is refused instead: the fence does not land, nothing is spent,
 * and the board is unchanged. The failure in applyCut stays as the backstop for
 * the ways a zone is lost that no single cut decides (a boss map whose zone is
 * reachable only by minions, say), where there is no fence to refuse.
 *
 * ── The prediction ─────────────────────────────────────────────────────────
 *
 * Simulated on a COPY of the grid, exactly as the smash rule does it, rather
 * than reasoned about: rasterise the candidate segments, run the capture the
 * real cut would run, and ask whether any cell of a gate zone is still open.
 * captureUnreachableCells removes every region no ball is in, so an open zone
 * cell afterwards is, by that function's own contract, ground a ball can still
 * reach - including the pocket the cut just closed, when a ball is inside it,
 * which is the lock the map is asking for and must never be refused.
 *
 * "Open" is not quite enough, and the second half of the check is the case
 * that measured larger. A cut can leave the zone's last live ball in a pocket
 * that still holds a sliver of the zone and is small enough to LOCK - and a
 * lock there does not count for the zone unless the ball sits in it or the
 * pocket covers most of it (checkBallWonState's area rule). So the zone is
 * reachable after the cut only if some region holding a piece of it and a live
 * target either stays too big to lock, or would lock AS the zone. Measured on
 * level 3 with the zone in its win, eight seeds: that locked-just-outside case
 * was every areaUnreachable loss left once sealing it empty was refused.
 *
 * Every uncertainty resolves toward letting the cut land. A zone still behind
 * an unbroken reveal is judged with its door opened on the prediction. A zone
 * already gone before this cut is not this cut's doing.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { WinSnapshot, WinSpec } from "@/types/winSpec";
import type { Vector2 } from "@/lib/polygon";
import {
  CellState, rasterizeCutToGrid, captureUnreachableCells, findGridRegions,
  countActiveCells, worldToGridIndex, exportGridRegionIdCounter,
  importGridRegionIdCounter, type SpaceGrid,
} from "@/lib/spaceGrid";
import {
  areaCellIndices, gateAreas, gateTargets, sealedPendingCells, coloredAreaAt,
  regionCoversAreas, regionWithinAreas,
} from "@/lib/coloredAreas";
import { evaluateWinCondition } from "@/lib/winSpec";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import type { ColoredArea } from "@/types/level";

/** checkBallWonState's share of a zone a sealed pocket must cover to count. */
const AREA_COVER_FRACTION = 0.7;

/**
 * Could a live target still end up locked in a gate zone on this grid?
 *
 * Plays the lock rule forward rather than reading one pass of it, because the
 * rule is not fixed: its denominator is the board divided among the balls
 * still MOVING, so every lock raises it and the next region can lock without
 * another cut. Measured on level 3: a fence locked one ball on the far side of
 * the doorway, the other ball's region - comfortably too big to lock while two
 * were moving - became small enough the instant it was alone, and locked
 * outside the zone on the same pass. So: lock every region the rule would
 * lock, recompute, repeat, and only then ask whether the zone is still
 * creditable - to a lock that happened on the way, or to a ball still free.
 *
 * Reads the grid's regions fresh (the painted ids are stale on a simulated
 * copy) and restores the region-id counter afterwards, so a prediction never
 * renumbers the regions the real board goes on to make.
 */
function zoneStillWinnable(
  game: CanvasGameState, grid: SpaceGrid, gates: ColoredArea[], cells: number[],
): boolean {
  const zone = new Set(cells.filter(i => grid.cells[i] === CellState.ACTIVE));
  if (zone.size === 0) return false;
  const targets = gateTargets(game.balls);
  if (targets.length === 0) return false;

  const counter = exportGridRegionIdCounter();
  const regions = findGridRegions(grid);
  importGridRegionIdCounter(counter);
  const regionOf = (b: { position: { x: number; y: number } }) => {
    const idx = worldToGridIndex(grid, b.position.x, b.position.y);
    return regions.find(r => r.cellIndices.includes(idx)) ?? null;
  };

  const threshold = game.lockWinThresholdPercent ?? BALL_WON_REGION_THRESHOLD;
  const minCells = game.lockMinRegionCells ?? 0;
  const zoneCellsIn = (r: { cellIndices: number[] }) => r.cellIndices.filter(i => zone.has(i)).length;
  const credits = (r: { cellIndices: number[] }, balls: typeof targets) =>
    zoneCellsIn(r) > 0 && (
      balls.some(b => coloredAreaAt(b.position.x, b.position.y, gates) !== null)
      || regionCoversAreas(grid, r.cellIndices, gates, AREA_COVER_FRACTION)
      || regionWithinAreas(grid, r.cellIndices, gates));

  let moving = game.balls.filter(b => b.state !== "won" && b.state !== "dormant" && b.speed > 0);
  let activeCells = countActiveCells(grid);
  const locked = new Set<unknown>();
  for (;;) {
    const denominator = Math.max(activeCells,
      Math.floor(grid.initialActiveCount / Math.max(1, moving.length)));
    const lockingNow = new Map<(typeof regions)[number], typeof targets>();
    for (const b of moving) {
      const r = regionOf(b);
      if (!r || locked.has(r)) continue;
      const n = r.cellIndices.length;
      if ((n / Math.max(1, denominator)) * 100 <= threshold || (minCells > 0 && n <= minCells)) {
        lockingNow.set(r, [...(lockingNow.get(r) ?? []), b]);
      }
    }
    if (lockingNow.size === 0) break;
    for (const [r, balls] of lockingNow) {
      const counted = balls.filter(b => targets.includes(b));
      if (counted.length > 0 && credits(r, counted)) return true;
      locked.add(r);
      activeCells -= r.cellIndices.length;
    }
    moving = moving.filter(b => !lockingNow.has(regionOf(b)!));
  }

  // Whoever is still free: fine, as long as a lock where they are could still
  // COUNT - room for a ball's centre inside the zone, or most of the zone still
  // open. A sliver along the zone's edge is neither, and it is what an early
  // cut left on level 3 before a later one ended the map.
  for (const b of targets) {
    const r = regionOf(b);
    if (!r || locked.has(r) || zoneCellsIn(r) === 0) continue;
    if (zoneCellsIn(r) / cells.length >= AREA_COVER_FRACTION) return true;
    if (r.cellIndices.some(i => zone.has(i) && roomForABall(grid, i, ballRadius(game)))) return true;
  }
  return false;
}

/** Grid cells under a destructible's body: what its breaking hands back. */
function footprint(grid: SpaceGrid, d: { obstaclePolygon?: { vertices: { x: number; y: number }[] } }): number[] {
  const vs = d.obstaclePolygon?.vertices ?? [];
  if (vs.length === 0) return [];
  const x0 = Math.min(...vs.map(v => v.x)), x1 = Math.max(...vs.map(v => v.x));
  const y0 = Math.min(...vs.map(v => v.y)), y1 = Math.max(...vs.map(v => v.y));
  const out: number[] = [];
  for (let r = 0; r < grid.height; r++) {
    const cy = grid.originY + (r + 0.5) * grid.cellSize;
    if (cy < y0 || cy > y1) continue;
    for (let c = 0; c < grid.width; c++) {
      const cx = grid.originX + (c + 0.5) * grid.cellSize;
      if (cx >= x0 && cx <= x1) out.push(r * grid.width + c);
    }
  }
  return out;
}

/** Smallest radius among the balls still in play; the game's default when none. */
function ballRadius(game: CanvasGameState): number {
  const live = game.balls.filter(b => b.state !== "won");
  return live.length === 0 ? 18 : Math.min(...live.map(b => b.radius));
}

/** Could a ball's centre sit on this cell: every cell within its radius open? */
function roomForABall(grid: SpaceGrid, idx: number, radius: number): boolean {
  const k = Math.ceil(radius / grid.cellSize);
  const row = Math.floor(idx / grid.width), col = idx % grid.width;
  for (let dr = -k; dr <= k; dr++) {
    for (let dc = -k; dc <= k; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || c < 0 || r >= grid.height || c >= grid.width) return false;
      if (grid.cells[r * grid.width + c] !== CellState.ACTIVE) return false;
    }
  }
  return true;
}

export function cutWouldBuryArea(
  game: CanvasGameState,
  spec: WinSpec,
  /** The board's win state before this cut (applyCut's readWinSnapshot). */
  snap: WinSnapshot,
  segments: ReadonlyArray<{ start: Vector2; end: Vector2 }>,
  thickness: number,
): boolean {
  const clause = spec.require.find(c => c.kind === "area");
  if (!clause) return false;
  const grid = game.spaceGrid;
  if (!grid || segments.length === 0) return false;
  const gates = gateAreas(game.coloredAreas ?? []);
  if (gates.length === 0) return false;
  // Already landed: the zone has done its job, and sealing it now costs nothing.
  if (evaluateWinCondition(clause, snap).met) return false;

  const cells = areaCellIndices(grid, gates);
  const after = (): SpaceGrid => {
    const g: SpaceGrid = { ...grid, cells: Uint8Array.from(grid.cells), cellRegionIds: [...grid.cellRegionIds] };
    for (const seg of segments) rasterizeCutToGrid(g, seg.start, seg.end, thickness);
    captureUnreachableCells(g, game.balls, [...game.walls, ...segments]);
    return g;
  };

  // A ZONE STILL BEHIND ITS DOOR. Its cells are not open yet, so there is no
  // zone to measure until the door goes - so open it, on the prediction: put
  // the door's footprint and the ground it seals back, run the capture again,
  // and ask the ordinary question of what is left. A fence can leave a door a
  // ball can still STRIKE and still strand the zone behind it: found on level
  // 8 the day its doorway narrowed, where a ball could chip the curtain's end
  // from the side while the ground under it was already claimed, so the box
  // opened onto nothing a ball could enter, twenty seconds after the fence
  // that decided it.
  const pending = sealedPendingCells(game.destructibles);
  if (cells.some(i => pending.has(i))) {
    const doors = game.destructibles.filter(d =>
      !d.destroyed && (d.sealedCells ?? []).some(i => cells.includes(i)));
    if (doors.length === 0) return false;
    const opened = (g: SpaceGrid): SpaceGrid => {
      const o: SpaceGrid = { ...g, cells: Uint8Array.from(g.cells), cellRegionIds: [...g.cellRegionIds] };
      for (const d of doors) {
        for (const i of [...(d.sealedCells ?? []), ...footprint(o, d)]) o.cells[i] = CellState.ACTIVE;
      }
      const walls = game.walls.filter(w => !doors.some(d => w.id.startsWith(`obstacle-${d.id}-`)));
      captureUnreachableCells(o, game.balls, [...walls, ...segments]);
      return o;
    };
    if (!zoneStillWinnable(game, opened(grid), gates, cells)) return false;   // already lost
    return !zoneStillWinnable(game, opened(after()), gates, cells);
  }

  // Already lost: not this cut's doing, and the failure in applyCut says so.
  if (!zoneStillWinnable(game, grid, gates, cells)) return false;
  return !zoneStillWinnable(game, after(), gates, cells);
}
