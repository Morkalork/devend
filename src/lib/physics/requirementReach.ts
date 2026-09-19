/**
 * Can this map still be won, or has the board put a requirement out of reach?
 *
 * Two clauses already had this question answered for them, each in its own
 * place: a gate zone no ball can enter fails as `areaUnreachable`, and a needed
 * slab fenced off with nothing beside it fails as `objectiveBuried`. Both exist
 * because of the same complaint - the board shows no sign, the map simply stops
 * being winnable, and it runs on until the clock says something true and
 * useless about the clock.
 *
 * Every other clause was left without one, and level 2 is what that costs.
 *
 * ── Level 2, one cut ───────────────────────────────────────────────────────
 *
 * Its win is `splitLocks 1`: a ball sealed on each side of the midline. Close
 * the doorway between the halves with both balls on the left and the right half
 * has no ball in it, so it captures as claimed ground - and the right-hand lock
 * is now impossible, permanently, with both balls still bouncing and the board
 * looking perfectly playable.
 *
 * Nothing noticed. Worse, levels 1-3 are exempt from the map deadline by design
 * (mapTiming: the tutorial band plays without a clock), so there was not even a
 * timeout to end it. Measured before this existed: 100 seconds of play with the
 * far side gone and no win, no failure, no life lost. The only exit a player had
 * was to lock their last ball on the wrong side on purpose, which trips
 * `lockedOut`, and nothing on screen suggests that.
 *
 * ── One question, asked per clause ─────────────────────────────────────────
 *
 * Rather than a third bespoke check, this asks the thing all of them are asking:
 * WHERE does this clause need something to happen, and is that ground still
 * usable? That splits the union three ways.
 *
 *   BALL-REACH clauses need a ball to get somewhere: `splitLocks` (open ground
 *   on a side that still owes a lock), `delivered` (a box interior). A ball
 *   cannot cross into another region and cutting only ever SPLITS a region, so
 *   "shares a region with that ground" is the whole test - the same argument
 *   anyGateTargetCanReach is built on, and `area` still uses it there.
 *
 *   FENCE clauses need a fence drawn somewhere: `terminals` is lit by routing a
 *   fence through it, `harvested` by running one along the seam. Neither needs a
 *   ball; both need the ground to still be OPEN, because no fence can be drawn
 *   through claimed space.
 *
 *   COUNT clauses name no place at all: `locks`, `superiorLocks`, `lockType`,
 *   `allLocked`. They can only become impossible by running out of balls, and
 *   that state already has a truer reason than anything here could give -
 *   `lockedOut` fires the moment the last ball is sealed with the win unmet. A
 *   count check here would also have to model balls that have not SPAWNED yet
 *   (maxBalls fills over time), and a stranding check that is wrong about that
 *   takes a map the player was about to win.
 *
 * The switch is exhaustive over WinCondition, so a new clause kind does not
 * compile until someone has decided which of the three it is. That is the
 * point of doing this once rather than a fourth time.
 *
 * ── Every uncertainty resolves toward "keep playing" ───────────────────────
 *
 * This costs a life, so a false positive takes a map that was still winnable,
 * and a false positive that is true on the FIRST frame costs the whole run: the
 * overlay, the retry, the same first frame, again, until the lives are gone.
 * Level 8 did exactly that. So ground behind an unbroken reveal, or held off
 * the board by a delivery box that is still filling, or open ground no region
 * claims, all read as "cannot tell" and the map carries on. The caller adds the
 * other half of that guard: nothing here is consulted before the player has cut.
 */
import { CellState, worldToGridIndex, type SpaceGrid } from "@/lib/spaceGrid";
import { sealedPendingCells } from "@/lib/coloredAreas";
import { splitLine, splitLockCounts, evaluateWinCondition } from "@/lib/winSpec";
import type { WinCondition, WinSpec, WinSnapshot } from "@/types/winSpec";
import type { CanvasGameState } from "@/types/gameState";

/** What the grid says about a patch of ground a clause still needs. */
interface GroundReading {
  /** ACTIVE cells among the ones asked about. */
  active: number;
  /** Regions owning at least one of those cells. */
  owners: Set<string>;
  /** Something in there is not gone but not open either: do not conclude. */
  unknown: boolean;
}

function readGround(
  grid: SpaceGrid, cells: Iterable<number>, pending: ReadonlySet<number>,
): GroundReading {
  const owners = new Set<string>();
  let active = 0;
  for (const idx of cells) {
    if (grid.cells[idx] !== CellState.ACTIVE) {
      // Behind a reveal that has not broken, or reserved by a box still
      // filling: removed on the grid and not lost. A curtain is a door.
      if (pending.has(idx)) return { active: 0, owners, unknown: true };
      continue;
    }
    active++;
    const rid = grid.cellRegionIds[idx];
    if (rid !== null) owners.add(rid);
  }
  return { active, owners, unknown: false };
}

/** Is any of this ground still open, so a fence could be drawn through it? */
function groundStillOpen(
  grid: SpaceGrid, cells: Iterable<number>, pending: ReadonlySet<number>,
): boolean {
  const read = readGround(grid, cells, pending);
  return read.unknown || read.active > 0;
}

/**
 * Could any ball still get to this ground?
 *
 * Any ball not already locked away counts, the boss included. The gate's own
 * roster narrows to the boss on a boss map because only the boss satisfies a
 * ZONE; nothing here is that specific, and counting one more ball as able is
 * the safe direction for a check that costs a life.
 */
function ballCanReach(
  game: CanvasGameState, cells: Iterable<number>, pending: ReadonlySet<number>,
): boolean {
  const grid = game.spaceGrid;
  if (!grid) return true;
  const read = readGround(grid, cells, pending);
  if (read.unknown) return true;
  if (read.active === 0) return false;        // claimed ground: gone for good
  if (read.owners.size === 0) return true;    // open, but unowned: cannot tell

  for (const b of game.balls) {
    if (b.state === "won") continue;
    const idx = worldToGridIndex(grid, b.position.x, b.position.y);
    const rid = idx >= 0 && grid.cells[idx] === CellState.ACTIVE
      ? grid.cellRegionIds[idx] : null;
    if (rid === null) return true;            // cannot place this one: keep playing
    if (read.owners.has(rid)) return true;
  }
  return false;
}

/** Every cell whose centre lies on one side of a split line. */
function* halfCells(
  grid: SpaceGrid, axis: "vertical" | "horizontal", line: number, before: boolean,
): Generator<number> {
  const { width, height, originX, originY, cellSize } = grid;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const along = axis === "horizontal"
        ? originY + row * cellSize + cellSize / 2
        : originX + col * cellSize + cellSize / 2;
      // Matches splitLockCounts exactly: a point ON the line is the far side.
      if ((along < line) === before) yield row * width + col;
    }
  }
}

/** Every cell whose centre lies inside a world-space rectangle. */
function* rectCells(
  grid: SpaceGrid, r: { x: number; y: number; width: number; height: number },
): Generator<number> {
  const { width, height, originX, originY, cellSize } = grid;
  const c0 = Math.max(0, Math.floor((r.x - originX) / cellSize));
  const c1 = Math.min(width - 1, Math.floor((r.x + r.width - originX) / cellSize));
  const r0 = Math.max(0, Math.floor((r.y - originY) / cellSize));
  const r1 = Math.min(height - 1, Math.floor((r.y + r.height - originY) / cellSize));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) yield row * width + col;
  }
}

/** Every cell a disc of `radius` about a point touches. */
function discCells(
  grid: SpaceGrid, x: number, y: number, radius: number,
): Generator<number> {
  return rectCells(grid, {
    x: x - radius, y: y - radius, width: radius * 2, height: radius * 2,
  });
}

/** Cells along a seam segment, sampled at half a cell so none is stepped over. */
function* segmentCells(
  grid: SpaceGrid, a: { x: number; y: number }, b: { x: number; y: number },
): Generator<number> {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (grid.cellSize / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const idx = worldToGridIndex(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (idx >= 0) yield idx;
  }
}

/**
 * Ground that is off the board but not lost.
 *
 * A reveal's cells come back when it breaks; a delivery box's reserved cells
 * come back when it is full. Both read as removed and neither is gone.
 */
function pendingCells(game: CanvasGameState): Set<number> {
  const pending = sealedPendingCells(game.destructibles ?? []);
  for (const box of game.deliveryBoxes ?? []) {
    if (box.delivered >= box.capacity) continue;
    for (const idx of box.reservedCells ?? []) pending.add(idx);
  }
  return pending;
}

/**
 * Can this clause still be satisfied, given where the board is now?
 *
 * True is the answer that keeps the map running, so every case that cannot
 * decide returns true. `area` and `smashed` return true here and are checked by
 * their own guards in applyCut - they were built first, they carry rules this
 * cannot express (a gate's target roster, a slab's striking radius), and two
 * checks racing to fail the same map would only make the reason a coin toss.
 */
export function clauseStillPossible(
  game: CanvasGameState, c: WinCondition, snap: WinSnapshot,
): boolean {
  const grid = game.spaceGrid;
  if (!grid) return true;
  const pending = pendingCells(game);

  switch (c.kind) {
    case "splitLocks": {
      // Per SIDE, because that is what the clause is: a side already paid is
      // finished with, and a side still owing needs ground a ball can be
      // sealed in. How MANY balls could get there is deliberately not asked -
      // one pocket can take more than one ball, and balls still to spawn are
      // not on the board to count.
      const line = splitLine(c);
      const axis = c.axis === "horizontal" ? "horizontal" : "vertical";
      const [before, after] = splitLockCounts(c, snap.lockPoints);
      for (const side of [true, false]) {
        const paid = side ? before : after;
        if (paid >= c.count) continue;
        if (!ballCanReach(game, halfCells(grid, axis, line, side), pending)) return false;
      }
      return true;
    }

    case "delivered": {
      // Boxes a ball can still get into, counted by what they have left to
      // take. A box sealed away with its mouth in claimed ground can never be
      // filled again, and the clause survives only if the others can cover it.
      const boxes = game.deliveryBoxes ?? [];
      // A map whose boxes cannot hold what it asks for was unwinnable before
      // the player touched it. That is an authoring fault - winSpecProblems
      // refuses it and the builder flags it - and failing someone for it would
      // report their cut as the cause of a map that never had a chance. The
      // same argument smashRequirementLost makes about a map with no
      // breakables, and the same conclusion: nothing can be LOST that was never
      // there.
      if (boxes.reduce((n, b) => n + b.capacity, 0) < c.count) return true;
      let reachable = snap.delivered;
      for (const box of boxes) {
        const room = box.capacity - box.delivered;
        if (room <= 0) continue;
        if (ballCanReach(game, rectCells(grid, box.inner), pending)) reachable += room;
      }
      return reachable >= c.count;
    }

    case "terminals": {
      // Lit by a fence, so the question is whether the terminal's ground is
      // still open. Its radius is what a fence has to reach, so the whole disc
      // counts: a terminal with one open cell under it is still lightable.
      const terminals = game.circuit?.terminals ?? [];
      if (terminals.length < c.count) return true;   // never possible: see `delivered`
      let possible = 0;
      for (const t of terminals) {
        if (t.lit || groundStillOpen(grid, discCells(grid, t.x, t.y, t.radius), pending)) {
          possible++;
        }
      }
      return possible >= c.count;
    }

    case "harvested": {
      // Same shape as terminals: a seam span is harvested by drawing a fence
      // along it, so a span whose ground is entirely claimed is spent.
      const stream = game.dataStream;
      // Spans, not points: a path of N points has N-1 of them.
      if (!stream || stream.path.length - 1 < c.count) return true;  // see `delivered`
      let possible = 0;
      for (let i = 0; i < stream.path.length - 1; i++) {
        if (stream.harvested[i]
            || groundStillOpen(grid, segmentCells(grid, stream.path[i], stream.path[i + 1]), pending)) {
          possible++;
        }
      }
      return possible >= c.count;
    }

    // Checked by their own guards in applyCut, which came first and know more.
    case "area":
    case "smashed":
      return true;

    // No place to lose. A count runs out of BALLS, never out of board, and
    // that ending is lockedOut's to report (see the header).
    case "locks":
    case "superiorLocks":
    case "lockType":
    case "allLocked":
      return true;

    // Not losable: space only ever goes down, the boss is a ball the map keeps
    // alive, and a limit clause is met until it is blown.
    case "space":
    case "boss":
    case "underPar":
    case "speedClear":
      return true;
  }
}

/**
 * The first requirement this board can no longer satisfy, or null.
 *
 * Only `require` clauses: an alternative is a door the player chose not to take,
 * and failing a map because a door closed would be a rule nobody was playing by.
 * Met clauses are skipped rather than re-proved - `splitLocks` is satisfied by
 * where the locks ALREADY are, and ground going away afterwards takes nothing
 * back.
 */
export function lostRequirement(
  game: CanvasGameState, spec: WinSpec, snap: WinSnapshot,
): WinCondition | null {
  for (const c of spec.require) {
    if (evaluateWinCondition(c, snap).met) continue;
    if (!clauseStillPossible(game, c, snap)) return c;
  }
  return null;
}
