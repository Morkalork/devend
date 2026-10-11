/**
 * A bomb blast takes a bite out of the board (lib/bombCore.ts, the shard bomb).
 *
 * "Make them able to blast holes in walls. Also, from now on, a locked off area
 * is considered one big wall, so blowing up part of it takes a chunk of it."
 *
 * Everything solid inside the blast circle goes, whatever made it solid:
 *
 *   FENCES      each one crossing the blast is replaced by the pieces left
 *               standing outside it (a fence can be cut in two)
 *   MAP WALLS   each plain obstacle crossing it becomes the obstacle minus the
 *               circle, as one or more solids (blastGeometry.ts; never a hole)
 *   CLAIMED     the captured ground inside it reopens: the claimed area is one
 *   GROUND      big wall, and the blast takes a chunk out of it
 *
 * Then the board settles exactly as it does after a cut: ground no ball can
 * reach is captured again at once, so a chunk blown out of the middle of the
 * player's territory with no way in closes straight back up. Ground a ball CAN
 * reach through the hole is live again, and counts against the cleared % - it
 * was claimed, and now it is not. Ground that was under a map wall is new
 * ground, as when a breakable comes down, and does not.
 *
 * Where the crater meets claimed ground that is still claimed, its edge is
 * walled: the claimed area is solid, so the hole in it has sides. Without them
 * a ball would roll straight into claimed space through the crater wall.
 *
 * Left alone: the board's own edge, mirrors, portals, phasing walls, bumpers,
 * deformables, ruled membranes, box/cage/launcher shells, and destructibles
 * (the blast strikes those instead: see processDestroysFn). Ground held for a
 * reason of its own stays held too: a gate's sealed area, a delivery box's
 * reserve, a launcher's barrel.
 *
 * Deterministic (array order, generateWallId), so both phones of a pair carve
 * the same board.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Polygon, Vector2 } from "@/lib/polygon";
import { pointInPolygon, pointToSegmentDistance } from "@/lib/polygon";
import { CellState, captureUnreachableCells, obstacleSealReach, rasterizeCutToGrid, restoreCells, sealPolygonToGrid, worldToGridIndex } from "@/lib/spaceGrid";
import { createWallsFromPolygon, isPlayerFence, type Wall } from "@/lib/wallGeometry";
import { generateWallId } from "@/lib/gameUtils";
import { simNow } from "@/lib/simClock";
import { STANDARD_FENCE_ID } from "@/lib/fences";
import {
  circlePolygon, polygonMinusConvex, polygonTouchesCircle, segmentMinusCircle, segmentTouchesCircle,
} from "@/lib/blastGeometry";
import { heldByOther, pushReopenedSamplePoints } from "@/lib/physics/destructibles";

/** The crater wall's thickness: a fence's. */
const RIM_THICKNESS = 6;
/** Sides on the blast circle. */
const BLAST_SIDES = 40;

/** A fence the blast can cut: one the player drew, not a shell or a special wall. */
export function carvableFence(w: Wall): boolean {
  return isPlayerFence(w) && !w.isObstacleBoundary && !w.isMirror
    && !w.portal && !w.bouncer && !w.deformable && !w.passRule;
}

/** The plain map walls the blast can carve, with the id their edge walls are named by. */
export function carvableObstacles(game: CanvasGameState): { id: string; polygon: Polygon }[] {
  const special = new Set<Polygon>();
  for (const d of game.destructibles ?? []) {
    if (d.obstaclePolygon) special.add(d.obstaclePolygon);
    if (d.mirrorPolygon) special.add(d.mirrorPolygon);
  }
  for (const p of game.mirrorPolygons ?? []) special.add(p);
  for (const p of game.phasingObjects ?? []) special.add(p.polygon);
  for (const m of [game.obstacleRules, game.bouncers, game.deformables, game.portals]) {
    if (m) for (const p of m.keys()) special.add(p);
  }
  const edgeIds = new Set(game.walls.map(w => w.id));
  const out: { id: string; polygon: Polygon }[] = [];
  for (const s of game.stackObjects ?? []) {
    if (s.toppled || s.breakable || special.has(s.polygon)) continue;
    if (!game.obstaclePolygons.includes(s.polygon)) continue;
    if (!edgeIds.has(`obstacle-${s.id}-edge-0`)) continue;
    out.push({ id: s.id, polygon: s.polygon });
  }
  return out;
}

function withoutCaches(w: Wall): Wall {
  const n: Wall = { ...w };
  delete n.aabbMinX; delete n.aabbMinY; delete n.aabbMaxX; delete n.aabbMaxY;
  delete n.isBoardEdge;
  return n;
}

/** Cells some other mechanic is holding off the board, which a blast must not hand back. */
function protectedCells(game: CanvasGameState): Set<number> {
  const out = new Set<number>();
  for (const d of game.destructibles ?? []) {
    if (!d.destroyed) for (const i of d.sealedCells ?? []) out.add(i);
  }
  for (const b of game.deliveryBoxes ?? []) for (const i of b.reservedCells ?? []) out.add(i);
  const grid = game.spaceGrid;
  if (grid) {
    for (const l of game.launchers ?? []) {
      const r = l.inner;
      for (let y = r.y; y <= r.y + r.height; y += grid.cellSize / 2) {
        for (let x = r.x; x <= r.x + r.width; x += grid.cellSize / 2) {
          const i = worldToGridIndex(grid, x, y);
          if (i >= 0) out.add(i);
        }
      }
    }
  }
  return out;
}

export interface CarveResult {
  /** Cells handed back to the board (before the settle recaptures any). */
  opened: number;
  fencesCut: number;
  wallsCarved: number;
  rimWalls: number;
}

/**
 * Carve the blast into the board. Mutates `game`; the caller settles the
 * ground afterwards (processDestroysFn's settleReopenedGround), which rebuilds
 * the regions and the remaining %.
 */
export function carveBlast(game: CanvasGameState, centre: Vector2, radius: number): CarveResult {
  const result: CarveResult = { opened: 0, fencesCut: 0, wallsCarved: 0, rimWalls: 0 };
  const blast = circlePolygon(centre, radius, BLAST_SIDES);
  const grid = game.spaceGrid;

  // Lines the blast removed, where a seam between live and claimed ground can
  // open (see The seams, below). A fence span keeps its fence as the template.
  const seams: { a: Vector2; b: Vector2; template?: Wall; rim?: boolean }[] = [];
  for (let k = 0; k < blast.vertices.length; k++) {
    seams.push({ a: blast.vertices[k], b: blast.vertices[(k + 1) % blast.vertices.length], rim: true });
  }

  // ── Fences ────────────────────────────────────────────────────────────────
  const walls: Wall[] = [];
  for (const w of game.walls) {
    if (!carvableFence(w) || !segmentTouchesCircle(w.start, w.end, centre, radius)) { walls.push(w); continue; }
    result.fencesCut++;
    const span = insideSpan(w.start, w.end, centre, radius);
    if (span) seams.push({ ...span, template: w });
    const corridor = (w.thickness ?? 6) / 2 + (grid?.cellSize ?? 15) / 2;
    for (const piece of segmentMinusCircle(w.start, w.end, blast)) {
      const n = withoutCaches(w);
      n.id = generateWallId();
      n.start = piece.start;
      n.end = piece.end;
      // The band cells this piece still stands on, so it can give them back
      // if it is ever broken in its turn.
      if (grid && w.rasterCells) {
        n.rasterCells = w.rasterCells.filter(i => {
          const col = i % grid.width, row = (i - col) / grid.width;
          const p = { x: grid.originX + (col + 0.5) * grid.cellSize, y: grid.originY + (row + 0.5) * grid.cellSize };
          return pointToSegmentDistance(p, piece.start, piece.end) <= corridor;
        });
      }
      walls.push(n);
    }
  }

  // ── Map walls ─────────────────────────────────────────────────────────────
  const carvedBefore: Polygon[] = [];
  let polygons = game.obstaclePolygons;
  for (const ob of carvableObstacles(game)) {
    if (!polygonTouchesCircle(ob.polygon, centre, radius)) continue;
    result.wallsCarved++;
    carvedBefore.push(ob.polygon);
    const ov = ob.polygon.vertices;
    for (let k = 0; k < ov.length; k++) {
      const span = insideSpan(ov[k], ov[(k + 1) % ov.length], centre, radius);
      if (span) seams.push(span);
    }
    const pieces = polygonMinusConvex(ob.polygon, blast);
    const prefix = `obstacle-${ob.id}-edge-`;
    for (let i = walls.length - 1; i >= 0; i--) if (walls[i].id.startsWith(prefix)) walls.splice(i, 1);
    polygons = polygons.filter(p => p !== ob.polygon);
    const rise = game.obstacleRise?.get(ob.polygon);
    game.obstacleRise?.delete(ob.polygon);
    const stack = game.stackObjects.find(s => s.id === ob.id);
    game.stackObjects = game.stackObjects.filter(s => s.id !== ob.id);
    const ids: string[] = [];
    for (const piece of pieces) {
      game.blastPieceSeq = (game.blastPieceSeq ?? 0) + 1;
      const id = `${ob.id}~b${game.blastPieceSeq}`;
      ids.push(id);
      polygons = [...polygons, piece];
      walls.push(...createWallsFromPolygon(piece, `obstacle-${id}`));
      if (rise != null) game.obstacleRise?.set(piece, rise);
      game.stackObjects.push({ id, polygon: piece, breakable: false, supporterId: stack?.supporterId ?? null, toppled: false });
    }
    for (const s of game.stackObjects) if (s.supporterId === ob.id) s.supporterId = ids[0] ?? null;
  }
  game.walls = walls;
  game.obstaclePolygons = polygons;
  if (result.wallsCarved > 0) game.obstacleVersion = (game.obstacleVersion ?? 0) + 1;

  if (!grid) return result;

  // ── Claimed ground ────────────────────────────────────────────────────────
  const held = heldByOther(game, grid);
  const keep = protectedCells(game);
  const seal = obstacleSealReach(grid.cellSize);
  const cs = grid.cellSize;
  const c0 = Math.max(0, Math.floor((centre.x - radius - grid.originX) / cs));
  const c1 = Math.min(grid.width - 1, Math.floor((centre.x + radius - grid.originX) / cs));
  const r0 = Math.max(0, Math.floor((centre.y - radius - grid.originY) / cs));
  const r1 = Math.min(grid.height - 1, Math.floor((centre.y + radius - grid.originY) / cs));
  const reopened: number[] = [];
  let newGround = 0;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const i = row * grid.width + col;
      if (grid.cells[i] !== CellState.REMOVED || keep.has(i)) continue;
      const p = { x: grid.originX + (col + 0.5) * cs, y: grid.originY + (row + 0.5) * cs };
      if (Math.hypot(p.x - centre.x, p.y - centre.y) > radius) continue;
      if (held(p)) continue;
      reopened.push(i);
      // Under a map wall that was standing a moment ago: ground that was never
      // the player's to lose.
      if (carvedBefore.some(poly => pointInPolygon(p, poly) || nearOutline(p, poly, seal))) newGround++;
    }
  }
  restoreCells(grid, reopened);
  grid.initialActiveCount += newGround;
  for (const i of reopened) {
    if (grid.lockCaptured) grid.lockCaptured[i] = 0;
    if (grid.superiorCaptured) grid.superiorCaptured[i] = 0;
  }
  pushReopenedSamplePoints(game, reopened);
  result.opened = reopened.length;

  // Every solid near the blast seals its outline back into the grid: the ring
  // of cells a solid's edge crosses was reopened above if its centre fell
  // outside the solid, and without it the ground floods past the wall.
  for (const poly of [...game.obstaclePolygons, ...(game.mirrorPolygons ?? [])]) {
    if (polygonTouchesCircle(poly, centre, radius + cs)) sealPolygonToGrid(grid, poly);
  }

  // What no ball can reach closes straight back up, as after a cut.
  captureUnreachableCells(grid, game.balls, game.walls);

  // ── The seams ─────────────────────────────────────────────────────────────
  // Wherever live ground now meets claimed ground, there has to be a wall: the
  // claimed area is solid, and every other mechanic relies on its edge being
  // walled (a broken wall's shadow is handed back by flooding through claimed
  // cells no wall holds, and an unwalled seam would hand back the lot). The
  // blast can only open such a seam along a line it removed: the cut spans of
  // the fences, the carved outlines of the map's walls, and its own edge. Each
  // is walked in short steps, and the stretches with live ground on one side
  // and claimed ground on the other are walled again: the crater's sides where
  // the crater stayed open, and the fence put back wherever the hole did not
  // open right through it.
  const heldAfter = heldByOther(game, grid);
  const now = simNow();
  const cutId = generateWallId();
  const claimedAt = (x: number, y: number): boolean => {
    const i = worldToGridIndex(grid, x, y);
    if (i < 0 || grid.cells[i] !== CellState.REMOVED || keep.has(i)) return false;
    const col = i % grid.width, row = (i - col) / grid.width;
    return !heldAfter({ x: grid.originX + (col + 0.5) * cs, y: grid.originY + (row + 0.5) * cs });
  };
  // Inside something breakable that touches claimed ground: walled as if it
  // were claimed ground already, because when it breaks it hands back what it
  // held by flooding through claimed cells, and a seam left open through it
  // would let that flood run out into the crater (and the whole claimed area
  // with it). Asked once per breakable.
  const bordersClaimed = new Map<Polygon, boolean>();
  const breakableBorderingClaimed = (x: number, y: number): boolean => {
    for (const d of game.destructibles ?? []) {
      const poly = d.obstaclePolygon;
      if (d.destroyed || !poly || !pointInPolygon({ x, y }, poly)) continue;
      let b = bordersClaimed.get(poly);
      if (b === undefined) {
        b = false;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of poly.vertices) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
        for (let yy = y0 - cs; yy <= y1 + cs && !b; yy += cs / 2) {
          for (let xx = x0 - cs; xx <= x1 + cs && !b; xx += cs / 2) {
            if (!pointInPolygon({ x: xx, y: yy }, poly) && claimedAt(xx, yy)) b = true;
          }
        }
        bordersClaimed.set(poly, b);
      }
      if (b) return true;
    }
    return false;
  };
  // On or within a cell of a breakable (its seal ring holds the cells round it).
  const insideBreakable = (x: number, y: number): boolean =>
    (game.destructibles ?? []).some(d => !d.destroyed && !!d.obstaclePolygon
      && (pointInPolygon({ x, y }, d.obstaclePolygon) || nearOutline({ x, y }, d.obstaclePolygon, cs)));
  // Open on this side of a cut fence: live ground, or the band another fence
  // already holds (the surviving piece's end). Claimed ground, a solid the
  // fence ran through, or the board's outside are not.
  const clearAt = (x: number, y: number): boolean => {
    const i = worldToGridIndex(grid, x, y);
    if (i < 0) return false;
    if (grid.cells[i] === CellState.ACTIVE) return true;
    const col = i % grid.width, row = (i - col) / grid.width;
    const p = { x: grid.originX + (col + 0.5) * cs, y: grid.originY + (row + 0.5) * cs };
    return game.walls.some(w => carvableFence(w) && pointToSegmentDistance(p, w.start, w.end) <= (w.thickness ?? 6) / 2 + cs / 2);
  };
  const liveAt = (x: number, y: number): boolean => {
    const i = worldToGridIndex(grid, x, y);
    return i >= 0 && grid.cells[i] === CellState.ACTIVE;
  };
  for (const seam of seams) {
    const dx = seam.b.x - seam.a.x, dy = seam.b.y - seam.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const steps = Math.max(1, Math.ceil(len / 8));
    const nx = -dy / len, ny = dx / len, off = cs * 0.6;
    let runStart = -1;
    const flush = (endStep: number) => {
      if (runStart < 0) return;
      const t0 = runStart / steps, t1 = endStep / steps;
      const a = { x: seam.a.x + dx * t0, y: seam.a.y + dy * t0 };
      const b = { x: seam.a.x + dx * t1, y: seam.a.y + dy * t1 };
      runStart = -1;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return;
      const w: Wall = seam.template
        ? { ...withoutCaches(seam.template), id: generateWallId(), start: a, end: b }
        : { id: generateWallId(), start: a, end: b, thickness: RIM_THICKNESS, createdAt: now, fenceTypeId: STANDARD_FENCE_ID, cutId };
      w.rasterCells = rasterizeCutToGrid(grid, a, b, w.thickness ?? RIM_THICKNESS);
      game.walls.push(w);
      result.rimWalls++;
    };
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const mx = seam.a.x + dx * t, my = seam.a.y + dy * t;
      const l = liveAt(mx + nx * off, my + ny * off), r = liveAt(mx - nx * off, my - ny * off);
      // A fence stays cut only where the hole really opened through it, open
      // ground on both sides. Anywhere else it goes back as it was: against
      // claimed ground the span is still the edge of the player's territory,
      // and through a solid it is the band that keeps that territory sealed
      // when the solid breaks (a broken wall hands back the ground it held by
      // flooding through claimed cells no wall holds). Any other seam is
      // walled where live ground meets claimed ground.
      const cl = claimedAt(mx + nx * off, my + ny * off) || breakableBorderingClaimed(mx + nx * off, my + ny * off);
      const cr = claimedAt(mx - nx * off, my - ny * off) || breakableBorderingClaimed(mx - nx * off, my - ny * off);
      let open: boolean;
      if (seam.template) {
        open = !(clearAt(mx + nx * off, my + ny * off) && clearAt(mx - nx * off, my - ny * off));
      } else if (seam.rim) {
        // The crater's own edge, where in and out are known. The crater side
        // counts as open when it is live, or when a breakable stands there with
        // live crater just beyond it: a breakable sitting across the edge is
        // still a gap once it breaks.
        const s = (nx * (mx - centre.x) + ny * (my - centre.y)) > 0 ? 1 : -1;
        const ix = mx - s * nx * off, iy = my - s * ny * off;
        const ox = mx + s * nx * off, oy = my + s * ny * off;
        const dx2 = mx - s * nx * cs * 2.5, dy2 = my - s * ny * cs * 2.5;
        const inside = liveAt(ix, iy) || (insideBreakable(ix, iy) && liveAt(dx2, dy2));
        open = inside && (claimedAt(ox, oy) || breakableBorderingClaimed(ox, oy));
      } else {
        open = (l && cr) || (r && cl);
      }
      if (open && runStart < 0) runStart = k;
      if (!open) flush(k);
    }
    flush(steps);
  }
  if (result.rimWalls > 0) game.walls = [...game.walls];
  return result;
}

/** The part of a segment inside the circle, or null. */
function insideSpan(p: Vector2, q: Vector2, c: Vector2, r: number): { a: Vector2; b: Vector2 } | null {
  const dx = q.x - p.x, dy = q.y - p.y;
  const fx = p.x - c.x, fy = p.y - c.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-9) return null;
  const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - sq) / (2 * A)), t1 = Math.min(1, (-B + sq) / (2 * A));
  if (t1 <= t0) return null;
  return { a: { x: p.x + dx * t0, y: p.y + dy * t0 }, b: { x: p.x + dx * t1, y: p.y + dy * t1 } };
}

function nearOutline(p: Vector2, poly: Polygon, reach: number): boolean {
  const v = poly.vertices;
  for (let i = 0; i < v.length; i++) {
    if (pointToSegmentDistance(p, v[i], v[(i + 1) % v.length]) <= reach) return true;
  }
  return false;
}
