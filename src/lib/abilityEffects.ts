/**
 * Ability effects (destruct-up rewards, issue #38).
 *
 * The coded effect behind each ability KIND. `fireAbility` looks the pressed
 * ability up in the catalogue (src/lib/abilities.ts) and dispatches on its kind
 * with that entry's params, so YAML variants (a long freeze vs a short one) all
 * route through the same code.
 *
 *  - freeze:       freeze every active ball for a few seconds (frozenUntil).
 *  - slow:         globally slow every ball for a few seconds via game.creepFactor.
 *  - clearFences:  shatter every player fence, reopen all non-locked captured
 *                  space, and redraw each locked pocket's own outline.
 */
import { CanvasGameState } from "@/types/gameState";
import { getAbility } from "@/lib/abilities";
import { placeSlowArea } from "@/lib/physics/slowAreas";
import { descopeAt } from "@/lib/physics/descope";
import { BOARD_WIDTH } from "@/lib/boardConstants";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { pointInPolygon, polygonCentroid, pointToSegmentDistance } from "@/lib/polygon";
import { bandDamage, bandVelocity, inBandSweep, type BandShape } from "@/lib/rubberBand";
import {
  CellState,
  restoreCells,
  getRemainingPercent,
  captureUnreachableCells,
  rasterizeCutToGrid,
  floodRemovedEnclosure,
} from "@/lib/spaceGrid";
import { rebuildRegionsKeepAll, spawnFenceShatter, pushReopenedSamplePoints } from "@/lib/physics/destructibles";
import { traceContours, snapContoursToWalls } from "@/lib/rendering/regionContour";
import { WALL_THICKNESS } from "@/lib/wallGeometry";

// Fallback params if a YAML entry omits them.
const DEFAULT_FREEZE_SECONDS = 3;
const DEFAULT_SLOW_SECONDS = 5;
const DEFAULT_SLOW_FACTOR = 0.45;
const DEFAULT_FENCE_RUSH_SECONDS = 4;
const DEFAULT_FENCE_RUSH_FACTOR = 6;
const DEFAULT_FENCE_SHIELD_SECONDS = 5;

/** The centre of the play area (board centroid; falls back to the board rect). */
function boardCenter(game: CanvasGameState): { x: number; y: number } {
  if (game.boardPolygon) return polygonCentroid(game.boardPolygon);
  const r = game.boardRect;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ── Freeze ───────────────────────────────────────────────────────────────────

/** Freeze every active ball for `durationMs` (won balls are already still). */
export function freezeAllBalls(game: CanvasGameState, now: number, durationMs: number): void {
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    b.frozenUntil = now + durationMs;
    b.freezeReadyAt = now + durationMs; // no re-freeze churn during the hold
  }
}

// ── Slow ─────────────────────────────────────────────────────────────────────

/** Start a global slow: every ball moves at `factor` for `seconds`. */
export function applySlowAll(game: CanvasGameState, factor: number, seconds: number): void {
  game.abilitySlowUntil = game.activePlaySeconds + seconds;
  game.abilitySlowMult = factor;
}

/**
 * The Slow All displacement multiplier for the current frame (1 when inactive).
 * Folded into game.creepFactor in useGameLoop so ball movement AND the aim-line
 * predictor both see it. Self-reverting: it expires by clock comparison.
 */
export function abilitySpeedFactor(game: CanvasGameState): number {
  if (game.abilitySlowUntil !== undefined && game.activePlaySeconds < game.abilitySlowUntil) {
    return game.abilitySlowMult ?? 1;
  }
  return 1;
}

// ── Clear All Fences (full reset) ─────────────────────────────────────────────

export interface ClearFencesCallbacks {
  repaintRegionCanvas: () => void;
  setRemainingPercent: (percent: number) => void;
  /** Colour the cleared fences shatter into (usually the level accent). */
  fenceColor?: string;
}

/** Cap on fence-shatter bursts spawned at once, so a very cut-up board can't
 *  flood the debris renderer. */
const MAX_FENCE_SHATTERS = 40;

/**
 * How far a traced pocket outline may be straightened, in cells.
 *
 * The contour comes off the cell lattice already Chaikin-smoothed, so it is a
 * long chain of tiny segments. Handing that to the physics loop verbatim would
 * mean hundreds of collision segments per pocket for a shape that is really
 * three or four straight runs, so it is simplified first. Under a cell, the
 * corners stay where the player cut them.
 */
const OUTLINE_TOLERANCE_CELLS = 1;

/**
 * How close a redrawn edge may sit to an existing wall before it is dropped.
 *
 * Deliberately under one cell, and it can be, because the outline is snapped to
 * the walls first: an edge that really does run along the board edge is pulled
 * flush onto it and comes out at a distance of about zero, so it does not need
 * a wide net to catch it.
 *
 * Widening this is a trap. The board's playable area is inset from its frame,
 * so a fence drawn near the edge sits only a cell or so from the board wall; at
 * two cells the check starts swallowing real pocket edges and leaves the pocket
 * open on that side. Measured: it drops the fixture's left-hand wall, which is
 * 19 units from a board edge.
 */
const EXISTING_WALL_CELLS = 0.9;

/** Below this a redrawn edge is skipped: a sliver of wall, not an edge. */
const MIN_EDGE_CELLS = 0.8;

/**
 * How far a loose outline end may be pushed to reach the wall it stops against,
 * in cells.
 *
 * A fence must always run all the way into whatever bounds it. The trace works
 * on cell centres, so a pocket's outline naturally stops about a cell shy of
 * the board edge, and a wall ending a few pixels short of the frame is a gap:
 * visibly wrong, and a hole a ball can be pushed through. Ends are therefore
 * extended ALONG THEIR OWN DIRECTION onto the wall they are heading for, which
 * lengthens the fence without bending it.
 */
const REACH_BOUNDARY_CELLS = 3;

/**
 * How far the pocket may be grown to meet its own outline, in cells.
 *
 * The gap between a straightened outline and the cells it wraps is one or two
 * cells wide, so the fill never needs to reach further. Capping the DISTANCE
 * rather than trusting the ring to be closed is what keeps a cosmetic touch-up
 * from being able to swallow the board: the worst a gap in the outline can cost
 * is a fringe this deep.
 */
const SLIVER_DEPTH_CELLS = 2;

/** Prefix marking a wall this module drew around a pocket. */
const SEAL_PREFIX = "lockseal-";

/** A wall as this module needs it: a segment with an id. */
type Wall = CanvasGameState["walls"][number];

type Grid = NonNullable<CanvasGameState["spaceGrid"]>;
type Pt = { x: number; y: number };

let _sealCounter = 0;

/**
 * Ramer-Douglas-Peucker: drop the points that lie within `tolerance` of the
 * chord they sit on, so a smoothed lattice trace comes back as the handful of
 * corners it was actually drawn as.
 */
function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points.slice();

  let worst = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i], first, last);
    if (d > worst) { worst = d; index = i; }
  }
  if (worst <= tolerance) return [first, last];

  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

/**
 * Where a ray from `p` along `dir` meets a wall's line, if that is within
 * `maxReach` ahead and lands on the wall itself rather than past its end.
 */
function reachAlong(
  p: Pt, dir: Pt, wall: { start: Pt; end: Pt }, maxReach: number,
): Pt | null {
  const sx = wall.end.x - wall.start.x;
  const sy = wall.end.y - wall.start.y;
  const denom = dir.x * sy - dir.y * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel: it never meets it

  const qx = wall.start.x - p.x;
  const qy = wall.start.y - p.y;
  const t = (qx * sy - qy * sx) / denom;   // distance along dir (dir is unit)
  const u = (qx * dir.y - qy * dir.x) / denom; // 0..1 along the wall
  if (t < 0 || t > maxReach) return null;
  if (u < -0.02 || u > 1.02) return null;
  return { x: p.x + dir.x * t, y: p.y + dir.y * t };
}

/**
 * Push every loose end of a ring of segments out to the wall it stops against.
 *
 * An end is loose when no other segment in the ring continues from it, which
 * happens wherever an edge was dropped for lying along the board edge or an
 * obstacle. Those are exactly the ends that must reach the frame, and the trace
 * leaves them about a cell short of it.
 */
function reachBoundaries(segments: { start: Pt; end: Pt }[], walls: Wall[], maxReach: number): void {
  const shared = (pt: Pt, self: number) => segments.some((other, i) =>
    i !== self
    && (Math.hypot(other.start.x - pt.x, other.start.y - pt.y) < 0.5
      || Math.hypot(other.end.x - pt.x, other.end.y - pt.y) < 0.5));

  segments.forEach((seg, i) => {
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const forward = { x: dx / len, y: dy / len };
    const back = { x: -forward.x, y: -forward.y };

    const push = (from: Pt, dir: Pt): Pt | null => {
      let best: Pt | null = null;
      let bestDist = Infinity;
      for (const w of walls) {
        const hit = reachAlong(from, dir, w, maxReach);
        if (!hit) continue;
        const d = Math.hypot(hit.x - from.x, hit.y - from.y);
        if (d < bestDist) { bestDist = d; best = hit; }
      }
      return best;
    };

    if (!shared(seg.end, i)) {
      const hit = push(seg.end, forward);
      if (hit) seg.end = hit;
    }
    if (!shared(seg.start, i)) {
      const hit = push(seg.start, back);
      if (hit) seg.start = hit;
    }
  });
}

/**
 * The walls to draw around every locked pocket.
 *
 * This is the answer to "just leave the lock area". Rather than deciding which
 * of the player's fences to keep and where to cut them, the pocket's own
 * outline is traced, straightened into its few real corners, and rebuilt as
 * fresh wall segments.
 *
 * Two earlier attempts worked from the existing fences instead. Keeping whole
 * walls left lines running to the far side of the board; trimming them to the
 * bordering stretch still left stubs. Both failed for the same reason: whether
 * a given fence is "part of" a pocket is not something a proximity probe can
 * pin down. An outline has no such ambiguity. It is exactly the pocket, and
 * nothing else exists.
 *
 * Edges already covered by a board edge or an obstacle face are skipped, since
 * a wall is already standing there and a fence over it would double the line.
 */
function sealWallsFor(
  grid: Grid,
  locked: Set<number>,
  now: number,
  /** Every wall standing when the press happened, INCLUDING the doomed fences. */
  snapTo: Wall[],
  /** Walls that already cover an edge, so no seal is drawn there. */
  coveredBy: Wall[],
): Wall[] {
  if (locked.size === 0) return [];

  // Traced from the CURRENT locked set rather than grid.lockCaptured directly,
  // so the stale marks the caller filters out can never grow a wall.
  //
  // Snapped to the player's OWN fences, which is why they are captured before
  // being removed. A raw trace runs along the locked CELLS, so it sits about a
  // cell inside the line that sealed them and wanders with the lattice
  // staircase; projected onto the fence the player actually drew, it lands on
  // that line and the straightening below collapses it to the single edge it
  // always was.
  const gw = grid.width;
  const loops = snapContoursToWalls(
    traceContours(grid, (col, row) => locked.has(row * gw + col)),
    snapTo,
    grid.cellSize * 1.6,
  );

  const tolerance = grid.cellSize * OUTLINE_TOLERANCE_CELLS;
  const nearExisting = grid.cellSize * EXISTING_WALL_CELLS;
  const minEdge = grid.cellSize * MIN_EDGE_CELLS;
  const out: Wall[] = [];

  for (const loop of loops) {
    if (loop.length < 3) continue;
    // Close the ring before simplifying, so the seam between the last and first
    // point is straightened like every other corner.
    const ring = simplify([...loop, loop[0]], tolerance);

    const kept: { start: Pt; end: Pt }[] = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const start = ring[i];
      const end = ring[i + 1];
      if (Math.hypot(end.x - start.x, end.y - start.y) < minEdge) continue;

      // Already walled: the pocket runs along the board edge or an obstacle.
      // Probed at three points, so an edge merely CROSSING a wall is not
      // mistaken for one lying along it, and a long edge cannot qualify on the
      // strength of its middle alone.
      const at = (t: number) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
      const probes = [at(0.25), at(0.5), at(0.75)];
      const covered = coveredBy.some(w =>
        probes.every(pt => pointToSegmentDistance(pt, w.start, w.end) < nearExisting));
      if (covered) continue;

      kept.push({ start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } });
    }

    // Run the loose ends into whatever they stop against, so no fence ends in
    // mid-air a few pixels from the frame.
    reachBoundaries(kept, coveredBy, grid.cellSize * REACH_BOUNDARY_CELLS);

    for (const seg of kept) {
      out.push({
        id: SEAL_PREFIX + (++_sealCounter),
        start: seg.start,
        end: seg.end,
        thickness: WALL_THICKNESS,
        createdAt: now,
      } as unknown as Wall);
    }
  }

  return out;
}

/**
 * Clear the player's fences and redraw the locked pockets' own outlines.
 *
 * The original version dropped every fence and kept only the locked CELLS
 * captured, leaving a tinted pocket floating in reopened space with no walls
 * around it. The two attempts after that tried to work out which of the
 * player's fences to keep, and where to cut them; both left walls running off
 * into space, because "is this fence part of that lock" is not a question a
 * proximity probe answers well.
 *
 * So no fence is kept. Every one shatters, and each locked pocket gets a fresh
 * outline built from its own traced boundary, straightened to the few corners
 * it really has. What is left on the board afterwards is exactly the pockets,
 * which is the whole promise of the ability.
 *
 * Returns false when there was nothing to clear, so the caller can decline to
 * spend the charge (see fireAbility).
 */
export function clearAllFences(game: CanvasGameState, callbacks: ClearFencesCallbacks): boolean {
  const grid = game.spaceGrid;
  if (!grid) return false;

  // 1. Locked ground: marked in grid.lockCaptured (>=1) or claimed by a won
  //    ball's assimilation, AND still captured.
  //
  //    That last condition is not belt-and-braces. Neither record is ever
  //    cleaned up: restoreCells leaves lockCaptured set, and assimilations are
  //    kept for the badge, so a pocket that has since REOPENED (by this very
  //    ability, or by a destructible breaking) stays marked forever. The board
  //    layer gets away with that because live space is painted over the top.
  //    Anything reading the marks directly does not, and without this filter the
  //    redraw grows walls around pockets that no longer exist, which is exactly
  //    what left fences standing in open board.
  const stillCaptured = (i: number) => grid.cells[i] === CellState.REMOVED;
  const locked = new Set<number>();
  const lockCap = grid.lockCaptured;
  if (lockCap) {
    for (let i = 0; i < lockCap.length; i++) if (lockCap[i] >= 1 && stillCaptured(i)) locked.add(i);
  }
  for (const a of game.assimilations.values()) {
    for (const idx of a.cellIndices) if (stillCaptured(idx)) locked.add(idx);
  }

  //    Then flood that across still-captured ground to the walls STANDING NOW,
  //    which is what turns a set of remembered cells into the actual pocket.
  //    Neither record covers the chamber: an assimilation holds the ball's
  //    region as it was, and lockCaptured is painted from a capture diff, so
  //    both miss the sealing fence's own raster band and any cells captured in
  //    an earlier pass (the acute tip of a wedge a ball never fit into). Left
  //    unflooded, those cells stay captured but untinted and unwalled: a dark
  //    fringe inside the pocket, which is exactly the "artifacts here and
  //    there". applyCut floods for the same reason when it paints the tint.
  if (locked.size > 0) {
    const seeds = [...locked];
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
    for (const idx of seeds) {
      const r = (idx / grid.width) | 0;
      const c = idx % grid.width;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
    }
    // Smallest ball still in play, so the flood is only blocked by a slit no
    // ball could have passed. A wider gate would wall off gaps a small ball
    // legitimately used, and under-fill the pocket again.
    const liveRadii = game.balls
      .filter(b => b.state !== "won" && b.state !== "dormant")
      .map(b => b.radius);
    const pad = 6;
    for (const idx of floodRemovedEnclosure(grid, seeds, game.walls, {
      bounds: {
        minCol: minCol - pad, maxCol: maxCol + pad,
        minRow: minRow - pad, maxRow: maxRow + pad,
      },
      minThroatWidth: 2 * (liveRadii.length > 0 ? Math.min(...liveRadii) : BASE_BALL_RADIUS),
    })) {
      locked.add(idx);
    }
  }

  // 2. Every player fence goes, including the outlines a previous press drew.
  //    Snapshot the walls first: the redraw projects each pocket's outline onto
  //    the lines that sealed it, so it needs them before they are gone.
  const snapTo = [...game.walls];
  const isFence = (w: Wall) =>
    !(w.isBoardEdge ?? w.id.startsWith("board-")) && !w.id.startsWith("obstacle-");
  const fences = game.walls.filter(isFence);
  if (fences.length === 0) return false;
  // A board already reduced to its pocket outlines has nothing left to clear;
  // redrawing the same walls would burn a charge for no visible change.
  if (fences.every(w => w.id.startsWith(SEAL_PREFIX))) return false;

  game.walls = game.walls.filter(w => !isFence(w));

  // Shatter them into flying shards (like the map-clear shatter), so they break
  // apart instead of just vanishing.
  const now = performance.now();
  const color = callbacks.fenceColor ?? "#00ff88";
  game.objectDebris ??= [];
  for (const w of fences.slice(0, MAX_FENCE_SHATTERS)) {
    game.objectDebris.push(spawnFenceShatter(w.start, w.end, color, now));
  }

  // 3. Redraw each pocket's outline and stand it back up.
  const seals = sealWallsFor(grid, locked, now, snapTo, game.walls);
  game.walls = [...game.walls, ...seals];

  // 3b. Close the gap between the outline and the cells it wraps.
  //
  //     The outline is straightened and snapped, so it does not follow the cell
  //     boundary exactly; at an acute tip it bows slightly wide of the locked
  //     cells, and the captured sliver between the two would be reopened and
  //     show as live space biting into the pocket.
  //
  //     Strictly a DILATION, capped at SLIVER_DEPTH_CELLS. The first version of
  //     this had no depth cap and trusted the seal ring plus a bounding box to
  //     contain it; one gap in the ring and it walked out and swallowed
  //     everything captured inside the box, merging two separate pockets into
  //     one blob across half the board. A sliver is one or two cells wide by
  //     construction, so the fill never needs to travel further than that, and
  //     capping the DISTANCE means the worst a gap can now cost is a two-cell
  //     fringe rather than the board. The throat gate and the box stay as well:
  //     three independent limits, because this one is only cosmetic and must
  //     never be able to do real damage.
  if (locked.size > 0 && seals.length > 0) {
    const seeds = [...locked];
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
    for (const idx of seeds) {
      const r = (idx / grid.width) | 0;
      const c = idx % grid.width;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
    }
    const liveRadii = game.balls
      .filter(b => b.state !== "won" && b.state !== "dormant")
      .map(b => b.radius);
    const pad = SLIVER_DEPTH_CELLS;
    for (const idx of floodRemovedEnclosure(grid, seeds, game.walls, {
      maxDepth: SLIVER_DEPTH_CELLS,
      bounds: {
        minCol: minCol - pad, maxCol: maxCol + pad,
        minRow: minRow - pad, maxRow: maxRow + pad,
      },
      minThroatWidth: 2 * (liveRadii.length > 0 ? Math.min(...liveRadii) : BASE_BALL_RADIUS),
    })) {
      locked.add(idx);
    }
  }

  // 3c. Make grid.lockCaptured agree with what was just drawn.
  //
  //     The two records of a lock disagree by design. applyCut only paints
  //     lockCaptured when the lock CAPTURED something, so a ball sealed into
  //     ground that was already captured is recorded in `assimilations` alone,
  //     and the tint for it never existed. Meanwhile neither record is ever
  //     cleaned, so both accumulate pockets that have since reopened.
  //
  //     The outline drawn above is the union, filtered to ground that is really
  //     still captured, which makes it the most accurate statement of where the
  //     locks are. Writing it back leaves the tint, the outline and the shadow
  //     mask reading the same thing, instead of three views disagreeing about
  //     which pockets exist.
  if (lockCap) {
    for (let i = 0; i < lockCap.length; i++) {
      if (locked.has(i)) lockCap[i] = Math.max(1, lockCap[i]); // keep the intensity
      else lockCap[i] = 0;                                     // a pocket that is gone
    }
  }

  // 4. Reopen every REMOVED cell that is inside the board, not inside a solid
  //    obstacle/mirror, and not preserved.
  const boardPoly = game.boardPolygon;
  const reopened: number[] = [];
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const idx = row * grid.width + col;
      if (grid.cells[idx] !== CellState.REMOVED || locked.has(idx)) continue;
      const wx = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const wy = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      const p = { x: wx, y: wy };
      if (boardPoly && !pointInPolygon(p, boardPoly)) continue; // board-outside margin
      let inSolid = false;
      for (const op of game.obstaclePolygons) if (pointInPolygon(p, op)) { inSolid = true; break; }
      if (!inSolid) for (const mp of game.mirrorPolygons) if (pointInPolygon(p, mp)) { inSolid = true; break; }
      if (inSolid) continue; // obstacle / mirror footprint
      reopened.push(idx);
    }
  }
  if (reopened.length > 0) {
    restoreCells(grid, reopened);
    // Register reopened cells as board-grid sample points so they render again,
    // but do NOT bump initialActiveCount: we WANT remaining % to rise (the reset).
    // Dedupe (issue #65): seal-band cells are already sampled, re-adding doubles
    // the grid squares there into a visible denser patch.
    pushReopenedSamplePoints(game, reopened);
  }

  // 5. Stand the outlines on real ground. A fence occupies the strip it is drawn
  //    over, and a real cut rasterises that strip at the moment it lands; these
  //    walls have to do the same or they are drawn over live space, which reads
  //    as a fence floating above the board. Done AFTER the reopen, so the strip
  //    is not simply handed straight back.
  for (const w of seals) {
    w.rasterCells = rasterizeCutToGrid(grid, w.start, w.end, w.thickness);
  }

  // 6. Re-seal anything still unreachable by an active ball (avoids uncapturable
  //    islands; won balls don't count), then rebuild regions + reassign balls.
  captureUnreachableCells(grid, game.balls, game.walls);
  rebuildRegionsKeepAll(game);

  callbacks.repaintRegionCanvas();
  callbacks.setRemainingPercent(Math.round(getRemainingPercent(grid)));
  return true;
}

// ── Magnet / Shockwave (one-shot velocity redirects) ─────────────────────────

/**
 * Magnet: redirect every active ball straight toward `target` (keeping its
 * speed), so they converge and cluster - a setup tool for a big multi-lock or
 * walling off a large empty region. One-shot. Target defaults to the board
 * centre; the player picks a point (the ability is `targeted`).
 */
export function magnetPull(game: CanvasGameState, target?: { x: number; y: number }): void {
  const c = target ?? boardCenter(game);
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    const sp = Math.hypot(b.velocity.x, b.velocity.y);
    if (sp <= 0) continue;
    let dx = c.x - b.position.x, dy = c.y - b.position.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) continue; // already at the centre
    dx /= d; dy /= d;
    b.velocity.x = dx * sp; b.velocity.y = dy * sp;
  }
}

const DEFAULT_SHOCKWAVE_BOOST = 1.25;

/**
 * Shockwave: redirect every active ball straight AWAY from the board centre,
 * scattering a cluster and driving balls toward the edges, with a small outward
 * speed kick (`boost`) so the burst reads clearly. One-shot. Balls sitting on
 * the centre get a varied outward direction.
 *
 * Crucially it also RE-ENERGISES a stalled ball: the outward speed is floored at
 * the ball's baseSpeed (times the boost), so a ball that has slowed to a crawl
 * is relaunched at full speed rather than nudged along at its dying pace. This
 * is what makes Shockwave the game's "get the balls moving again" safety valve.
 */
export function shockwavePush(game: CanvasGameState, boost = DEFAULT_SHOCKWAVE_BOOST): void {
  const c = boardCenter(game);
  game.balls.forEach((b, i) => {
    if (b.state !== "active") return;
    const cur = Math.hypot(b.velocity.x, b.velocity.y);
    const sp = Math.max(cur, b.baseSpeed || 100) * Math.max(1, boost);
    let dx = b.position.x - c.x, dy = b.position.y - c.y;
    let d = Math.hypot(dx, dy);
    if (d < 1) {
      // On the centre: fan out by index so a stacked cluster still spreads.
      const a = (i / Math.max(1, game.balls.length)) * Math.PI * 2;
      dx = Math.cos(a); dy = Math.sin(a); d = 1;
    }
    dx /= d; dy /= d;
    b.velocity.x = dx * sp; b.velocity.y = dy * sp; b.speed = sp;
  });
}

// ── Fence Overclock / Fence Shield (timed fence buffs) ────────────────────────

/** Start Fence Overclock: cuts build `factor`x faster (capped) for `seconds`. */
export function applyFenceRush(game: CanvasGameState, factor: number, seconds: number): void {
  game.abilityFenceRushUntil = game.activePlaySeconds + seconds;
  game.abilityFenceRushMult = factor;
}

/** Fence-growth-speed multiplier for the current frame (1 when inactive). Folded
 *  into updateFenceWall's growth speed; expires by the active-play clock. */
export function abilityFenceRushFactor(game: CanvasGameState): number {
  if (game.abilityFenceRushUntil !== undefined && game.activePlaySeconds < game.abilityFenceRushUntil) {
    return game.abilityFenceRushMult ?? 1;
  }
  return 1;
}

/** Start Fence Shield: the growing fence ignores ball hits for `seconds`. */
export function applyFenceShield(game: CanvasGameState, seconds: number): void {
  game.abilityFenceShieldUntil = game.activePlaySeconds + seconds;
}

/** True while a growing fence should phase through balls (Fence Shield active). */
export function abilityFenceShieldActive(game: CanvasGameState): boolean {
  return game.abilityFenceShieldUntil !== undefined && game.activePlaySeconds < game.abilityFenceShieldUntil;
}

// ── Visual feedback ───────────────────────────────────────────────────────────

/** How long the ability-fired flash/ring burst plays. */
const ABILITY_FX_MS = 650;

/**
 * Queue a full-board flash + ring burst so the player always sees the ability
 * fire, even when their situation shows no ball change. `expand` = rings grow
 * outward; false = converge inward (Magnet's gather).
 */
function pushAbilityFx(game: CanvasGameState, color: string, expand: boolean, now: number, center?: { x: number; y: number }): void {
  (game.abilityFx ??= []).push({ color, expand, startTime: now, durationMs: ABILITY_FX_MS, center: center ?? boardCenter(game) });
}

/**
 * Fire a TARGETED ability at a board point the player picked (Magnet). Runs the
 * effect toward `target` and plays the burst centred there. Returns false for a
 * non-targeted / unknown id.
 */
/**
 * Fire a Rubber Band: launch every ball it caught, and smash what it hit.
 *
 * Two effects from one gesture, and they are the same gesture on purpose. The
 * band is a slingshot, so what it catches it throws; and a band drawn tight
 * enough to throw a ball hard is drawn tight enough to break what is in front
 * of it. Pulling harder does both, which is what makes the stretch a decision
 * rather than a slider.
 *
 * The wager is on the way out, not the way in. Nothing damps a ball, so a
 * full-power band leaves a ball travelling at three times its base speed for
 * the rest of the map - very hard to fence, unless you have ice to slow it
 * down. That is the synergy: freeze and slow stop being panic buttons and
 * become the setup for this.
 *
 * Returns false when the band caught nothing at all, which the caller reads as
 * "spend no charge" - the same courtesy Descope already gets, and for the same
 * reason: a miss the player had no way to see coming should not cost them.
 */
export function fireRubberBand(
  game: CanvasGameState, shape: BandShape, now: number,
): boolean {
  let touched = 0;

  for (const ball of game.balls) {
    if (ball.state !== "active") continue;
    if (!inBandSweep(ball.position, shape)) continue;
    ball.velocity = bandVelocity(shape, ball.baseSpeed || 250);
    ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    touched++;
  }

  // Destructibles in the same sweep, damaged by how hard the band was drawn.
  // Scaled to each object's own budget, so full power really does break
  // anything rather than anything the author has not made tough yet.
  for (const d of game.destructibles) {
    if (d.destroyed) continue;
    const poly = d.obstaclePolygon ?? d.mirrorPolygon;
    if (!poly) continue;
    const c = polygonCentroid(poly);
    if (!inBandSweep(c, shape)) continue;
    // Debounced hits would swallow this: the band is one deliberate blow, not a
    // bounce, so it is applied directly rather than through registerObjectHit.
    d.hits = Math.min(d.maxHits, d.hits + bandDamage(shape.powerT, d.maxHits));
    d.lastHitAt = now;
    if (d.hits >= d.maxHits && !d.destroyed) {
      d.destroyed = true;
      if (!game.pendingDestroys.includes(d)) game.pendingDestroys.push(d);
    }
    touched++;
  }

  return touched > 0;
}

export function fireTargetedAbility(id: string, game: CanvasGameState, now: number, target: { x: number; y: number }): boolean {
  const def = getAbility(id);
  if (!def || !def.targeted) return false;
  if (def.kind === "magnet") {
    magnetPull(game, target);
    pushAbilityFx(game, def.color, false, now, target); // converge on the chosen point
    // A fading magnet icon marks exactly where the player pulled the balls to.
    game.magnetMarker = { x: target.x, y: target.y, startTime: now };
    return true;
  }
  if (def.kind === "descope") {
    // Returns false on a tap that hit nothing removable, which the caller reads
    // as "spend no charge". A miss that costs a charge would feel like theft:
    // the player cannot see the hit boxes, so a near-miss on a thin wall is not
    // a mistake they had the information to avoid.
    const removed = descopeAt(game, target.x, target.y);
    if (removed) pushAbilityFx(game, def.color, true, now, target);
    return removed;
  }
  if (def.kind === "slowArea") {
    // Placed and left there. Every other ability in the catalogue is a moment;
    // this one is a decision about the board that outlives the charge, so it
    // goes onto the map state rather than onto a countdown.
    (game.slowAreas ??= []).push(
      placeSlowArea(target.x, target.y, BOARD_WIDTH, def.size, def.factor),
    );
    pushAbilityFx(game, def.color, false, now, target);
    return true;
  }
  return false;
}

/**
 * Dispatch a pressed ability by id: look up its catalogue entry and run the
 * coded effect for its kind with that entry's params. Returns false for an
 * unknown id or kind.
 */
export function fireAbility(
  id: string,
  game: CanvasGameState,
  now: number,
  clearCallbacks: ClearFencesCallbacks,
): boolean {
  const def = getAbility(id);
  if (!def) return false;
  let fired = true;
  switch (def.kind) {
    case "freeze":
      freezeAllBalls(game, now, (def.durationSeconds ?? DEFAULT_FREEZE_SECONDS) * 1000);
      break;
    case "slow":
      applySlowAll(game, def.factor ?? DEFAULT_SLOW_FACTOR, def.durationSeconds ?? DEFAULT_SLOW_SECONDS);
      break;
    case "clearFences":
      // Declines when every fence is holding a lock: nothing would change, and
      // burning a charge for no effect is worse than the button not responding.
      fired = clearAllFences(game, clearCallbacks);
      break;
    case "magnet":
      magnetPull(game);
      break;
    case "shockwave":
      shockwavePush(game, def.factor ?? DEFAULT_SHOCKWAVE_BOOST);
      break;
    case "fenceRush":
      applyFenceRush(game, def.factor ?? DEFAULT_FENCE_RUSH_FACTOR, def.durationSeconds ?? DEFAULT_FENCE_RUSH_SECONDS);
      break;
    case "fenceShield":
      applyFenceShield(game, def.durationSeconds ?? DEFAULT_FENCE_SHIELD_SECONDS);
      break;
    case "slowArea":
    case "descope":
      // Targeted: they have no meaning without a point, so reaching here means
      // the arming step was skipped. Decline rather than act at the board
      // centre, which would spend the charge somewhere nobody chose.
      fired = false;
      break;
    default:
      fired = false;
  }
  // Always-visible feedback: a board flash + rings tinted by the ability. Magnet
  // converges (rings inward); everything else emanates outward.
  if (fired) pushAbilityFx(game, def.color, def.kind !== "magnet", now);
  return fired;
}
