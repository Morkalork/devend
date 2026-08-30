import { Region, Ball } from "@/types/game";
import { gravityVectorAt, steerToward } from "@/lib/physics/gravity";
import { DEFAULT_TURN_INTERVAL } from "@/lib/physics/turnTimer";
import { DEFAULT_ATTRACT_TURN_RATE, DEFAULT_ATTRACT_RADIUS } from "@/lib/physics/lodestone";
import {
  mapGravityActive, wellPullAt, wellTurnRateAt, type SteerWorld,
} from "@/lib/physics/steering";
import { Vector2, pointInPolygon, Polygon } from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";
import { runStream } from "@/lib/runRng";

// ── Colour helpers ────────────────────────────────────────────────────────

export function hexToRgba(hex: string, alpha: number = 1): string {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── ID generators ─────────────────────────────────────────────────────────

let regionIdCounter = 0;
export function generateRegionId(): string {
  return `region-${++regionIdCounter}`;
}

let wallIdCounter = 0;
export function generateWallId(): string {
  return `wall-${++wallIdCounter}`;
}

// ── Direction helpers ─────────────────────────────────────────────────────

export function getRandomDirection(): Vector2 {
  const minAngle = 15 * (Math.PI / 180);
  const maxAngle = 75 * (Math.PI / 180);
  // Seeded: which way a ball first heads decides the whole map, so a shared
  // seed has to send it the same way for everyone.
  const roll = runStream("ballDirection");
  const quadrant = Math.floor(roll() * 4);
  const baseAngle = minAngle + roll() * (maxAngle - minAngle);
  const angle = baseAngle + (quadrant * Math.PI) / 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// ── Region lookup ─────────────────────────────────────────────────────────

export function findRegionContainingPoint(regions: Region[], x: number, y: number): Region | null {
  for (const region of regions) {
    if (pointInPolygon({ x, y }, region.polygon)) {
      return region;
    }
  }
  return null;
}

// ── Scoring helpers ───────────────────────────────────────────────────────

/** Legacy scoring — kept for compatibility; primary scoring uses the configurable system. */
export function computeLevelScore(basePoints: number, expectedCuts: number, actualCuts: number): number {
  let score: number;
  if (actualCuts <= expectedCuts) {
    score = basePoints + (expectedCuts - actualCuts);
  } else {
    score = basePoints - (actualCuts - expectedCuts);
  }
  return Math.max(0, score);
}

/** Legacy overcut bonus — now integrated into space optimisation. */
export function computeOvercutBonus(threshold: number, remaining: number, basePoints: number): number {
  const overshoot = Math.max(0, threshold - remaining);
  if (overshoot <= 0) return 0;
  const overcutRatio = overshoot / threshold;
  const bonus = Math.round(basePoints * 0.6 * Math.sqrt(overcutRatio));
  const maxBonus = Math.floor(0.5 * basePoints);
  return Math.min(bonus, maxBonus);
}

// ── Difficulty curves ─────────────────────────────────────────────────────

/** Wall speed in world units/second. Decreases per level (slower fence = harder). */
export function getWallSpeedBase(levelIndex: number, base = 1200, min = 750, perLevel = 50): number {
  return Math.max(min, Math.min(base, base - (levelIndex - 1) * perLevel));
}

/** Ball speed multiplier. Increases per level (faster balls = harder). */
export function getBallSpeedLevelMultiplier(levelIndex: number): number {
  return 1 + (levelIndex - 1) * 0.06;
}

// ── Ball trajectory ───────────────────────────────────────────────────────

interface CapsuleHit { t: number; nx: number; ny: number; }

/** Nearest forward hit (t > eps) of a UNIT-direction ray with a circle. */
function rayCircleFirstHit(
  ox: number, oy: number, dx: number, dy: number,
  cx: number, cy: number, R: number,
): number | null {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;        // dir is unit, so the quadratic's a = 1
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 > 1e-4) return t0;
  const t1 = -b + s;
  return t1 > 1e-4 ? t1 : null;
}

/**
 * Nearest forward hit of a UNIT-direction ray against the CAPSULE around
 * segment a–b with radius R — the surface swept by the CENTRE of a ball of
 * radius R as it rolls along the wall. This is exactly the model the real
 * collision uses (closest point on the segment, within radius R), so it
 * reflects at the correct angle on the flat sides AND rounds the endpoints and
 * corners the way the physics does. Returns the centre-contact distance `t` and
 * the outward surface normal, or null.
 */
function capsuleRayHit(
  ox: number, oy: number, dx: number, dy: number,
  ax: number, ay: number, bx: number, by: number, R: number,
): CapsuleHit | null {
  const sx = bx - ax, sy = by - ay;
  const segLen = Math.sqrt(sx * sx + sy * sy);
  let best: CapsuleHit | null = null;
  const consider = (t: number, nx: number, ny: number) => {
    if (t > 1e-4 && (!best || t < best.t)) best = { t, nx, ny };
  };

  if (segLen >= 1e-9) {
    const ux = sx / segLen, uy = sy / segLen;         // unit vector along the wall
    // Flat side facing the ray: its outward normal must oppose the ray dir.
    let onx = -uy, ony = ux;
    if (dx * onx + dy * ony > 0) { onx = -onx; ony = -ony; }
    // Ray vs the offset line through (a + R·outward) with direction u.
    const px = ax + onx * R, py = ay + ony * R;
    const denom = dx * uy - dy * ux;
    if (Math.abs(denom) > 1e-9) {
      const t = ((px - ox) * uy - (py - oy) * ux) / denom;
      if (t > 1e-4) {
        const hx = ox + t * dx, hy = oy + t * dy;
        const w = (hx - ax) * ux + (hy - ay) * uy;    // projection along the wall
        if (w >= 0 && w <= segLen) consider(t, onx, ony); // only the flat span
      }
    }
  }

  // Rounded end caps (the corners). A cap only counts where it sticks out past
  // the segment end — within the span the flat side is the true surface.
  const caps: Array<[number, number, number]> = [[ax, ay, -1], [bx, by, 1]];
  for (const [ex, ey, side] of caps) {
    const t = rayCircleFirstHit(ox, oy, dx, dy, ex, ey, R);
    if (t == null) continue;
    const hx = ox + t * dx, hy = oy + t * dy;
    if (segLen >= 1e-9) {
      const w = ((hx - ax) * sx + (hy - ay) * sy) / segLen;
      if (side < 0 && w > 0) continue;         // cap a: keep only w < 0
      if (side > 0 && w < segLen) continue;    // cap b: keep only w > segLen
    }
    const nx = hx - ex, ny = hy - ey;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    consider(t, nx / nl, ny / nl);
  }

  return best;
}

/** Subset of MoverState the trajectory needs: current polygon + oscillation. */
export interface TrajectoryMover {
  /** The live physics polygon, at the mover's CURRENT position. */
  polygon: Polygon;
  axis: "horizontal" | "vertical";
  offset: number;
  direction: 1 | -1;
  speed: number;
  range: number;
}

interface MoverHit { time: number; nx: number; ny: number; id: string; }

/**
 * Earliest hit of the ball (leaving (ox,oy) along unit (dx,dy) at `speed` at
 * absolute prediction time tLeg) against an oscillating mover, within `window`
 * seconds of the leg start. A mover's velocity is piecewise constant (fixed
 * until it flips at a track end), so inside each flip interval the static
 * capsule test is exact in the mover's reference frame: cast the RELATIVE
 * velocity against the polygon shifted to its interval-start position, then
 * convert the relative-frame distance back to time. Normals are translation-
 * invariant, so the hit normal is valid in the world frame. Returns the hit
 * time relative to the leg start, or null.
 */
function moverFirstHit(
  m: TrajectoryMover, mi: number,
  ox: number, oy: number, dx: number, dy: number,
  speed: number, R: number, tLeg: number, window: number, skipId: string,
): MoverHit | null {
  const axX = m.axis === "horizontal" ? 1 : 0;
  const axY = 1 - axX;
  const half = m.range / 2;
  const isStatic = m.speed <= 1e-9 || m.range <= 1e-9;
  const vs = m.polygon.vertices;
  const o0 = m.offset; // the polygon's vertices sit at this offset "now" (t = 0)

  let o = m.offset;
  let dir: 1 | -1 = m.direction;
  let t = 0; // interval start, in absolute prediction time
  // 200 flip intervals is far beyond any real prediction window; the cap only
  // guards against a degenerate window (e.g. Infinity with nothing to hit).
  for (let iter = 0; iter < 200; iter++) {
    const tEnd = isStatic ? Infinity : t + (dir > 0 ? half - o : o + half) / m.speed;
    const winStart = Math.max(t, tLeg);
    const winEnd = Math.min(tEnd, tLeg + window);
    if (winStart < winEnd) {
      const vmx = isStatic ? 0 : dir * m.speed * axX;
      const vmy = isStatic ? 0 : dir * m.speed * axY;
      const rvx = dx * speed - vmx, rvy = dy * speed - vmy;
      const rs = Math.sqrt(rvx * rvx + rvy * rvy);
      if (rs > 1e-9) {
        const rux = rvx / rs, ruy = rvy / rs;
        // Ball centre and mover shift at the window start.
        const bx = ox + dx * speed * (winStart - tLeg);
        const by = oy + dy * speed * (winStart - tLeg);
        const oAt = isStatic ? o0 : o + dir * m.speed * (winStart - t);
        const sx = (oAt - o0) * axX, sy = (oAt - o0) * axY;
        let best: MoverHit | null = null;
        for (let i = 0; i < vs.length; i++) {
          const j = (i + 1) % vs.length;
          const id = `mov:${mi}:${i}`;
          if (id === skipId) continue;
          const hit = capsuleRayHit(bx, by, rux, ruy,
            vs[i].x + sx, vs[i].y + sy, vs[j].x + sx, vs[j].y + sy, R);
          if (!hit) continue;
          const hitAbs = winStart + hit.t / rs;
          if (hitAbs > winEnd + 1e-9) continue; // lands after the flip / window
          if (!best || hitAbs < best.time) best = { time: hitAbs, nx: hit.nx, ny: hit.ny, id };
        }
        // Hits in later intervals are strictly later — first interval wins.
        if (best) { best.time -= tLeg; return best; }
      }
    }
    if (isStatic || tEnd >= tLeg + window) return null;
    o = dir > 0 ? half : -half;
    dir = dir > 0 ? -1 : 1;
    t = tEnd;
  }
  return null;
}

/** Snapshot of another active ball the trajectory may collide with. */
export interface TrajectoryBall {
  position: Vector2;
  radius: number;
  /** Tap-frozen (infinite mass): the moving ball REFLECTS off it. */
  frozen?: boolean;
  /**
   * A LODESTONE pulls the predicted ball toward itself, so it steers the path
   * as well as sitting in it.
   *
   * Modelled from a static snapshot, exactly as the collision half of this
   * already is: a lodestone is a ball and its own motion is unknowable a second
   * ahead. That makes later legs increasingly approximate, which is inherent to
   * a forward preview and is why the drift at the end fades. Drawing a straight
   * line THROUGH a live pull is not more honest, it is just wrong in a way the
   * player cannot see coming.
   */
  attractTurnRate?: number;
  attractRadius?: number;
}

/**
 * The compass ball's turn schedule, so the preview can put the ninety-degree
 * turn where it will actually happen.
 *
 * This one is not an approximation at all. The turn is exact, its time is
 * known, and its direction is chosen a whole cycle in advance precisely so the
 * player can plan around it (turnTimer.ts). The ability was designed to be
 * planned around and the tool for planning - the path preview - was the one
 * thing that could not see it, drawing a confident straight line through a turn
 * the ball had already committed to.
 */
export interface TrajectoryTurns {
  /** Prediction-relative seconds until the first turn. */
  firstTurnIn: number;
  /** Seconds between turns thereafter. */
  intervalSeconds: number;
  /** +1 clockwise, -1 counter-clockwise. */
  direction: 1 | -1;
}

/**
 * The collidable-ball snapshots for one predicted ball, mirroring exactly
 * which pairs handleBallCollisions would resolve: same region only, active
 * only, and never the auto-frozen ball (its collisions are skipped entirely).
 * Positions use the interpolated render position so the preview lines up with
 * what is drawn.
 */
export function trajectoryBallSnapshots(
  balls: ReadonlyArray<Ball>,
  predicted: Ball,
  autoFrozenBallId: string | null,
): TrajectoryBall[] {
  const now = performance.now();
  const out: TrajectoryBall[] = [];
  for (const b of balls) {
    if (b === predicted || b.state !== "active") continue;
    if (b.regionId !== predicted.regionId) continue;
    if (autoFrozenBallId && b.id === autoFrozenBallId) continue;
    out.push({
      position: b.renderPosition ?? b.position,
      radius: b.radius,
      frozen: b.frozenUntil !== undefined && now < b.frozenUntil,
      // Only a lodestone carries these; every other ball leaves them undefined
      // and steers nothing.
      attractTurnRate: b.ability === "attract" ? b.attractTurnRate ?? DEFAULT_ATTRACT_TURN_RATE : undefined,
      attractRadius: b.ability === "attract" ? b.attractRadius ?? DEFAULT_ATTRACT_RADIUS : undefined,
    });
  }
  return out;
}

/**
 * The predicted ball's own turn schedule, or null when it does not turn.
 *
 * Reads the same fields the ring unwinds on, so the preview and the countdown
 * the player is watching can never disagree about when the turn lands.
 */
export function trajectoryTurnsFor(
  ball: Ball, activeSeconds: number,
): TrajectoryTurns | null {
  if (ball.ability !== "turnTimer" || ball.nextTurnAt === undefined) return null;
  const intervalSeconds = ball.turnIntervalSeconds ?? DEFAULT_TURN_INTERVAL;
  if (!(intervalSeconds > 0)) return null;
  return {
    firstTurnIn: Math.max(0, ball.nextTurnAt - activeSeconds),
    intervalSeconds,
    direction: ball.turnClockwise === false ? -1 : 1,
  };
}

/**
 * Predict the ball's future path as centre-position waypoints by ray-casting
 * off the board edges, user fences and obstacle polygons. Each surface is
 * modelled as a capsule (see capsuleRayHit) whose radius matches the real
 * collision distance, so the preview reflects at the right angle, rounds
 * corners/fence-ends, and accounts for ball radius + wall thickness — matching
 * how the ball actually bounces.
 *
 * Movers are predicted where they WILL be, not where they are: the prediction
 * is time-parameterised (distance / ball speed), and because a mover travels at
 * piecewise-constant velocity (constant until it flips at a track end), the
 * exact static capsule test applies inside each flip interval in the mover's
 * reference frame — see moverFirstHit. The one un-modelable mover case is a
 * mover overtaking a slower ball from behind: the physics then shoves the ball
 * along instead of reflecting it, so the preview ends at that contact.
 *
 * Other balls are included as STATIC snapshots at their current positions
 * (their own motion is chaotic, so "where they will be" is unknowable). The
 * outcome mirrors handleBallCollisions with a stationary target: the predicted
 * ball keeps its tangential component and hands off the normal one (equal-mass
 * elastic exchange), i.e. it deflects along the tangent, or stops dead on a
 * head-on hit (the preview ends there). A tap-frozen ball has infinite mass,
 * so the preview reflects off it like a wall. Because the snapshot ages, later
 * legs are increasingly approximate — inherent to a forward preview.
 *
 * Per-bounce speed shifts (yellow ball) are still not modelled.
 */
/**
 * One collision surface for the trajectory raycast.
 *
 * `pad` is the surface's own half-thickness, NOT the swept radius: the ball's
 * radius is added at test time instead of baked in here. That is what lets a
 * single built set serve every ball in the frame regardless of size, which is
 * the entire point of building it separately.
 */
export interface TrajectorySeg {
  ax: number; ay: number; bx: number; by: number;
  /** Added to the predicted ball's radius to get the capsule radius. */
  pad: number;
  id: string;
}

/**
 * Build the trajectory collision surfaces once for a whole frame.
 *
 * The path preview is drawn per tracked ball, and this set used to be rebuilt
 * inside every one of those calls - so a fully upgraded SCRUM Master (which
 * tracks EVERY active ball, four bounces deep) rebuilt an array of every fence,
 * board edge and obstacle edge on the map once per ball, sixty times a second.
 * The work and the garbage both scaled with balls x segments for a result that
 * is identical across all of them.
 *
 * Board edges collide at exactly the ball radius (matching the boardPolygon
 * collision) and so do obstacle polygon edges; user fences add half the wall
 * thickness (matching collideBallWithWall). Obstacle-boundary walls are skipped,
 * being handled via their polygons.
 */
export function buildTrajectorySegments(
  walls: Wall[],
  obstaclePolygons: Polygon[] = [],
): TrajectorySeg[] {
  const segs: TrajectorySeg[] = [];
  for (const wall of walls) {
    if (wall.id.startsWith('obstacle-')) continue;
    const pad = wall.id.startsWith('board-') ? 0 : (wall.thickness ?? 0) / 2;
    segs.push({ ax: wall.start.x, ay: wall.start.y, bx: wall.end.x, by: wall.end.y, pad, id: wall.id });
  }
  for (let pi = 0; pi < obstaclePolygons.length; pi++) {
    const vs = obstaclePolygons[pi].vertices;
    for (let i = 0; i < vs.length; i++) {
      const j = (i + 1) % vs.length;
      segs.push({ ax: vs[i].x, ay: vs[i].y, bx: vs[j].x, by: vs[j].y, pad: 0, id: `obs:${pi}:${i}` });
    }
  }
  return segs;
}

export function computeBallTrajectory(
  ballPosition: Vector2,
  ballVelocity: Vector2,
  walls: Wall[],
  numBounces: number,
  ballRadius = 0,
  obstaclePolygons: Polygon[] = [],
  movers: ReadonlyArray<TrajectoryMover> = [],
  /** Ball time-scale vs movers (Scope Creep): pass game.creepFactor. */
  ballSpeedScale = 1,
  /** Same-region active balls (excluding the predicted one), as snapshots. */
  otherBalls: ReadonlyArray<TrajectoryBall> = [],
  /**
   * Prebuilt collision surfaces from buildTrajectorySegments, shared across every
   * ball predicted this frame. Omit and they are built here, which is fine for a
   * single call and wasteful for a loop - see that function for why it matters.
   */
  prebuiltSegs?: ReadonlyArray<TrajectorySeg>,
  /**
   * Everything that bends a heading: map gravity AND gravity wells, read through
   * the same steerHeading updateBall uses (see physics/steering.ts). When a
   * board pulls, the path CURVES, and a straight ray per bounce draws a line the
   * ball never takes - on a preview the player may have spent up to 488h of
   * upgrades on. Passing this marches each leg in short chords, re-steering
   * between them exactly as the physics does.
   *
   * It used to take a gravity CONFIG and knew only about the map mutator, which
   * is how the preview came to be confidently wrong on the six authored well
   * maps and wrong in proportion to the Free Fall upgrades you had bought.
   * Omitted, or on a board where nothing pulls, the fast analytic path is
   * unchanged and nothing pays for this.
   */
  steer?: { world: SteerWorld; atSeconds: number } | null,
  /**
   * Filled with the waypoint index of each BOUNCE, in order.
   *
   * Needed because a waypoint is not a bounce. Under steering the path is
   * marched in short chords and every chord pushes a waypoint too, so
   * `points[n]` is only the nth bounce on a board where nothing pulls. A caller
   * that wants "the path up to bounce N" - the renderer, drawing the part the
   * upgrade paid for at full strength - has to be told, and slicing by index
   * instead is what collapsed the preview to three chords on the well maps.
   */
  out?: { bounceAt: number[] },
  /**
   * The predicted ball's own quarter-turn schedule (the compass), or null.
   * Unlike everything else here this is exact, not an approximation: see
   * trajectoryTurnsFor.
   */
  turns?: TrajectoryTurns | null,
): Vector2[] {
  const points: Vector2[] = [{ ...ballPosition }];
  const vLen = Math.sqrt(ballVelocity.x * ballVelocity.x + ballVelocity.y * ballVelocity.y);
  if (vLen <= 1e-9) return points;
  let ox = ballPosition.x, oy = ballPosition.y;
  let dx = ballVelocity.x / vLen, dy = ballVelocity.y / vLen;
  // Effective speed in world units/s — movers advance on unscaled time, balls
  // on creep-scaled time, so the creep factor folds into the ball's speed.
  // Mutable: a ball-ball deflection sheds the normal component (see below).
  let speed = vLen * ballSpeedScale;

  const segs = prebuiltSegs ?? buildTrajectorySegments(walls, obstaclePolygons);
  let skipId = ""; // don't immediately re-hit the surface we just bounced off
  let tNow = 0;    // absolute prediction time at the current leg's start

  // Curvature budget. A chord short enough to turn only MAX_TURN_PER_CHORD
  // radians keeps the drawn line smooth; MAX_STEPS bounds the total work so a
  // long shallow arc can never make this loop expensive without limit.
  const MAX_TURN_PER_CHORD = 0.15;
  const MAX_STEPS = 160;
  const ALIGNED = 0.02; // once within this of the pull, the path is straight again

  let bounces = 0, steps = 0;
  while (bounces < numBounces && steps < MAX_STEPS) {
    steps++;

    // Cap this leg to a chord while anything is pulling, unless the heading has
    // already converged on that pull, in which case the rest of the leg IS
    // straight and the analytic cast is both cheaper and exact.
    //
    // A WELL only pulls where the ball is, so its chord has to be re-decided at
    // every step: a path can leave a well mid-leg and go straight again, or
    // enter one and start curving, and a leg length fixed at the start of the
    // cast would miss both.
    let chordDist = Infinity;
    let pull: Vector2 | null = null;
    let turnRate = 0;

    // A LODESTONE bends the path toward itself wherever the predicted ball is,
    // so it decides the chord the same way a well does. Summed with the board's
    // own pull rather than replacing it: a ball inside a well AND in range of a
    // lodestone feels both, and the physics adds them too.
    let attractX = 0, attractY = 0, attractRate = 0;
    for (const ob of otherBalls) {
      if (!ob.attractTurnRate) continue;
      const ax = ob.position.x - ox, ay = ob.position.y - oy;
      const dist = Math.hypot(ax, ay);
      const radius = ob.attractRadius ?? DEFAULT_ATTRACT_RADIUS;
      if (dist > radius || dist < 1) continue;
      // Linear falloff to zero at the rim, matching lodestone.ts exactly: a
      // preview that eased off differently would drift from the ball wherever
      // the pull is weakest, which is most of the well's area.
      const strength = ob.attractTurnRate * (1 - dist / radius);
      if (strength <= 0) continue;
      attractX += (ax / dist) * strength;
      attractY += (ay / dist) * strength;
      attractRate += strength;
    }

    if (steer) {
      const here = { x: ox, y: oy };
      const wellPull = wellPullAt(here, steer.world);
      if (wellPull) {
        pull = wellPull;
        turnRate = wellTurnRateAt(here, steer.world);
      } else if (mapGravityActive(steer.world)) {
        pull = gravityVectorAt(steer.atSeconds + tNow, steer.world.gravityConfig!);
        turnRate = steer.world.gravityConfig!.turnRate;
      }
      // The Free Fall line softens every bend, and the preview ignoring it made
      // the forecast wrong in proportion to how much the player had spent on it.
      const bend = steer.world.gravityBendMultiplier ?? 1;
      turnRate *= Number.isFinite(bend) && bend > 0 ? bend : 1;
      if (!(turnRate > 0)) pull = null;
    }

    if (attractRate > 0) {
      // Blend the board's pull with the lodestone's, weighted by how hard each
      // is pulling, so a strong well and a weak lodestone read as the well.
      const px = (pull ? pull.x * turnRate : 0) + attractX;
      const py = (pull ? pull.y * turnRate : 0) + attractY;
      const len = Math.hypot(px, py);
      if (len > 1e-9) {
        pull = { x: px / len, y: py / len };
        turnRate += attractRate;
      }
    }

    if (pull && turnRate > 0) {
      const cross = dx * pull.y - dy * pull.x;
      const dot2 = dx * pull.x + dy * pull.y;
      const remaining = Math.abs(Math.atan2(cross, dot2));
      if (remaining > ALIGNED) chordDist = speed * (MAX_TURN_PER_CHORD / turnRate);
    } else {
      pull = null;
    }

    // The COMPASS turn, which is exact. Cut the leg at the moment the turn
    // lands so the waypoint is where the ball really changes heading, rather
    // than drawing straight through a turn it has already committed to.
    let turnAt = Infinity;
    if (turns && turns.intervalSeconds > 0) {
      const since = tNow - turns.firstTurnIn;
      const next = since < 0
        ? turns.firstTurnIn
        : turns.firstTurnIn + (Math.floor(since / turns.intervalSeconds) + 1) * turns.intervalSeconds;
      const until = next - tNow;
      if (until >= 0) turnAt = until * speed;
      if (turnAt < chordDist) chordDist = turnAt;
    }
    // Earliest static hit, converted to TIME so movers compete on equal terms.
    let bestTime = Infinity, bnx = 0, bny = 0, bestId = "";
    for (const s of segs) {
      if (s.id === skipId) continue;
      const hit = capsuleRayHit(ox, oy, dx, dy, s.ax, s.ay, s.bx, s.by, ballRadius + s.pad);
      if (!hit) continue;
      const time = hit.t / speed;
      if (time < bestTime) { bestTime = time; bnx = hit.nx; bny = hit.ny; bestId = s.id; }
    }
    // Movers, at where they will be (window pruned by the best hit so far).
    for (let mi = 0; mi < movers.length; mi++) {
      const mh = moverFirstHit(movers[mi], mi, ox, oy, dx, dy, speed, ballRadius, tNow, bestTime, skipId);
      if (mh && mh.time < bestTime) { bestTime = mh.time; bnx = mh.nx; bny = mh.ny; bestId = mh.id; }
    }
    // Other balls, as static circles at centre-to-centre contact distance.
    let hitBall: TrajectoryBall | null = null;
    for (let bi = 0; bi < otherBalls.length; bi++) {
      const b = otherBalls[bi];
      const id = `ball:${bi}`;
      if (id === skipId) continue;
      const t = rayCircleFirstHit(ox, oy, dx, dy, b.position.x, b.position.y, ballRadius + b.radius);
      if (t == null) continue;
      const time = t / speed;
      if (time < bestTime) {
        bestTime = time;
        const hx = ox + dx * t, hy = oy + dy * t;
        const nl = Math.hypot(hx - b.position.x, hy - b.position.y) || 1;
        bnx = (hx - b.position.x) / nl;
        bny = (hy - b.position.y) / nl;
        bestId = id;
        hitBall = b;
      }
    }
    // Nothing struck within this chord: advance along it, bend the heading, and
    // carry on WITHOUT spending a bounce. This is what draws the arc.
    const chordTime = chordDist / speed;
    if (!Number.isFinite(bestTime) || bestTime > chordTime) {
      // A compass turn ends the leg even on a board that pulls at nothing, so
      // the chord is only pointless when neither is happening.
      const turnEndsLeg = Number.isFinite(turnAt) && turnAt <= chordDist + 1e-6;
      if ((!pull && !turnEndsLeg) || !Number.isFinite(chordTime)) break;
      const nx2 = ox + dx * chordDist, ny2 = oy + dy * chordDist;
      points.push({ x: nx2, y: ny2 });
      if (pull) {
        const steered = steerToward({ x: dx, y: dy }, pull, turnRate, chordTime);
        const sl = Math.hypot(steered.x, steered.y) || 1;
        dx = steered.x / sl; dy = steered.y / sl;
      }
      if (turnEndsLeg && turns) {
        // Exactly ninety degrees, in the direction the ring has been showing
        // for a whole cycle. Rotating the HEADING, magnitude untouched, which
        // is what tickTurnTimer does to the velocity.
        const rot = turns.direction;
        const ndx = -dy * rot, ndy = dx * rot;
        dx = ndx; dy = ndy;
      }
      ox = nx2; oy = ny2;
      tNow += chordTime;
      skipId = ""; // a new heading may legitimately meet the last surface again
      continue;
    }

    // Waypoint = ball CENTRE at contact (distance R from the surface).
    const hx = ox + dx * speed * bestTime, hy = oy + dy * speed * bestTime;
    points.push({ x: hx, y: hy });

    // The physics only reflects when moving INTO the surface; dot >= 0 means a
    // mover caught the ball from behind and will shove it — end the preview.
    const dot = dx * bnx + dy * bny;
    if (dot >= 0) break;

    if (hitBall && !hitBall.frozen) {
      // Equal-mass elastic exchange vs a (snapshot-)stationary ball: the normal
      // component transfers to the struck ball; the predicted one continues
      // along its tangent at reduced speed. Head-on = dead stop: preview ends.
      dx -= dot * bnx;
      dy -= dot * bny;
      const tangential = Math.sqrt(dx * dx + dy * dy);
      if (tangential < 0.05) break;
      speed *= tangential;
      dx /= tangential;
      dy /= tangential;
    } else {
      // Walls, movers and tap-frozen balls (infinite mass): angle in = angle out.
      dx -= 2 * dot * bnx;
      dy -= 2 * dot * bny;
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dl; dy /= dl;
    }

    ox = hx + dx * 1e-3; // nudge a hair off the surface to avoid self-hit
    oy = hy + dy * 1e-3;
    tNow += bestTime + 1e-3 / speed; // count the nudge so mover phase stays in sync
    skipId = bestId;
    bounces++;
    out?.bounceAt.push(points.length - 1);
  }

  return points;
}
