/**
 * Phasing objects (issue #64) — obstacles that fade solid (`in`) and intangible
 * (`out`) on a repeating cycle. While phased out, balls / fences / chains pass
 * through them (see the phased-out skips in updateBall + chain.ts). The in->out
 * transition fires a localized shockwave that flings nearby balls free, which is
 * how a boss-20 pair snagged on the obstacle gets released.
 *
 * One cycle (default 10s): ~62% solid, a short fade-out, ~24% out, a short
 * fade-in. `alpha` (1=solid, 0=gone) drives both collision and rendering; the
 * two states are visually distinct (solid block vs ghost outline).
 */
import { CanvasGameState } from "@/types/gameState";
import { PhasingObjectState } from "@/types/game";
import { polygonCentroid } from "@/lib/polygon";

const FADE = 0.08;        // fraction of the cycle each fade takes
const OUT_FRACTION = 0.3; // fraction of the cycle spent (fully or fading) out

/** Shockwave a phase-out gives balls within this many world units of the object. */
export const PHASE_SHOCKWAVE_RADIUS = 220;
const PHASE_SHOCKWAVE_BOOST = 1.35;

/** Compute the phase + alpha for a cycle position t in [0,1). */
function phaseAt(t: number): { phase: "in" | "out"; alpha: number } {
  // Layout across the cycle: [ solid | fade-out | out | fade-in ]
  const outStart = 1 - OUT_FRACTION;          // begin fading out
  const outFull = outStart + FADE;            // fully out
  const inStart = 1 - FADE;                   // begin fading back in
  if (t < outStart) return { phase: "in", alpha: 1 };
  if (t < outFull) return { phase: "in", alpha: 1 - (t - outStart) / FADE };
  if (t < inStart) return { phase: "out", alpha: 0 };
  return { phase: "in", alpha: (t - inStart) / FADE };
}

/**
 * Advance every phasing object. `nowActiveSeconds` is game.activePlaySeconds.
 * When an object crosses into its `out` phase it fires a one-shot shockwave.
 */
export function tickPhasing(game: CanvasGameState, nowActiveSeconds: number): void {
  const objs = game.phasingObjects;
  if (!objs || objs.length === 0) return;

  for (const obj of objs) {
    const cyc = obj.cycleSeconds > 0 ? obj.cycleSeconds : 10;
    const t = ((nowActiveSeconds - obj.startedAt) % cyc + cyc) % cyc / cyc;
    const { phase, alpha } = phaseAt(t);
    const wasIn = obj.phase === "in";
    obj.phase = phase;
    obj.alpha = alpha;

    // Fire the shockwave once per cycle, on the in -> out transition.
    if (wasIn && phase === "out") {
      if (obj.firedOutAt === undefined || nowActiveSeconds - obj.firedOutAt > cyc * 0.5) {
        obj.firedOutAt = nowActiveSeconds;
        emitPhaseShockwave(game, obj);
      }
    }
    if (phase === "in") obj.firedOutAt = undefined; // re-arm for the next cycle
  }
}

/** Fling every active ball near the phasing object outward from its centre. */
function emitPhaseShockwave(game: CanvasGameState, obj: PhasingObjectState): void {
  const c = polygonCentroid(obj.polygon);
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    let dx = b.position.x - c.x, dy = b.position.y - c.y;
    let d = Math.hypot(dx, dy);
    if (d > PHASE_SHOCKWAVE_RADIUS) continue;
    const sp = (Math.hypot(b.velocity.x, b.velocity.y) || b.baseSpeed || 100) * PHASE_SHOCKWAVE_BOOST;
    if (d < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy) || 1; }
    dx /= d; dy /= d;
    b.velocity.x = dx * sp; b.velocity.y = dy * sp; b.speed = sp;
  }
}

/**
 * The obstacle polygons + edge-wall ids currently intangible (phased out), for
 * the collision skips in updateBall / chain.ts. Returns null when nothing is
 * phased out, so callers pay nothing on the common (no-phasing) map.
 */
export function collectPhasedOut(game: CanvasGameState): { polys: Set<import("@/lib/polygon").Polygon>; walls: Set<string> } | null {
  if (!game.phasingObjects || game.phasingObjects.length === 0) return null;
  const polys = new Set<import("@/lib/polygon").Polygon>();
  const walls = new Set<string>();
  for (const obj of game.phasingObjects) {
    if (obj.phase === "out" || obj.alpha < 0.5) {
      polys.add(obj.polygon);
      for (const id of obj.wallIds) walls.add(id);
    }
  }
  return polys.size === 0 ? null : { polys, walls };
}
