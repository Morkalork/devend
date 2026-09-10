/**
 * regionContour — trace smooth outlines around the ACTIVE area of the space grid.
 *
 * The captured-territory fill used to be stamped cell-by-cell (15px world cells)
 * as axis-aligned rectangles, so every cut/obstacle boundary was a hard 90deg
 * staircase — the "pixelated" look. Instead we trace the boundary between ACTIVE
 * and non-ACTIVE cells as closed loops, then round the corners with Chaikin
 * corner-cutting. Straight runs (including the board perimeter) stay straight,
 * because corner-cutting leaves points that are still collinear on the line;
 * only genuine direction changes — the stair steps of a diagonal cut — get
 * rounded, collapsing the staircase into a smooth diagonal.
 *
 * This runs at repaint time (on a cut/break/resize), never per frame, so the
 * O(cells) trace + smoothing is free at runtime.
 */

import { SpaceGrid, CellState } from "@/lib/spaceGrid";

export interface ContourPoint {
  x: number;
  y: number;
}

/** Predicate: is cell (col,row) part of the area being outlined? */
export type CellInside = (col: number, row: number) => boolean;

/** Chaikin passes. 2 rounds staircases cleanly while keeping the board edges
 * straight (they stay collinear) and the four board corners rounded by only
 * ~one cell — imperceptible on a full-size board. Bump for a softer look. */
const SMOOTH_ITERATIONS = 2;

/**
 * Trace every closed contour separating ACTIVE cells from non-ACTIVE cells
 * (removed/obstacle/outside), in world coordinates. Outer boundaries and the
 * holes inside them are all returned as separate loops; fill the whole set with
 * the even-odd rule to paint (or, via destination-out, to punch) the ACTIVE area
 * with interior holes correctly preserved.
 */
export function traceActiveContours(grid: SpaceGrid): ContourPoint[][] {
  const { cells, width } = grid;
  return traceContours(grid, (col, row) => cells[row * width + col] === CellState.ACTIVE);
}

/**
 * Trace smooth closed contours around every cell the `inside` predicate accepts.
 * Same machinery as traceActiveContours, but usable for any grid subset (e.g.
 * the lock-captured cells that get an accent tint). Out-of-bounds counts as
 * outside; the predicate is only ever called for in-bounds cells.
 */
export function traceContours(grid: SpaceGrid, inside: CellInside): ContourPoint[][] {
  const { width: w, height: h, cellSize, originX, originY } = grid;

  const active = (col: number, row: number): boolean =>
    col >= 0 && row >= 0 && col < w && row < h && inside(col, row);

  // Corner lattice is (w+1) x (h+1); key a corner (cx,cy) as cy*stride+cx.
  const stride = w + 1;
  // tailKey -> list of head corner keys. A well-formed cell-set boundary is a
  // set of closed loops; a diagonal pinch point yields two out-edges at one
  // corner (handled by walking whichever is still unused).
  const outEdges = new Map<number, number[]>();
  let edgeCount = 0;
  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const tk = ay * stride + ax;
    const hk = by * stride + bx;
    const arr = outEdges.get(tk);
    if (arr) arr.push(hk);
    else outEdges.set(tk, [hk]);
    edgeCount++;
  };

  // For each inside cell, emit the sides that border a non-inside neighbour,
  // directed clockwise around the cell so shared interior sides cancel and the
  // remaining boundary sides chain into closed loops.
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!active(col, row)) continue;
      if (!active(col, row - 1)) addEdge(col, row, col + 1, row); // top:    L->R
      if (!active(col + 1, row)) addEdge(col + 1, row, col + 1, row + 1); // right:  T->B
      if (!active(col, row + 1)) addEdge(col + 1, row + 1, col, row + 1); // bottom: R->L
      if (!active(col - 1, row)) addEdge(col, row + 1, col, row); // left:   B->T
    }
  }

  const toWorld = (k: number): ContourPoint => {
    const cx = k % stride;
    const cy = (k - cx) / stride;
    return { x: originX + cx * cellSize, y: originY + cy * cellSize };
  };

  const loops: ContourPoint[][] = [];
  const guardMax = edgeCount + 8;
  for (const [startTail, heads] of outEdges) {
    while (heads.length > 0) {
      const keys: number[] = [startTail];
      let head = heads.pop()!;
      let guard = guardMax;
      while (head !== startTail && guard-- > 0) {
        keys.push(head);
        const nexts = outEdges.get(head);
        if (!nexts || nexts.length === 0) break; // malformed loop; bail
        head = nexts.pop()!;
      }
      if (keys.length >= 3) loops.push(smooth(keys.map(toWorld)));
    }
  }
  return loops;
}

/** The bounding lines contours may snap to (fences, board edges, obstacles). */
export interface WallSegment {
  start: ContourPoint;
  end: ContourPoint;
}

/**
 * Pull contour points onto the wall lines that bound them.
 *
 * A traced contour lives on the 15px cell lattice: along a sealing fence its
 * edge lands wherever the lattice happens to fall, up to ~a cell away from the
 * fence's actual 6px line — visible as a seam between the lock tint and the
 * wall (the "fuzzy line" mismatch). Projecting every point that sits within
 * `maxDist` of a wall segment onto that segment makes the fill flush with the
 * line it stops at; the wall's own stroke (drawn over the tint) then covers
 * the boundary completely. Points near no wall (interior lattice detail) are
 * untouched. Runs at repaint/lock time only, never per frame.
 *
 * ── Why the pull has to FADE (`fullDist`) ───────────────────────────────────
 *
 * An all-or-nothing projection tears the outline it is supposed to tidy. The
 * contour arrives from Chaikin with its points a quarter of a cell apart, and
 * two neighbours that close together can still straddle the `maxDist` cutoff:
 * one is displaced by nearly the whole reach, the other not at all, and the
 * edge between them becomes a notch as long as the reach itself. Reported as
 * "artifacts on the board" after a diagonal cut on level 6, where a contour
 * with no raw gap wider than 3.8 came out with four gaps of 14 to 30.
 *
 * Diagonal fences show it worst, and that is not a coincidence: `maxDist` was
 * widened to 1.8 cells precisely to catch the corners a diagonal cut leaves
 * behind, and the notch a straddling pair produces is exactly that reach.
 * Every widening of the reach to fix teeth was also a widening of the tear.
 *
 * So the pull is full strength only within `fullDist` and smoothsteps to
 * nothing at `maxDist`. Neighbours that sit either side of a threshold now get
 * near-identical treatment, because the treatment no longer has a step in it.
 * `fullDist` still has to cover the points that genuinely belong on the wall -
 * half a fence's thickness plus the lattice's own half-diagonal, ~0.9 cells -
 * or the teeth come straight back.
 *
 * Defaults to `maxDist`, which collapses the fade and reproduces the hard
 * cutoff exactly. That default is deliberate: three of the four callers feed
 * these loops to GAME LOGIC (lock polygons, sealed-region tests, ability
 * sweeps), and moving their geometry moves what the rules decide. Only the
 * renderer, whose loops are looked at rather than reasoned about, opts in.
 */
export function snapContoursToWalls(
  loops: ContourPoint[][],
  walls: WallSegment[],
  maxDist: number,
  /**
   * How points near a wall's END are treated.
   *
   * "clamp" (default) pulls them onto the endpoint, which is what a lock-flash
   * pocket wants: its tint must sit flush right into the corners of the fence
   * that sealed it.
   *
   * "segment" leaves them alone unless the perpendicular foot is genuinely ON
   * the wall. Clamping collapses a whole neighbourhood of contour points onto
   * one endpoint, and a loop that visits the same position repeatedly jumps
   * back and forth across the board, drawing long chords - which is what the
   * whole-board outline showed as green lines fanning over the map. A big
   * outline spanning many walls has far more endpoints to collapse onto than a
   * small pocket does, which is why it only bit there.
   */
  endpoints: "clamp" | "segment" = "clamp",
  /**
   * Distance within which a point is projected ALL the way onto the wall.
   * Between here and `maxDist` the pull smoothsteps to nothing. Defaulting to
   * `maxDist` leaves no room to fade, i.e. the original hard cutoff.
   */
  fullDist: number = maxDist,
): ContourPoint[][] {
  if (walls.length === 0 || maxDist <= 0) return loops;
  const maxSq = maxDist * maxDist;
  // A caller that left `fullDist` alone gets the original hard tests, exactly.
  const fading = fullDist < maxDist;
  return loops.map(loop => {
    const moved = loop.map(p => {
      let best: ContourPoint | null = null;
      let bestSq = maxSq;
      let bestFade = 1;
      for (const w of walls) {
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) continue;
        let t = ((p.x - w.start.x) * dx + (p.y - w.start.y) * dy) / lenSq;
        // How much of this wall's pull survives the point sitting past an end.
        let endFade = 1;
        if (t < 0 || t > 1) {
          if (endpoints !== "segment") {
            t = t < 0 ? 0 : 1;
          } else if (!fading) {
            continue;
          } else {
            // The second hard switch, and the one left over after the distance
            // fade went in: a point whose foot lands a hair past the end got
            // nothing while its neighbour a quarter cell along got the lot.
            // Fade over the OVERSHOOT too, and keep the foot on the wall's
            // infinite line rather than clamping it - clamping is what
            // collapses a neighbourhood onto one endpoint, which is the whole
            // reason "segment" exists.
            const over = (t < 0 ? -t : t - 1) * Math.sqrt(lenSq);
            if (over >= fullDist) continue;
            endFade = snapPull(over, 0, fullDist);
          }
        }
        const qx = w.start.x + t * dx;
        const qy = w.start.y + t * dy;
        const dSq = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy);
        if (dSq < bestSq) {
          bestSq = dSq;
          best = { x: qx, y: qy };
          bestFade = endFade;
        }
      }
      if (!best) return p;
      const pull = snapPull(Math.sqrt(bestSq), fullDist, maxDist) * bestFade;
      if (pull >= 1) return best;
      if (pull <= 0) return p;
      return {
        x: p.x + (best.x - p.x) * pull,
        y: p.y + (best.y - p.y) * pull,
      };
    });
    return fading ? relaxAlongLoop(loop, moved) : moved;
  });
}

/**
 * Passes of [1,2,1]/4 over the displacement, around the closed loop.
 *
 * Two is enough to average a lone disagreeing point back down into its
 * neighbours; more starts rounding off the ends of a genuine straight run
 * against a wall.
 */
const RELAX_PASSES = 2;

/**
 * Smooth the DISPLACEMENT along the loop, not the loop.
 *
 * Fading the pull fixes a point disagreeing with its neighbour about how much
 * of one wall's pull to take. It cannot fix them disagreeing about WHICH wall:
 * every point takes the nearest, and two neighbours a quarter cell apart can
 * have different nearest walls and be dragged in opposite directions. That was
 * the spike left over in the claim flash after the fade went in, and it is why
 * the flashes showed it worst - they snap to every wall on the board (edges and
 * obstacles included), so there are far more ways for neighbours to disagree
 * than the board outline has, snapping to fences alone.
 *
 * The correction applied to a smooth outline should itself be smooth, so the
 * displacement gets averaged along the loop. Where a long run sits against one
 * wall every point there has the same displacement and this changes nothing, so
 * flush stays flush; all it softens is the handful of points at a transition,
 * which is exactly where the spikes were.
 */
function relaxAlongLoop(
  original: ContourPoint[], moved: ContourPoint[],
): ContourPoint[] {
  const n = original.length;
  if (n < 3) return moved;
  let dx = new Float64Array(n);
  let dy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    dx[i] = moved[i].x - original[i].x;
    dy[i] = moved[i].y - original[i].y;
  }
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? n - 1 : i - 1;
      const b = i === n - 1 ? 0 : i + 1;
      nx[i] = (dx[a] + 2 * dx[i] + dx[b]) / 4;
      ny[i] = (dy[a] + 2 * dy[i] + dy[b]) / 4;
    }
    dx = nx;
    dy = ny;
  }
  return original.map((p, i) => ({ x: p.x + dx[i], y: p.y + dy[i] }));
}

/**
 * How hard a point `d` from its wall is pulled onto it: 1 inside `full`,
 * smoothstepped to 0 at `max`.
 *
 * Smoothstep rather than a straight ramp because what has to stay small is the
 * DIFFERENCE between neighbours, and a linear fade still has a corner at each
 * end where two points a quarter-cell apart get visibly different pulls.
 */
export function snapPull(d: number, full: number, max: number): number {
  // `max` first, so `full === max` (no fade band) reads as the hard cutoff it
  // is meant to reproduce rather than as "everything is inside".
  if (d >= max) return 0;
  if (d <= full) return 1;
  const t = (max - d) / (max - full);
  return t * t * (3 - 2 * t);
}

/**
 * Full-strength reach of the outline snap, in cells.
 *
 * Has to cover everything that genuinely belongs on a fence: half its 6px
 * thickness plus the lattice's own half-diagonal (a contour tracking a
 * diagonal cut steps through cell CORNERS, up to ~0.7 cells off the line).
 * Below this, the teeth a diagonal cut leaves behind come back.
 */
const OUTLINE_SNAP_FULL_CELLS = 1.0;

/**
 * Where the outline snap has faded to nothing, in cells.
 *
 * The gap between this and the full-strength reach IS the fade, so the two
 * cannot be tuned apart: narrowing the band makes the pull drop off faster,
 * and a faster drop-off is a bigger step between neighbouring points. The lock
 * contours used to ask for 1.05 with no band at all, which is what made their
 * flashes throw spikes.
 */
const OUTLINE_SNAP_REACH_CELLS = 1.8;

/**
 * The snap every OUTLINE gets: live space, the persistent lock tint, and both
 * flashes.
 *
 * One function because those four are the same picture drawn at different
 * moments, and they had drifted - the flashes hugged pockets at 1.05 cells in
 * "clamp" mode while the board outline reached 1.8 in "segment", so a tint and
 * the flash celebrating it could disagree about where the pocket's edge was.
 * Anything that is LOOKED at goes through here. Anything the RULES read calls
 * snapContoursToWalls directly and keeps its own reach, because moving that
 * geometry moves what the rules decide.
 */
export function snapOutlineToWalls(
  loops: ContourPoint[][],
  walls: WallSegment[],
  cellSize: number,
): ContourPoint[][] {
  return snapContoursToWalls(
    loops, walls,
    cellSize * OUTLINE_SNAP_REACH_CELLS,
    "segment",
    cellSize * OUTLINE_SNAP_FULL_CELLS,
  );
}

function smooth(loop: ContourPoint[]): ContourPoint[] {
  let pts = loop;
  for (let i = 0; i < SMOOTH_ITERATIONS; i++) pts = chaikin(pts);
  return pts;
}

/** One Chaikin corner-cutting pass on a closed loop (1/4, 3/4 split). */
function chaikin(pts: ContourPoint[]): ContourPoint[] {
  const n = pts.length;
  const out: ContourPoint[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    out[i * 2] = { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 };
    out[i * 2 + 1] = { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 };
  }
  return out;
}

/**
 * Contours of territory locked at least `tier` deep, snapped to the fences that
 * seal it.
 *
 * One place, because two callers need exactly the same loops and must not
 * drift: the lock TINT draws them once per tier so overlapping passes read as
 * brighter, and the shadow mask punches them out so nothing casts onto ground
 * that has already been won.
 *
 * The mask caller must pass tier 1 and only tier 1. Under the even-odd rule a
 * tier-2 loop drawn inside its own tier-1 loop cancels back to visible, so
 * punching the tiers separately would put the shadows straight back into the
 * pockets that were locked hardest.
 *
 * Contours get the shared outline snap, same as live space and both flashes.
 * They used to ask for a tighter 1.05-cell reach in "clamp" mode, on the
 * reasoning that a wide reach drags pocket points into long stray chords. The
 * dragging was real; the reach was not what caused it. A reach with no fade
 * band tears an outline wherever two neighbours straddle its cutoff, and the
 * tighter the reach the LESS room there is to fade across - so tightening it
 * made the spikes shorter without making them any rarer.
 */
export function traceLockContours(
  grid: SpaceGrid,
  walls: WallSegment[],
  tier = 1,
): ContourPoint[][] {
  const lock = grid.lockCaptured;
  if (!lock) return [];
  const gw = grid.width;
  return snapOutlineToWalls(
    traceContours(grid, (col, row) => lock[row * gw + col] >= tier),
    walls,
    grid.cellSize,
  );
}
