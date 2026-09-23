/**
 * Destructible objects.
 *
 * - Mirrors & movers (issue #37): broken only by the black ball.
 * - Breakable obstacles (issue #38): broken by ANY ball (black counts double),
 *   and they're often the level's objective. When a support breaks, whatever
 *   rests on it topples — falling toward the board bottom and shattering.
 *
 * updateBall registers hits and queues finished objects in game.pendingDestroys;
 * the game loop calls processDestroysFn after the physics step (removal rebuilds
 * regions, too heavy to do per step). Removed obstacles RE-OPEN their footprint
 * as capturable space.
 */
import { CanvasGameState } from "@/types/gameState";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import {
  DestructibleState,
  ObjectDebrisState,
  ObjectDebrisParticle,
  FallingObject,
  Region,
  Vector2,
  Ball,
} from "@/types/game";
import { getBallType } from "@/lib/ballTypes";
import { resumeDrillThrough } from "@/lib/physics/drill";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { getRunRng } from "@/lib/runRng";
import { spawnRubble } from "@/lib/physics/rubble";
import { makeChestLoot } from "@/lib/chests";
import { rollCappedAbilityReward } from "@/lib/abilities";
import { Polygon, pointInPolygon, polygonCentroid, pointToSegmentDistance } from "@/lib/polygon";
import {
  CellState,
  restoreCells,
  findGridRegions,
  getRemainingPercent,
  getRegionCellPositions,
  gridIndexToWorld,
  captureUnreachableCells,
  obstacleSealReach,
} from "@/lib/spaceGrid";
import { buildPolygonFromSamples } from "@/lib/regionSplit";
import { reassignBallsToRegions, paintCellRegionIds } from "@/lib/regionOwnership";
import { generateRegionId } from "@/lib/gameUtils";
import { wasteCapturedPickups } from "@/lib/pickups";
import { simNow } from "@/lib/simClock";

export const DESTRUCTIBLE_MAX_HITS = 3;
const HIT_DEBOUNCE_MS = 250;     // one ball pass can't count as multiple hits
const DEBRIS_DURATION_MS = 650;
// Per-hit chip burst, shorter than the full shatter. 520ms was long enough to
// exist and short enough to miss if you were watching the ball rather than the
// wall it just hit, which is where a player's eyes actually are.
const CHIP_DURATION_MS = 700;
const MAX_OBJECT_DEBRIS = 48;    // soft cap so rapid hits can't pile debris up
const FALL_DURATION_MS = 750;
const FALL_SPEED = 180;          // initial downward speed of toppling objects
const MIRROR_DEBRIS_COLOR = "#88ddff";
const MOVER_DEBRIS_COLOR = "#ff8800";
const BREAKABLE_DEBRIS_COLOR = "#ffb454";
const OBSTACLE_FALL_COLOR = "#9aa3ad";
// Bonus overtime hours for smashing a breakable (objective targets are worth
// more). Hours, and so quartered with the rest of the economy
// (src/lib/economyDeflation.ts) rather than left at the 5/10 the YAML sweep
// could not see; the 1:2 ratio between them is exact either way. These reach
// the player only through the level-complete screen's legacy fallback sum
// today, Engagement having taken over the paying, so this is about the number
// shown being in the currency shown.
const BREAK_BONUS_BASE = 1;
const BREAK_BONUS_OBJECTIVE = 2;
// Demolition multiplier: each smash compounds the map's pre-cap payout by this,
// offsetting the ship-early time sacrificed to break things (issue #38).
export const BREAK_MULTIPLIER_PER = 1.15;
/**
 * Wear steps a slab shows on its way to breaking, and the cap on its scars.
 *
 * A scar is cut when the slab loses another 1/MAX_DENTS of its integrity, not
 * when it is touched. That is the difference between damage that ADDS UP and
 * damage that wanders: this used to keep the six most recent CONTACTS and drop
 * the oldest, so a slab taking a long rally of small chips healed its first
 * bite to make room for its seventh, and the deformation appeared to move
 * around the slab rather than accumulate. Reported as "they just deform
 * slightly after the first hit and the deformation just moves around".
 *
 * Six also bounds the list without any dropping, because a slab can only cross
 * six sixths of its own integrity.
 */
const MAX_DENTS = 6;

// ── Physics-based impact damage (issue #38 force model) ──────────────────────
// damage = k · mass · vₙ^EXP, with mass = density · (radius/BASE)² and vₙ the
// ball's closing speed along the surface normal. Calibrated so a standard ball
// (density 1, base radius) striking head-on at NOMINAL_SPEED does ~1.0 damage,
// so a breakable authored with `maxHits: 3` still feels like "about three solid
// hits" - but a fast or heavy smash breaks it in fewer, a weak graze in more.
// This fully replaces the old flat 1-hit-per-touch model (it wasn't physical).
const NOMINAL_SPEED = 250;       // red/blue baseSpeed = the reference solid hit
const DAMAGE_EXP = 1.6;          // >1 so speed matters more than linearly
const DAMAGE_K = 1 / Math.pow(NOMINAL_SPEED, DAMAGE_EXP);
const MIN_CHIP_DAMAGE = 0.15;    // a crawling graze still chips a little
/**
 * Most damage one contact can do, however fast the ball was going.
 *
 * Was 2.0, on the reasoning that "one rocket can't trivialise everything" - and
 * the ladder's ordinary slab is authored at 3, so the cap said in effect that
 * NO ball, at any speed, may break a slab in one. That is the wrong half of the
 * trade to protect: a fast ball is hard to fence around and hard to lock, and
 * the compensation for living with one has to be worth something. Reported as
 * exactly that.
 *
 * At 3.0 the arithmetic works out to about 495 units/s head-on for a standard
 * ball (mass 1) to take a 3-hit slab in one contact, which is nearly twice the
 * red/blue base speed - reachable off a bumper, a Scope Creep rally or a
 * purple, and never by accident.
 */
const MAX_HIT_DAMAGE = 3.0;

/** Relative mass of a ball: density × (radius / base radius)². */
export function ballMass(ball: Ball): number {
  const density = getBallType(ball.typeId)?.density ?? 1;
  const r = ball.radius / BASE_BALL_RADIUS;
  return density * r * r;
}

/**
 * Damage one impact deals to a breakable, from the ball's mass and its closing
 * speed along the surface normal (a glancing hit does less than a head-on one).
 */
export function ballImpactDamage(ball: Ball, normalSpeed: number): number {
  const raw = DAMAGE_K * ballMass(ball) * Math.pow(Math.max(0, normalSpeed), DAMAGE_EXP);
  return Math.max(MIN_CHIP_DAMAGE, Math.min(MAX_HIT_DAMAGE, raw));
}

/**
 * Closing speed, along the surface normal, at which a ball stops bouncing off
 * something it has just destroyed and carries straight on through it.
 *
 * Asked for as "if it is really fast, it should go straight through an object
 * as it breaks (not otherwise)", and both halves of that are the rule:
 *
 *   AS IT BREAKS   the contact has to be the one that spends the object's last
 *                  integrity. A ball that merely dents a slab bounces off it
 *                  like anything else, whatever its speed.
 *   REALLY FAST    420 is 1.7x the red/blue base and well past what a rally
 *                  produces on its own, so this is a thing that happens to a
 *                  ball somebody made fast rather than a thing that happens.
 *
 * It is where SPEED finally means something on a brittle brick. Act I's runs go
 * on one contact whatever the force model says (see `d.brittle` in
 * registerObjectHit), so the damage curve - the game's whole answer to "does a
 * fast ball hit harder" - has no effect on them at all: a crawling graze and a
 * rocket both take exactly one brick. A rocket takes one and keeps going.
 */
const PUNCH_THROUGH_SPEED = 420;

/**
 * Should a ball that just destroyed something carry on through it?
 *
 * Speed only, deliberately, though mass is right there in the damage model: two
 * conditions a player can hold in their head ("fast" and "it broke") beat three
 * that are individually more physical, and the mass already decided whether the
 * thing broke at all.
 */
export function punchesThrough(normalSpeed: number): boolean {
  return normalSpeed >= PUNCH_THROUGH_SPEED;
}

/**
 * How long a ball stays intangible to the thing it just punched through, in ms.
 *
 * Long enough to cover the rest of the step and the one after it - the wreck is
 * cleared by processDestroys at the end of the frame - and short enough that it
 * can never be mistaken for a mechanic: nothing else on the board is affected,
 * and the ball is solid again before it has crossed a ball's width at speed.
 */
export const PUNCH_THROUGH_GRACE_MS = 120;

/** Is this ball still passing through the wreck of something it destroyed? */
export function punchingThrough(
  ball: { punchThroughId?: string; punchThroughUntil?: number }, now: number,
): boolean {
  return ball.punchThroughId !== undefined
    && ball.punchThroughUntil !== undefined
    && now < ball.punchThroughUntil;
}

/** Map a hit's damage to a dent depth/size multiplier (~0.5 chip .. ~1.3 smash). */
function dentStrength(damage: number): number {
  return 0.5 + Math.min(1, damage / 1.5) * 0.8;
}

/**
 * How much deeper a scar cuts for being a LATE one.
 *
 * A slab one hit from breaking should not be wearing six bites of the same
 * size as its first. Scaling with how far gone it already is makes the last
 * scars the ones that take real chunks out, so the silhouette degrades faster
 * than linearly and "nearly dead" is readable from the shape alone.
 */
/**
 * Damage below which a contact wears a slab but knocks nothing off it.
 *
 * The chip floor is 0.15 and a square hit is about 1.0, so this sits where a
 * glancing scrape stops and a real blow starts.
 */
const CHUNK_MIN_DAMAGE = 0.5;

/**
 * Largest hit budget a slab can have and still shed pieces.
 *
 * A slab is architecture or it is a block, and its budget says which. The
 * ladder's breakables are authored at 2 or 3 - things meant to come apart in a
 * rally - while level 15's launcher rail is 14, because a rail exists to be
 * RIDDEN and has to survive a ball grinding along it for a whole map.
 *
 * Rubble off a rail is not a near-miss, it is a contradiction: the lane a ball
 * rides is on the slab's outward side, which is exactly where a knocked-off
 * piece goes, so the rail kept firing deflectors into its own lane and the shot
 * bounced off its own debris instead of following the bend. Caught by
 * launcherRail.test.ts, which measures the fraction of a flight spent on the
 * rail and watched it fall by a third.
 */
const CHUNK_MAX_BUDGET = 6;

function wearDepth(fraction: number): number {
  return 0.75 + Math.max(0, Math.min(1, fraction)) * 1.05;
}

export interface DestroyCallbacks {
  repaintRegionCanvas: () => void;
  setRemainingPercent: (percent: number) => void;
  onObjectDestroyed?: () => void;
  /**
   * A chest was smashed and its reward is the player's. Fired at the smash, not
   * at some later collection: breaking the chest IS the interaction.
   */
  onChestReward?: (rewardId: string) => void;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export function findMirrorDestructible(game: CanvasGameState, polygon: Polygon): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'mirror' && !d.destroyed && d.mirrorPolygon === polygon);
}

export function findMoverDestructible(game: CanvasGameState, moverId: string): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'mover' && !d.destroyed && d.moverId === moverId);
}

export function findBreakableDestructible(game: CanvasGameState, polygon: Polygon): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'breakable' && !d.destroyed && d.obstaclePolygon === polygon);
}

/**
 * Find a mirror/breakable destructible by its obstacle id (parsed from the
 * `obstacle-<id>-edge-N` wall id). Obstacles are bounced by their edge walls,
 * so hit-detection keys off the wall, not the polygon.
 */
export function findObstacleDestructibleById(game: CanvasGameState, id: string): DestructibleState | undefined {
  return game.destructibles.find(d => (d.kind === 'mirror' || d.kind === 'breakable') && !d.destroyed && d.id === id);
}

/** Extract the obstacle id from an `obstacle-<id>-edge-<n>` wall id, or null. */
export function obstacleIdFromWallId(wallId: string): string | null {
  const m = /^obstacle-(.+)-edge-\d+$/.exec(wallId);
  return m ? m[1] : null;
}

/**
 * True if a fence anchored at either endpoint would rest against a breakable
 * structure — you can't fence against those (issue #38), so such a cut "duds".
 * Shared by the input handler (cancel) and the renderer (red preview).
 */
export function cutAnchorsBreakable(
  game: CanvasGameState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  tolerance: number,
): boolean {
  const near = (pt: { x: number; y: number }): boolean => {
    for (const d of game.destructibles) {
      if (d.kind !== 'breakable' || d.destroyed || !d.obstaclePolygon) continue;
      const v = d.obstaclePolygon.vertices;
      for (let i = 0; i < v.length; i++) {
        if (pointToSegmentDistance(pt, v[i], v[(i + 1) % v.length]) < tolerance) return true;
      }
    }
    return false;
  };
  return near(a) || near(b);
}

/**
 * Register a hit on a destructible. Debounced per object. `amount` lets the
 * black ball count double against breakable obstacles (issue #38). Queues the
 * object for destruction once its hit budget is spent.
 */
export function registerObjectHit(
  game: CanvasGameState,
  d: DestructibleState,
  ballId: string,
  now: number,
  amount = 1,
  impact?: { x: number; y: number },
): void {
  if (d.destroyed) return;
  if (d.lastHitAt && now - d.lastHitAt < HIT_DEBOUNCE_MS) return;
  d.lastHitAt = now;
  // A brittle brick goes on the first contact that counts, whatever the force
  // model says the contact was worth. The debounce above still applies, so
  // one pass is one hit; it is the DAMAGE floor that a brick ignores, not the
  // contact rule. Spent as a full budget rather than by flagging `destroyed`
  // directly so the dent, the chip burst and the destroy queue below all run
  // exactly as they do for a slab that took its last hit.
  if (d.brittle) amount = d.maxHits;
  // `amount` is now physics damage (a float), not a whole hit; the object
  // breaks once accumulated damage reaches its integrity budget (maxHits).
  d.hits = Math.min(d.maxHits, d.hits + amount);
  // Remember where it was struck (and how hard) so the border dents inward
  // there scaled by force, and shed a burst of chips for tactile feedback.
  let newScar = false;
  if (impact) {
    // A scar per WEAR STEP, never per contact, and never removed: see MAX_DENTS.
    // A slab always shows its first hit (ceil pins the first scar to any damage
    // at all), and can never show more scars than steps it has crossed.
    const fraction = d.maxHits > 0 ? d.hits / d.maxHits : 1;
    const want = Math.min(MAX_DENTS, Math.max(1, Math.ceil(fraction * MAX_DENTS)));
    d.dents ??= [];
    if (d.dents.length < want) {
      d.dents.push({
        x: impact.x, y: impact.y,
        s: dentStrength(amount) * wearDepth(fraction),
      });
      newScar = true;
    }
    // Non-fatal hits shed chips here; the fatal hit's full shatter (spawnDebris
    // in processDestroysFn) already covers the last one.
    if (d.hits < d.maxHits) {
      const poly = d.obstaclePolygon ?? d.mirrorPolygon;
      // Fling chips outward from the object centre through the impact, so they
      // read as flakes knocked off that face rather than a generic puff.
      let ax = 0, ay = -1;
      if (poly) {
        const c = polygonCentroid(poly);
        ax = impact.x - c.x; ay = impact.y - c.y;
        const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
      }
      const color = d.kind === 'mirror' ? MIRROR_DEBRIS_COLOR : BREAKABLE_DEBRIS_COLOR;
      game.objectDebris.push(spawnImpactChips(impact, ax, ay, color, now, amount));
      if (game.objectDebris.length > MAX_OBJECT_DEBRIS) game.objectDebris.shift();
      // A piece actually comes off, and it is still there afterwards
      // (physics/rubble.ts). Tied to the SCAR rather than to the contact, so
      // the rubble on the floor is the material the silhouette just lost
      // rather than a second, unrelated shower: one bite out of the slab, one
      // thing to trip over. A heavy hit sheds two.
      //
      // A BLOW sheds, a SCRAPE only wears, and a RAIL never sheds at all (see
      // both constants). Either way the surface still scars from what hit it,
      // which is right: a ridden rail should look worn. It just does not throw
      // lumps into the lane being ridden.
      if (newScar && amount >= CHUNK_MIN_DAMAGE && d.maxHits <= CHUNK_MAX_BUDGET) {
        spawnRubble(
          game, impact, ax, ay, color, now,
          getRunRng(`rubble:${d.id}:${d.dents?.length ?? 0}`),
          amount >= 1 ? 2 : 1,
        );
      }
    }
  }
  if (d.hits >= d.maxHits) {
    d.destroyed = true;       // stays in the world until processed this frame
    d.destroyedBy = ballId;
    game.pendingDestroys.push(d);
  }
}

// ── Collapse animation ──────────────────────────────────────────────────────

function spawnDebris(
  poly: Polygon,
  color: string,
  now: number,
  count = 16,
  scale = 1,
): ObjectDebrisState {
  const c = polygonCentroid(poly);
  const N = count;
  const verts = poly.vertices;
  const particles: ObjectDebrisParticle[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * verts.length;
    const vi = Math.floor(t) % verts.length;
    const vn = (vi + 1) % verts.length;
    const f = t - Math.floor(t);
    const px = verts[vi].x + (verts[vn].x - verts[vi].x) * f;
    const py = verts[vi].y + (verts[vn].y - verts[vi].y) * f;
    let dx = px - c.x, dy = py - c.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const speed = (70 + Math.random() * 160) * scale;
    particles.push({
      x: px,
      y: py,
      vx: dx * speed + (Math.random() - 0.5) * 40,
      vy: dy * speed + (Math.random() - 0.5) * 40,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 10,
      size: (5 + Math.random() * 11) * scale,
    });
  }
  return { startTime: now, durationMs: DEBRIS_DURATION_MS, color, particles };
}

/**
 * Shatter a fence line into flying shards: particles are seeded ALONG the
 * segment and fly off to either side (perpendicular) with a little spread, then
 * fall and fade like the object debris. Used by the Clear All Fences ability so
 * cleared fences break apart instead of vanishing (issue #38). Reuses the
 * ObjectDebris renderer in both renderers.
 */
export function spawnFenceShatter(start: Vector2, end: Vector2, color: string, now: number): ObjectDebrisState {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;   // unit along the fence
  const nx = -uy, ny = ux;              // unit perpendicular
  const N = Math.max(3, Math.min(18, Math.round(len / 22))); // ~one shard / 22 units
  const particles: ObjectDebrisParticle[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const side = Math.random() < 0.5 ? 1 : -1;
    const speed = 60 + Math.random() * 150;
    const along = (Math.random() - 0.5) * 70;
    particles.push({
      x: start.x + dx * t,
      y: start.y + dy * t,
      vx: nx * side * speed + ux * along,
      vy: ny * side * speed + uy * along - 20, // slight upward pop
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 12,
      size: 4 + Math.random() * 7,
    });
  }
  return { startTime: now, durationMs: DEBRIS_DURATION_MS, color, particles };
}

/**
 * A small burst of chips knocked off the struck face on a (non-fatal) hit.
 * `ax,ay` is the outward unit direction (object centre → impact); chips spray
 * in a cone around it with a slight upward pop, then fall under gravity.
 */
function spawnImpactChips(
  impact: Vector2,
  ax: number,
  ay: number,
  color: string,
  now: number,
  damage = 1,
): ObjectDebrisState {
  // Harder hits fling more chips (7 for a graze, up to ~16 for a heavy smash).
  // Raised from 4-10: on a phone the board renders at about 0.45 scale, and a
  // handful of sub-pixel flecks over half a second is not a thing anyone sees.
  const N = 7 + Math.round(Math.min(1, damage / 1.5) * 9);
  const base = Math.atan2(ay, ax);
  const particles: ObjectDebrisParticle[] = [];
  for (let i = 0; i < N; i++) {
    const ang = base + (Math.random() - 0.5) * 1.6; // ~±46° cone around outward
    const speed = 80 + Math.random() * 170;
    particles.push({
      x: impact.x + (Math.random() - 0.5) * 6,
      y: impact.y + (Math.random() - 0.5) * 6,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 30, // small upward pop; gravity reclaims them
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 12,
      // 5-12 world units. The old 3-9 floor put the smallest chips at 1.4px on
      // a phone, which is to say invisible, so half of every burst was wasted.
      // Still comfortably under the full-shatter debris.
      size: 5 + Math.random() * 7,
    });
  }
  return { startTime: now, durationMs: CHIP_DURATION_MS, color, particles };
}

function makeFalling(poly: Polygon, color: string, now: number): FallingObject {
  return {
    vertices: poly.vertices.map(v => ({ x: v.x, y: v.y })),
    color,
    startTime: now,
    durationMs: FALL_DURATION_MS,
    fallSpeed: FALL_SPEED,
  };
}

// ── Space / region rebuild ──────────────────────────────────────────────────

/**
 * Is this cell REMOVED by something other than the obstacle coming down?
 *
 * Three things, and the list is the whole point: a fence the player drew (its
 * grid band is the wall, and reopening across it would punch a hole in a seal
 * they earned), the outside of the board, and another solid. Anything else that
 * is REMOVED next to a destroyed obstacle is ground the obstacle itself was
 * holding shut.
 *
 * Rebuilt per call rather than cached because `game.walls` changes underneath
 * it - detachObstacle drops the obstacle's own edge walls before asking, which
 * is what stops the obstacle from counting as its own blocker.
 */
function heldByOther(
  game: CanvasGameState, grid: NonNullable<CanvasGameState["spaceGrid"]>,
): (p: Vector2) => boolean {
  return (p: Vector2): boolean => {
    for (const w of game.walls) {
      const corridor = (w.thickness ?? 6) / 2 + grid.cellSize / 2;
      if (pointToSegmentDistance(p, w.start, w.end) <= corridor) return true;
    }
    if (game.boardPolygon && !pointInPolygon(p, game.boardPolygon)) return true;
    for (const op of game.obstaclePolygons) if (pointInPolygon(p, op)) return true;
    for (const mp of game.mirrorPolygons) if (pointInPolygon(p, mp)) return true;
    return false;
  };
}

/**
 * The space the obstacle was sealing off, not just the space it stood on.
 *
 * Reported from a real session: one fence, and the ground beyond a breakable
 * read as locked - then breaking the breakable did not give it back, and the
 * remaining-% went UP, because its own footprint reopened while the pocket
 * behind it stayed shut. Measured on level 7: 480 cells sealed off, 0 of them
 * reopened by the break.
 *
 * The footprint reopening was only ever half the job. A wall that cuts a pocket
 * off is holding that whole pocket, and when it comes down the pocket is not
 * sealed any more - so the reopen floods outward from the footprint through
 * contiguous REMOVED cells, stopping at the three things that are genuinely
 * holding ground shut (see heldByOther). A pocket the PLAYER fenced is bounded
 * by that fence's own grid band, so the flood cannot cross into it and earned
 * captures are safe.
 *
 * Nothing here decides whether the space stays open: processDestroysFn runs
 * captureUnreachableCells straight after, which takes back anything no ball can
 * actually reach. So this hands back only ground that has genuinely become
 * playable again, and a pocket that is still sealed some other way is captured
 * again in the same frame.
 */
export function floodSealedShadow(
  game: CanvasGameState, grid: NonNullable<CanvasGameState["spaceGrid"]>, seed: number[],
): number[] {
  if (seed.length === 0) return [];
  const blocked = heldByOther(game, grid);
  const seen = new Uint8Array(grid.cells.length);
  for (const i of seed) seen[i] = 1;
  const queue = [...seed];
  const out: number[] = [];
  while (queue.length > 0) {
    const i = queue.pop()!;
    const col = i % grid.width, row = (i - col) / grid.width;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
      const n = r * grid.width + c;
      if (seen[n]) continue;
      seen[n] = 1;
      if (grid.cells[n] !== CellState.REMOVED) continue;
      const p = {
        x: grid.originX + c * grid.cellSize + grid.cellSize / 2,
        y: grid.originY + r * grid.cellSize + grid.cellSize / 2,
      };
      if (blocked(p)) continue;
      out.push(n);
      queue.push(n);
    }
  }
  return out;
}

/** Indices of grid cells REMOVED by `poly`: under it, or in its edge-seal ring. */
export function removedCellsUnder(game: CanvasGameState, poly: Polygon): number[] {
  const grid = game.spaceGrid;
  if (!grid) return [];
  // createSpaceGrid seals each obstacle EDGE by removing the cells that edge
  // crosses, which reaches half a lattice diagonal past the outline at most
  // (obstacleSealReach). Reopen that ring too, not just the interior footprint:
  // leaving it REMOVED grid-isolates the reopened interior even though physics
  // lets balls roll right over it, and the follow-up unreachable-capture in
  // processDestroysFn would then wrongly swallow reachable reopened space.
  // Read from the seal rather than guessed: a margin wider than the seal reaches
  // cells no seal ever removed, and hands back ground another wall is holding.
  const margin = obstacleSealReach(grid.cellSize);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of poly.vertices) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }
  const c0 = Math.max(0, Math.floor((minX - margin - grid.originX) / grid.cellSize));
  const c1 = Math.min(grid.width - 1, Math.ceil((maxX + margin - grid.originX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((minY - margin - grid.originY) / grid.cellSize));
  const r1 = Math.min(grid.height - 1, Math.ceil((maxY + margin - grid.originY) / grid.cellSize));
  // Ring cells must NOT reopen space that is REMOVED for reasons other than
  // this obstacle's seal: a wall/fence corridor (reopening one punches a hole in
  // the fence's grid band and reconnects a sealed pocket to the live board),
  // the outside of the board, or another obstacle's footprint. The corridor
  // test is geometric against every wall segment - a fence's rasterCells list
  // can't be used here, because cells already removed by this obstacle's seal
  // were skipped during the fence's rasterization and never recorded on it.
  const vs = poly.vertices;
  const out: number[] = [];
  // Held by something other than this obstacle: the player's fences, the edge
  // of the board, another solid. Shared with the shadow flood below, which is
  // bounded by exactly the same three things.
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const index = row * grid.width + col;
      if (grid.cells[index] !== CellState.REMOVED) continue;
      const wx = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const wy = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      const p = { x: wx, y: wy };
      let inside = pointInPolygon(p, poly);
      if (!inside) {
        // Edge-seal ring: within the seal margin of some polygon edge.
        let nearEdge = false;
        for (let i = 0; i < vs.length && !nearEdge; i++) {
          if (pointToSegmentDistance(p, vs[i], vs[(i + 1) % vs.length]) <= margin) nearEdge = true;
        }
        inside = nearEdge && !heldByOther(game, grid)(p);
      }
      if (inside) out.push(index);
    }
  }
  return out;
}

/**
 * Remove an obstacle polygon from the world (polygon ref, edge walls) and
 * reopen its carved footprint as capturable space. Returns cells opened.
 * Arrays are reassigned (not spliced) so renderFrame's reference-keyed glow /
 * fence-clip caches invalidate.
 */
function detachObstacle(game: CanvasGameState, id: string, poly: Polygon): number {
  game.obstaclePolygons = game.obstaclePolygons.filter(p => p !== poly);
  const prefix = `obstacle-${id}-edge-`;
  game.walls = game.walls.filter(w => !w.id.startsWith(prefix));
  if (!game.spaceGrid) return 0;
  const footprint = removedCellsUnder(game, poly);
  // The footprint AND whatever it was holding shut. The pocket behind a wall is
  // not sealed once the wall is gone, and giving back only the ground the wall
  // stood on is what made breaking one read as doing nothing.
  const cells = footprint.concat(floodSealedShadow(game, game.spaceGrid, footprint));
  if (cells.length > 0) {
    reopenCells(game, cells);
  }
  return cells.length;
}

/**
 * Register newly-reopened grid cells as board-grid sample points, skipping any
 * already present. initGame samples every board cell that isn't inside an
 * obstacle POLYGON - which INCLUDES the band of cells the grid seals as REMOVED
 * around each obstacle's edges (they're outside the polygon, so the init sampler
 * keeps them). Re-adding those seal-band cells when the obstacle is destroyed
 * would paint the board grid twice over that footprint; the doubled squares read
 * as a denser patch: the "artifacts in the grid background" of issue #65. Dedupe
 * so every reopened cell is drawn exactly once. Cell centres land on a fixed
 * half-integer lattice, so a rounded key matches the init points exactly.
 */
export function pushReopenedSamplePoints(game: CanvasGameState, cells: number[]): void {
  const grid = game.spaceGrid;
  if (!grid || cells.length === 0) return;
  const key = (p: Vector2) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
  const seen = new Set(game.initialSamplePoints.map(key));
  for (const idx of cells) {
    const p = gridIndexToWorld(grid, idx);
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    game.initialSamplePoints.push(p);
  }
}

/**
 * Restore cells to ACTIVE, keep the percentage baseline sane, and register them
 * as sample points so the board grid texture is painted over the newly-opened
 * area (otherwise it renders as a bare patch).
 */
export function reopenCells(game: CanvasGameState, cells: number[]): void {
  const grid = game.spaceGrid;
  if (!grid) return;
  restoreCells(grid, cells);
  grid.initialActiveCount += cells.length; // keep remaining% ≤ 100
  pushReopenedSamplePoints(game, cells);
}

/**
 * Everything that happens BECAUSE a breakable broke, once its body is gone.
 *
 * Split out because a breakable leaves the board two ways and only one of them
 * used to run this. A ball spending its hit budget queues the object and
 * `processDestroysFn` does the whole job; but smash the thing a stack rests on
 * and `toppleSupportedBy` brought the rest down by hand - detaching the
 * polygon, setting `destroyed`, and stopping there.
 *
 * So a GATE breakable that came down with its supporter took its sealed area
 * with it: those cells stayed REMOVED with nothing left on the board that could
 * ever reopen them. The player watched the gate break and the space behind it
 * never arrived - dead, uncuttable ground, permanently. A toppled chest paid
 * nothing, and a toppled objective was never counted, which can leave a map
 * whose win gate counts broken objectives unwinnable.
 *
 * The bonus and the demolition multiplier come along too. A break the player
 * caused is a break; paying differently depending on which end of the stack
 * they hit is the kind of arbitrary rule that reads as a bug from the seat.
 *
 * Returns the number of grid cells it reopened.
 */
function completeBreakable(
  game: CanvasGameState,
  d: DestructibleState,
  levelNumber: number,
  callbacks: DestroyCallbacks,
  modifiers?: Pick<GameModifiers, "breakMultiplierBonus" | "smashKeepsLockMultiplier">,
): number {
  let opened = 0;
  game.breakablesSmashed = (game.breakablesSmashed ?? 0) + 1;
  // Not a win requirement (you still win by shrinking the board), but an
  // objective-counting gate reads this, so a break that is not counted can
  // strand the map.
  if (d.objective) game.objectivesBroken++;
  // Recorded for the overlay and the run stats, NOT paid into Greed any more.
  // It used to be `greedBonus: pushBonus + game.breakBonus`, which is how the
  // map's own content came to be worth nothing: Greed's pot (6h today, 25h
  // before the deflation) is shared with clearing, so on any map where you
  // also cleared it was already full and
  // these hours evaporated. Engagement is its own axis now (scoreAxes.ts), paid
  // on the share of the map's breakables actually taken apart.
  game.breakBonus += d.objective ? BREAK_BONUS_OBJECTIVE : BREAK_BONUS_BASE;
  // Every smash compounds the demolition multiplier, so stopping to break
  // things offsets the ship-early time it cost (issue #38). Write-Off
  // compounds harder per smash.
  game.breakMultiplier = (game.breakMultiplier ?? 1)
    * (BREAK_MULTIPLIER_PER + Math.max(0, modifiers?.breakMultiplierBonus ?? 0));

  // Treasure chest (#38): a smash rolls a reward, grants it, and drops a gem
  // showing what it was.
  if (d.chest) grantChestReward(game, d, levelNumber, callbacks.onChestReward);

  // A gate breakable re-opens its sealed (locked) area as capturable space.
  if (d.sealedCells && d.sealedCells.length > 0 && game.spaceGrid) {
    reopenCells(game, d.sealedCells);
    opened += d.sealedCells.length;
  }
  return opened;
}

/** Topple every obstacle resting on `supporterId` (recursively): detach + fall. */
function toppleSupportedBy(
  game: CanvasGameState,
  supporterId: string,
  now: number,
  levelNumber: number,
  callbacks: DestroyCallbacks,
  modifiers?: Pick<GameModifiers, "breakMultiplierBonus" | "smashKeepsLockMultiplier">,
): number {
  let opened = 0;
  for (const so of game.stackObjects) {
    if (so.toppled || so.supporterId !== supporterId) continue;
    so.toppled = true;
    opened += detachObstacle(game, so.id, so.polygon);
    game.fallingObjects.push(makeFalling(so.polygon, OBSTACLE_FALL_COLOR, now));
    // If this object was itself a breakable, it has just been DESTROYED, not
    // merely removed from the board - so it gets the same consequences a
    // smashed one does. Retiring the descriptor by hand here was the bug: it
    // skipped the sealed area, the chest reward and the objective count.
    const dd = game.destructibles.find(d => d.kind === 'breakable' && d.id === so.id && !d.destroyed);
    if (dd) {
      dd.destroyed = true;
      opened += completeBreakable(game, dd, levelNumber, callbacks, modifiers);
    }
    // Things resting on it fall too.
    opened += toppleSupportedBy(game, so.id, now, levelNumber, callbacks, modifiers);
  }
  return opened;
}

/**
 * Rebuild regions from the grid, KEEPING every active region (including newly
 * opened, ball-less space — it's now capturable, not a stray sliver). Exported
 * so the Clear All Fences ability (src/lib/abilities.ts) can reuse it.
 */
export function rebuildRegionsKeepAll(game: CanvasGameState): void {
  const grid = game.spaceGrid!;
  const gridRegions = findGridRegions(grid);
  game.gridRegions = gridRegions;

  const regions: Region[] = [];
  for (const gridRegion of gridRegions) {
    const samples = getRegionCellPositions(grid, gridRegion);
    const built = buildPolygonFromSamples(samples, samples.length);
    if (built) {
      regions.push({
        id: generateRegionId(),
        polygon: built.polygon,
        estimatedArea: built.estimatedArea,
        samplePoints: built.samplePoints,
      });
    }
  }
  game.regions = regions;
  reassignBallsToRegions(game.balls, game.regions, game.walls);
  paintCellRegionIds(grid, game.regions);
}

/**
 * Will the engine build a destructible for this authored entity?
 *
 * Three flags say "this breaks", and they say different things about HOW: a
 * hit count, a reward inside, a brick that goes on one touch. Only one of them
 * is named `breakable`, and reading that field alone is a mistake three places
 * had made independently - a brittle brick was invisible to the win
 * highlight's fixture, to the ladder's "does this map carry content" check,
 * and to act I's hit-count cap, all of which then reported an act I map as
 * carrying nothing to smash while the player was smashing it.
 *
 * So the rule lives here, once, beside the code that acts on it, and initGame
 * reads it rather than repeating it.
 */
export function entityIsDestructible(
  e: { kind?: string; breakable?: boolean; chest?: boolean; brittle?: boolean },
): boolean {
  return e.kind === "wall" && (!!e.breakable || !!e.chest || !!e.brittle);
}

// ── Treasure chests (#38) ────────────────────────────────────────────────────

/**
 * Roll a smashed chest's reward (#38) and grant it.
 *
 * The reward used to require a second action: the chest dropped a gem and the
 * player had two seconds to TAP it, or the reward was lost. That made the
 * earned thing conditional on a reflex unrelated to earning it - you had to
 * manoeuvre a ball into a chest, and then also be free to stop drawing and hit
 * a bouncing target, on a board where the balls do not pause to let you. The
 * smash is the interaction; landing it is the skill.
 *
 * The gem still drops, and still bounces and fades. It is now a receipt rather
 * than a token: it shows WHAT was won and where it came from, so the reward
 * still reads as coming out of that chest instead of appearing in the ability
 * bar unexplained.
 *
 * Seeded per chest id, so daily / record runs roll identically. Now that the
 * grant is unconditional, that seed also makes the reward itself reproducible,
 * which it never quite was while a missed tap could erase it.
 */
function grantChestReward(
  game: CanvasGameState,
  d: DestructibleState,
  levelNumber: number,
  onChestReward?: (rewardId: string) => void,
): void {
  if (!d.obstaclePolygon) return;
  const rng = getRunRng(`chest:${d.id}`);
  // Random among abilities unlocked at this level, optionally narrowed to the
  // chest's authored pool (see abilities.ts / public/abilities.yml).
  const rewardId = rollCappedAbilityReward(
    d.chestRewards, levelNumber, rng, game.heldAbilityIds, game.abilitySlots,
  );
  if (!rewardId) return; // empty catalogue (should never happen)
  const c = polygonCentroid(d.obstaclePolygon);
  (game.chestLoot ??= []).push(makeChestLoot(`loot-${d.id}`, rewardId, c.x, c.y, game.activePlaySeconds));
  onChestReward?.(rewardId);
}

/**
 * Make reopened ground playable: everything that has to follow `reopenCells`
 * before the next frame, or the cells come back as a dark island.
 *
 * Reopened space a ball can actually reach becomes capturable again (the point
 * of breaking things). But a footprint reopened INSIDE captured territory -
 * e.g. a box toppled by the stack-chain when its supporter was smashed on the
 * other side of a sealed fence - is unreachable by every ball, so it would
 * linger forever as an uncapturable dark island in the captured fill AND
 * permanently inflate the remaining-%. Recapture every reopened cell no ball
 * can physically reach, right now.
 *
 * Shared by the destroy pass and the launcher shell coming down: the second
 * caller is exactly why this is a function and not the tail of one loop.
 */
export function settleReopenedGround(
  game: CanvasGameState, callbacks: Pick<DestroyCallbacks, "setRemainingPercent">, opened: number,
): void {
  if (opened <= 0 || !game.spaceGrid) {
    return;
  }
  captureUnreachableCells(game.spaceGrid, game.balls, game.walls);
  rebuildRegionsKeepAll(game);
  // A destroy-recapture can swallow a token's cell with no lock involved.
  wasteCapturedPickups(game);
  callbacks.setRemainingPercent(Math.round(getRemainingPercent(game.spaceGrid)));
}

// ── Processing queued destructions ──────────────────────────────────────────

export function processDestroysFn(
  game: CanvasGameState,
  callbacks: DestroyCallbacks,
  levelNumber = 1,
  /** Breaking Change forks; omitted (tests, older callers) means neither owned. */
  modifiers?: Pick<GameModifiers, "breakMultiplierBonus" | "smashKeepsLockMultiplier">,
): void {
  const pending = game.pendingDestroys;
  game.pendingDestroys = [];
  if (pending.length === 0) return;

  const now = simNow();
  let opened = 0;

  for (const d of pending) {
    // Mirror/mover kills drop the destroying (black) ball's lock multiplier.
    // Blameless Postmortem waives it: the whole point of that fork is that
    // wrecking things stops costing you the lock you were building.
    const keepsLock = (modifiers?.smashKeepsLockMultiplier ?? 0) > 0;
    if ((d.kind === 'mirror' || d.kind === 'mover') && d.destroyedBy && !keepsLock) {
      const ball = game.balls.find(b => b.id === d.destroyedBy);
      if (ball) ball.lockMultiplier = Math.max(1, ball.lockMultiplier - 1);
    }

    if (d.kind === 'mover') {
      const mover = game.movers.find(m => m.id === d.moverId);
      if (mover) {
        game.objectDebris.push(spawnDebris(mover.polygon, MOVER_DEBRIS_COLOR, now));
        game.movers.splice(game.movers.indexOf(mover), 1);
      }
      continue;
    }

    // Mirror or breakable obstacle: shatter in place, reopen its footprint.
    const poly = d.kind === 'mirror' ? d.mirrorPolygon : d.obstaclePolygon;
    if (!poly) continue;
    const color = d.kind === 'mirror' ? MIRROR_DEBRIS_COLOR : BREAKABLE_DEBRIS_COLOR;
    // Breakables throw a bigger, chunkier burst than mirrors on the final hit.
    const isBreak = d.kind === 'breakable';
    game.objectDebris.push(spawnDebris(poly, color, now, isBreak ? 30 : 16, isBreak ? 1.15 : 1));
    opened += detachObstacle(game, d.id, poly);

    if (d.kind === 'mirror') {
      game.mirrorPolygons = game.mirrorPolygons.filter(p => p !== poly);
      continue;
    }

    opened += completeBreakable(game, d, levelNumber, callbacks, modifiers);

    const so = game.stackObjects.find(s => s.id === d.id);
    if (so) so.toppled = true;
    opened += toppleSupportedBy(game, d.id, now, levelNumber, callbacks, modifiers);
  }

  // The static layer draws the obstacles, and this pass has just taken one out
  // of the model: its polygon and its edge walls are gone from `game`. Marking
  // that layer dirty is therefore owed on EVERY destroy, not only on the ones
  // that reopened ground. It used to sit inside the `opened > 0` block below,
  // so a breakable whose footprint reopened nothing - already-captured ground,
  // or a sliver too thin for a cell centre to land inside - was removed from
  // the model while the last render of it stayed on screen.
  callbacks.repaintRegionCanvas();

  settleReopenedGround(game, callbacks, opened);

  // A drill that was eating one of these carries on through the gap it just
  // made (FENCE_TYPES_PLAN.md). LAST, and after the region rebuild above, for
  // one reason: the continuation casts a ray against the board as it is NOW,
  // and cast a moment earlier it would stop dead on the obstacle that is no
  // longer there. Spawned as an ordinary growing fence, so it can be cut by a
  // ball and runs every check a normal cut runs.
  for (const d of pending) resumeDrillThrough(game, d);

  callbacks.onObjectDestroyed?.();
}
