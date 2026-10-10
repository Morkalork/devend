/**
 * Light as a mechanic: the 3D board's light carrying information the board
 * did not show before. Each one reads state the simulation already keeps and
 * changes nothing in it, so lockstep never sees any of this, and each has a
 * Playground dial (lightLook.ts) where 0 is the board without it.
 *
 *   POCKET GLOW   a ball's light grows hotter as its pocket tightens toward
 *                 the lock threshold, and turns gold once halving the pocket
 *                 would make a SUPERIOR lock. A threshold the player could
 *                 only find by cutting becomes something to aim for.
 *   CHARGE TELL   an armed Deploy Charge lights exactly its blast radius red,
 *                 pulsing faster as it nears; any fence in the red goes with
 *                 the blast. The cost of detonating is visible before it is
 *                 paid.
 *   PHASE TELL    a phasing pillar's shadow grows in on the floor just before
 *                 the pillar turns solid: the shadow first, then the wall.
 *   POWER DRAIN   through a timed map's last stretch the room dims and
 *                 stutters at the clock's milestones, while the balls' own
 *                 light stays steady, so they are what stays readable.
 *   CIRCUIT SPARK lighting a terminal sends a spark of light to the ball it
 *                 wakes, so which terminal wakes which ball explains itself.
 *
 * The cut preview is the sixth and has its own module (cutPreview3d.ts).
 */
import type { CanvasGameState, CircuitRuntimeTerminal } from "@/types/gameState";
import { obstacleRiseOf, roleRises, type Solid } from "./solids3d";
import type { WantedLight } from "./lights3d";
import { polygonCentroid, type Polygon } from "@/lib/polygon";
import { worldToGridIndex } from "@/lib/spaceGrid";
import { getLockQuality } from "@/lib/scoring";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import { secondsUntilSolid } from "@/lib/physics/phasing";
import { DEADLINE_MILESTONES } from "@/lib/deadlineDisplay";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import { HEIGHTS } from "./heights3d";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ── Pocket glow ────────────────────────────────────────────────────────────

/** The superior lock's gold (the same the lock flash and its tint use). */
export const POCKET_GOLD = PALETTE.superior;

/**
 * How tight a pocket is, from its share of the win denominator, against the
 * map's lock threshold and the superior bar. Pure, for the tests.
 *
 *   heat  0 at four times the lock threshold, 1 at the threshold itself.
 *   gold  0 at three times the superior bar, 1 at twice it: a pocket that a
 *         cut through its middle would leave superior.
 */
export function pocketTightness(
  percent: number, threshold: number, superiorBar: number,
): { heat: number; gold: number } {
  if (!(threshold > 0) || !(percent > 0)) return { heat: 0, gold: 0 };
  const heat = smooth(4 * threshold, threshold, percent);
  const gold = superiorBar > 0 ? smooth(3 * superiorBar, 2 * superiorBar, percent) : 0;
  return { heat, gold };
}

/**
 * Every live ball's pocket tightness, measured the way checkBallWonState
 * measures a pocket at lock time: the ball's region over the same
 * denominator, against the same thresholds.
 */
export function pocketHeat(game: CanvasGameState): Map<string, { heat: number; gold: number }> {
  const out = new Map<string, { heat: number; gold: number }>();
  const grid = game.spaceGrid;
  if (!grid) return out;
  const sizes = new Map<string, number>();
  for (const r of game.gridRegions ?? []) sizes.set(r.id, r.cellCount);
  const live = game.balls.filter(b => b.state !== "won" && b.state !== "dormant" && b.speed > 0);
  const denominator = Math.max(grid.activeCount, Math.floor(grid.initialActiveCount / Math.max(1, live.length)));
  if (denominator <= 0) return out;
  const threshold = game.lockWinThresholdPercent ?? BALL_WON_REGION_THRESHOLD;
  const base = game.lockBaseThresholdPercent ?? threshold;
  const bar = base * getLockQuality().superiorThresholdFraction;
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    const p = b.renderPosition ?? b.position;
    const id = grid.cellRegionIds[worldToGridIndex(grid, p.x, p.y)];
    const cells = id ? sizes.get(id) : undefined;
    if (!cells) continue;
    out.set(b.id, pocketTightness((cells / denominator) * 100, threshold, bar));
  }
  return out;
}

// ── Charge tell ────────────────────────────────────────────────────────────

/** The armed charge's red, and the idle fuse's amber. */
const CHARGE_RED = 0xff3020;
const FUSE_AMBER = 0xffa64d;

/**
 * The pulse of an armed charge, 0..1, `t` seconds after arming with `delay`
 * seconds to go. The rate climbs from about once a second to eight times a
 * second at the blast, and the PHASE is the integral of the rate, so the pulse
 * speeds up smoothly instead of jumping between rates.
 */
export function chargePulse(t: number, delay: number): number {
  const d = Math.max(0.1, delay);
  const cycles = 1.2 * t + (7 * t * t * t) / (3 * d * d);
  const c = 0.5 + 0.5 * Math.cos(cycles * Math.PI * 2);
  return c * c;
}

/** Lights for every charge on the board: a red blast radius once armed. */
export function chargeLights(game: CanvasGameState, gain: number): WantedLight[] {
  const out: WantedLight[] = [];
  if (gain <= 0.001) return out;
  for (const c of game.charges ?? []) {
    if (c.blown) continue;
    // Centred where physics will centre the blast: the target slab, else the fuse.
    const target = game.destructibles?.find(d => d.id === c.targetId && !d.destroyed);
    const poly = target?.obstaclePolygon ?? target?.mirrorPolygon;
    const at = poly ? polygonCentroid(poly) : c.fuse;
    if (c.armedAt === null) {
      out.push({ x: c.fuse.x, y: c.fuse.y, height: 16, reach: 45, intensity: 0.25 * gain, color: FUSE_AMBER, rank: 3 });
      continue;
    }
    const t = Math.max(0, game.activePlaySeconds - c.armedAt);
    const progress = Math.min(1, t / Math.max(0.1, c.delaySeconds));
    const pulse = chargePulse(t, c.delaySeconds);
    out.push({
      x: at.x, y: at.y, height: 24, reach: c.blastRadius,
      intensity: gain * (0.35 + 1.1 * pulse) * (0.6 + 0.4 * progress),
      color: CHARGE_RED, rank: 1, cutoff: true,
    });
  }
  return out;
}

// ── Phase tell ─────────────────────────────────────────────────────────────

/** How long before a pillar turns solid its shadow starts growing in, seconds. */
export const PHASE_LEAD_SECONDS = 0.8;

/**
 * Shadow casters for pillars about to turn solid: the pillar's footprint,
 * rising from nothing to full height over the lead, so its shadow lengthens in
 * across the floor while the pillar itself is still a ghost.
 */
export function phaseCasters(game: CanvasGameState, gain: number, heightScale: number): Solid[] {
  const out: Solid[] = [];
  if (gain <= 0.001) return out;
  let roles: Map<Polygon, number> | null = null;
  for (const obj of game.phasingObjects ?? []) {
    const until = secondsUntilSolid(obj, game.activePlaySeconds);
    if (until === null || until > PHASE_LEAD_SECONDS) continue;
    const rise = 1 - until / PHASE_LEAD_SECONDS;
    roles ??= roleRises(game);
    const tall = obstacleRiseOf(game, obj.polygon, roles);
    out.push({ vertices: obj.polygon.vertices, height: HEIGHTS.slab * tall * heightScale * rise * gain });
  }
  return out;
}

// ── Power drain ────────────────────────────────────────────────────────────

/** The most the drain takes off the room, at the very end. */
export const DRAIN_DEPTH = 0.4;

/**
 * The room's power, 0..1, `secondsLeft` into a map with `limit` seconds. Full
 * until the last stretch (the last 30 seconds, or the last half of a shorter
 * map), then easing down by up to DRAIN_DEPTH; for the first 0.6 seconds after
 * each milestone it stutters, three quick dips like a supply browning out.
 */
export function powerLevel(secondsLeft: number, limit: number, gain: number): number {
  if (!(limit > 0) || gain <= 0.001) return 1;
  const s = Math.max(0, secondsLeft);
  const window = Math.min(30, limit * 0.5);
  let level = 1 - DRAIN_DEPTH * gain * smooth(window, 0, s);
  for (const m of DEADLINE_MILESTONES) {
    if (!(limit > m)) continue;
    const dt = m - s;
    if (dt < 0 || dt > 0.6) continue;
    let dip = 0;
    for (const at of [0.04, 0.2, 0.42]) dip = Math.max(dip, Math.exp(-((dt - at) ** 2) / (2 * 0.035 * 0.035)));
    level *= 1 - 0.5 * gain * dip;
  }
  return level;
}

// ── Circuit spark ──────────────────────────────────────────────────────────

/** How long a spark takes from its terminal to its ball, ms. */
export const SPARK_MS = 520;

interface Spark { terminal: CircuitRuntimeTerminal; start: number }

/** Sparks running from newly lit terminals to the balls they wake. */
export class CircuitSparks {
  private lit = new WeakMap<CircuitRuntimeTerminal, boolean>();
  private sparks: Spark[] = [];
  private primed = new WeakSet<object>();

  /** This frame's spark lights; call once per frame. */
  sync(game: CanvasGameState, now: number, gain: number): WantedLight[] {
    const circuit = game.circuit;
    if (circuit) {
      // The terminals lit when the map starts are not news.
      const first = !this.primed.has(circuit);
      this.primed.add(circuit);
      for (const t of circuit.terminals) {
        const was = this.lit.get(t) ?? t.lit;
        if (!first && t.lit && !was) this.sparks.push({ terminal: t, start: now });
        this.lit.set(t, t.lit);
      }
    }
    this.sparks = this.sparks.filter(s => now - s.start < SPARK_MS + 200 && now >= s.start);
    const out: WantedLight[] = [];
    if (gain <= 0.001) return out;
    for (const s of this.sparks) {
      const ball = game.balls.find(b => b.id === s.terminal.ballId);
      const to = ball ? (ball.renderPosition ?? ball.position) : s.terminal;
      const k = smooth(0, SPARK_MS, now - s.start);
      // The arrival flares; past it the light settles into the ball's own.
      const arrive = Math.max(0, 1 - Math.abs(now - s.start - SPARK_MS) / 200);
      out.push({
        x: s.terminal.x + (to.x - s.terminal.x) * k,
        y: s.terminal.y + (to.y - s.terminal.y) * k,
        height: 20, reach: 70 + 50 * arrive,
        intensity: gain * (1.4 + 1.6 * arrive) * (now - s.start < SPARK_MS ? 1 : arrive),
        color: PALETTE.areaConst, rank: 1,
      });
    }
    return out;
  }
}
