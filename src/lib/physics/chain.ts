/**
 * Chain physics (issue #64) — a short verlet rope linking two balls.
 *
 * Two uses share one solver:
 *  - the boss-20 / boss-35 pair, whose chain SWEEPS and fractures player fences
 *    (`breaksFences: true`);
 *  - the yellow/purple "chained ball" gift, which only tethers + snags.
 *
 * The rope drapes over solid obstacles (nodes are pushed out of them), which
 * "snags" the pair and slows it — the boss-20 mitigation. A phasing object that
 * phases OUT stops being solid, so the rope slides free (and the phase-out
 * shockwave flings the balls apart). Freezing both balls pins the whole rope.
 */
import { CanvasGameState } from "@/types/gameState";
import { Ball, ChainState } from "@/types/game";
import { Vector2, Polygon, pointInPolygon, lineSegmentIntersection } from "@/lib/polygon";
import { isPlayerFence } from "@/lib/wallGeometry";
import { registerFenceFracture } from "@/lib/physics/breakFenceWall";

const CHAIN_NODES = 6;      // endpoints + interior
const RELAX_PASSES = 4;
const SLACK = 1.25;         // taut length = initial gap * SLACK
const MIN_REST = 70;        // never taut below this (world units)
const GRAVITY = 26;         // gentle sag (world units / s^2)
const DAMP = 0.98;          // verlet velocity damping
const SNAG_FRICTION = 0.9;  // per-frame velocity kept by both balls while snagged

// Elastic tether tuning. The rope behaves like a spring past its rest length
// rather than a rigid rod, so a wall bounce is absorbed over several frames
// instead of snapping back as a sudden fling. A hard clamp only engages at the
// extreme so constant-speed balls can't drift apart forever.
const STRETCH_MAX = 1.5;    // hard limit as a multiple of restLength
const SPRING_PULL = 0.18;   // fraction of the overshoot reeled in per step
const SPEED_CAP = 1.05;     // chained balls run at most this * their natural top

/** Build a chain linking two balls, its nodes seeded along the current gap. */
export function makeChain(a: Ball, b: Ball, breaksFences: boolean, nodeCount = CHAIN_NODES): ChainState {
  const nodes: Vector2[] = [];
  const prev: Vector2[] = [];
  const n = Math.max(3, nodeCount);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = {
      x: a.position.x + (b.position.x - a.position.x) * t,
      y: a.position.y + (b.position.y - a.position.y) * t,
    };
    nodes.push({ ...p });
    prev.push({ ...p });
  }
  const gap = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
  return { aId: a.id, bId: b.id, nodes, prev, breaksFences, restLength: Math.max(MIN_REST, gap * SLACK) };
}

function isFrozen(ball: Ball, now: number): boolean {
  return ball.frozenUntil !== undefined && now < ball.frozenUntil;
}

/** Obstacle polygons that are currently tangible (phased-out ones excluded). */
function solidObstacles(game: CanvasGameState): Polygon[] {
  const out = new Set<Polygon>(game.obstaclePolygons);
  // `phase === "out"` is the source of truth for intangibility (#69): a pillar
  // mid-fade no longer snags the rope, matching the ball collision + the ghost.
  for (const p of game.phasingObjects) {
    if (p.phase === "out") out.delete(p.polygon);
  }
  return [...out];
}

/** Closest point to `p` on segment ab. */
function closestOnSegment(p: Vector2, a: Vector2, b: Vector2): Vector2 {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1e-6;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Push a node out to the nearest edge if it is inside any solid obstacle. */
function pushOutOfSolids(node: Vector2, solids: Polygon[]): boolean {
  for (const poly of solids) {
    if (!pointInPolygon(node, poly)) continue;
    const v = poly.vertices;
    let best: Vector2 | null = null;
    let bestD = Infinity;
    for (let i = 0; i < v.length; i++) {
      const c = closestOnSegment(node, v[i], v[(i + 1) % v.length]);
      const d = (c.x - node.x) ** 2 + (c.y - node.y) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) { node.x = best.x; node.y = best.y; return true; }
  }
  return false;
}

function dampBall(ball: Ball, f: number): void {
  ball.velocity.x *= f;
  ball.velocity.y *= f;
  ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y);
}

/**
 * Redirect a ball's outward (chain-stretching) velocity into a tangential swing,
 * conserving its speed. This is what stops the pair going static: a taut chain
 * never *removes* speed, it turns it, so the two balls orbit each other like a
 * bolas instead of being braked to a standstill. `ox,oy` is the outward unit
 * (from the partner toward this ball); inward/tangential motion is left alone.
 */
function swing(ball: Ball, ox: number, oy: number): void {
  const s = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (s < 1e-6) return;
  const radial = ball.velocity.x * ox + ball.velocity.y * oy; // + = stretching
  if (radial <= 0) return;                                    // slack side, leave it
  // Tangent perpendicular to the chain, aligned with the ball's current swing.
  let tx = -oy, ty = ox;
  if (ball.velocity.x * tx + ball.velocity.y * ty < 0) { tx = -tx; ty = -ty; }
  // Zeroing the radial part while conserving speed puts all of it into the swing.
  ball.velocity.x = tx * s; ball.velocity.y = ty * s;
  ball.speed = s;
}

/**
 * Elastic tether. Past the rest length the rope reels the pair together by a
 * fraction of the overshoot (a soft spring, not a rigid rod) and converts the
 * stretching motion into a swing so neither ball loses speed. A hard clamp
 * engages only at STRETCH_MAX so the pair can never separate past the chain.
 */
function tether(a: Ball, b: Ball, restLen: number): void {
  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  const d = Math.hypot(dx, dy);
  if (d <= restLen || d < 1e-6) return;
  const ux = dx / d, uy = dy / d; // unit A -> B

  // Soft positional spring: reel in a fraction of the overshoot per step.
  const pull = (d - restLen) * SPRING_PULL;
  a.position.x += ux * pull * 0.5; a.position.y += uy * pull * 0.5;
  b.position.x -= ux * pull * 0.5; b.position.y -= uy * pull * 0.5;

  // Swing instead of brake: A's outward is -u (away from B), B's outward is +u.
  swing(a, -ux, -uy);
  swing(b, ux, uy);

  // Hard safety limit: if still past the max stretch after the soft pull, clamp
  // the remainder so the balls can't drift out of reach of each other.
  const cur = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
  const maxLen = restLen * STRETCH_MAX;
  if (cur > maxLen) {
    const nx = (b.position.x - a.position.x) / cur, ny = (b.position.y - a.position.y) / cur;
    const excess = cur - maxLen;
    a.position.x += nx * excess * 0.5; a.position.y += ny * excess * 0.5;
    b.position.x -= nx * excess * 0.5; b.position.y -= ny * excess * 0.5;
  }
}

/**
 * Bleed a chained ball's speed back down to its natural top. The chain keeps the
 * pair colliding, and the elastic swap in handleBallCollisions plus the
 * minimum-speed floor pump energy in with no upper bound; this trims the excess
 * so the pair can't run away. It never speeds a ball up.
 */
function capSpeed(ball: Ball): void {
  const top = Math.max(ball.topSpeed || 0, ball.speedRange ? ball.speedRange[1] : 0) * SPEED_CAP;
  if (top <= 0) return;
  const cur = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (cur > top) dampBall(ball, top / cur);
}

/** Boss chains: break any player fence a chain segment sweeps across. */
function sweepFences(game: CanvasGameState, ch: ChainState, now: number): void {
  for (const wall of game.walls) {
    if (!isPlayerFence(wall)) continue;
    if (wall.blackHits !== undefined && wall.blackHits >= 3) continue;
    for (let i = 0; i < ch.nodes.length - 1; i++) {
      if (lineSegmentIntersection(ch.nodes[i], ch.nodes[i + 1], wall.start, wall.end)) {
        registerFenceFracture(game, wall, now);
        break;
      }
    }
  }
}

/**
 * Advance every chain one physics step. `dt` is the fixed step in seconds,
 * `now` is performance.now() (for freeze + fence-fracture debounce).
 */
export function tickChains(game: CanvasGameState, dt: number, now: number): void {
  const chains = game.chains;
  if (!chains || chains.length === 0) return;
  const solids = solidObstacles(game);

  for (let ci = chains.length - 1; ci >= 0; ci--) {
    const ch = chains[ci];
    const a = game.balls.find(x => x.id === ch.aId);
    const b = game.balls.find(x => x.id === ch.bId);
    // Drop the chain once either ball is gone or locked away.
    if (!a || !b || a.state !== "active" || b.state !== "active") { chains.splice(ci, 1); continue; }

    const n = ch.nodes.length;
    // 1. Pin the endpoints to the two balls.
    ch.nodes[0] = { x: a.position.x, y: a.position.y };
    ch.nodes[n - 1] = { x: b.position.x, y: b.position.y };

    // 2. Verlet-integrate interior nodes (unless both anchors are frozen).
    const pinned = isFrozen(a, now) && isFrozen(b, now);
    if (!pinned) {
      for (let i = 1; i < n - 1; i++) {
        const p = ch.nodes[i], pr = ch.prev[i];
        const vx = (p.x - pr.x) * DAMP, vy = (p.y - pr.y) * DAMP;
        ch.prev[i] = { x: p.x, y: p.y };
        ch.nodes[i] = { x: p.x + vx, y: p.y + vy + GRAVITY * dt * dt };
      }
    }
    ch.prev[0] = { x: ch.nodes[0].x, y: ch.nodes[0].y };
    ch.prev[n - 1] = { x: ch.nodes[n - 1].x, y: ch.nodes[n - 1].y };

    // 3. Relax toward the segment rest length + drape over solids. A node pushed
    //    out of an obstacle this frame means the rope is snagged on it.
    const seg = ch.restLength / (n - 1);
    let snagged = false;
    for (let pass = 0; pass < RELAX_PASSES; pass++) {
      for (let i = 0; i < n - 1; i++) {
        const p1 = ch.nodes[i], p2 = ch.nodes[i + 1];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - seg) / d;
        const end1 = i === 0, end2 = i + 1 === n - 1;
        const w1 = end1 ? 0 : end2 ? 1 : 0.5;
        const w2 = end2 ? 0 : end1 ? 1 : 0.5;
        p1.x += dx * diff * w1; p1.y += dy * diff * w1;
        p2.x -= dx * diff * w2; p2.y -= dy * diff * w2;
      }
      for (let i = 1; i < n - 1; i++) if (pushOutOfSolids(ch.nodes[i], solids)) snagged = true;
    }

    // 5. Tether the two balls, cap runaway speed, then apply snag friction.
    tether(a, b, ch.restLength);
    if (!pinned) { capSpeed(a); capSpeed(b); }
    if (snagged && !pinned) { dampBall(a, SNAG_FRICTION); dampBall(b, SNAG_FRICTION); }

    // 6. Boss chains sweep fences apart.
    if (ch.breaksFences) sweepFences(game, ch, now);
  }
}
