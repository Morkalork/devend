/**
 * Phasing objects (issue #64) — obstacles that fade solid (`in`) and intangible
 * (`out`) on a repeating cycle. While phased out, balls / fences / chains pass
 * through them (see the phased-out skips in updateBall + chain.ts). The in->out
 * transition fires a localized shockwave that flings nearby balls free, which is
 * how a boss-20 pair snagged on the obstacle gets released.
 *
 * One cycle (default 10s): ~55% solid, then intangible for the rest (a fade-out,
 * a fully-gone stretch, and a fade back in). `phase` is the SOURCE OF TRUTH for
 * tangibility: `phase === "out"` means the ball / fence / chain passes through
 * it, and it renders as a ghost. Crucially the object turns intangible the
 * instant it *visibly* begins to phase out (issue #69) — never a window where it
 * looks like it's dissolving but still bounces things. `alpha` (1=solid, 0=gone)
 * only drives how faint the render is, not collision.
 */
import { CanvasGameState } from "@/types/gameState";
import { PhasingObjectState } from "@/types/game";
import { polygonCentroid } from "@/lib/polygon";

const FADE = 0.1;             // fraction of the cycle each cosmetic fade takes
const SOLID_FRACTION = 0.55;  // fraction of the cycle the object is solid (tangible)

/** Shockwave a phase-out gives balls within this many world units of the object. */
export const PHASE_SHOCKWAVE_RADIUS = 220;
const PHASE_SHOCKWAVE_BOOST = 1.35;

/**
 * Compute the phase + alpha for a cycle position t in [0,1).
 *
 * `phase` flips to "out" (intangible) the moment the fade-out starts, so the
 * object stops colliding exactly when it starts to look like it's dissolving.
 * On the way back it stays intangible until it is at least half re-formed, so a
 * ball can't get caught inside a pillar that pops solid under it.
 */
function phaseAt(t: number): { phase: "in" | "out"; alpha: number } {
  // Layout across the cycle: [ solid | fade-out | fully out | fade-in ]
  const outStart = SOLID_FRACTION;            // begin fading out AND go intangible
  const outFull = outStart + FADE;            // fully out
  const inStart = 1 - FADE;                   // begin fading back in
  if (t < outStart) return { phase: "in", alpha: 1 };
  if (t < outFull) return { phase: "out", alpha: 1 - (t - outStart) / FADE };
  if (t < inStart) return { phase: "out", alpha: 0 };
  // Fade back in: intangible (still a ghost) until it is at least half solid.
  const a = (t - inStart) / FADE;
  return { phase: a >= 0.5 ? "in" : "out", alpha: a };
}

/**
 * Advance every phasing object. `nowActiveSeconds` is game.activePlaySeconds.
 * When an object crosses into its `out` phase it fires a one-shot shockwave.
 */
export function tickPhasing(game: CanvasGameState, nowActiveSeconds: number): void {
  const objs = game.phasingObjects;
  if (!objs || objs.length === 0) return;

  for (const obj of objs) {
    // A CAGE mouth is driven by tickCages, which knows whether a ball is
    // inside. Skipped here rather than given a phase by both, which would have
    // the clock slamming a mouth shut on nothing.
    if (obj.cageOf) continue;

    // A LATCH is opened by progress, not by a clock, and once open it stays
    // open: it is the only object that connects the furniture to the
    // objectives, so a map can have two acts. Handled before the cycle maths
    // because none of it applies - there is no period, and re-closing would
    // make the thing the player earned a temporary loan.
    if (obj.latchAfter !== undefined) {
      const done = obj.latchOn === 'smashes'
        ? (game.objectivesBroken ?? 0)
        : game.lockedBallsCount;
      const open = done >= obj.latchAfter;
      const wasIn = obj.phase === "in";
      obj.phase = open ? "out" : "in";
      obj.alpha = open ? 0 : 1;
      // The same shockwave a phasing object fires when it blinks out, so a
      // latch opening is felt rather than merely noticed - and once only,
      // because it never closes again.
      if (wasIn && open && obj.firedOutAt === undefined) {
        obj.firedOutAt = nowActiveSeconds;
        emitPhaseShockwave(game, obj);
      }
      continue;
    }

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
    // `phase === "out"` is the single source of truth for intangibility (#69):
    // it is set the instant the object begins to fade out and cleared only once
    // it is at least half re-formed, so collision always matches the ghost look.
    if (obj.phase === "out") {
      polys.add(obj.polygon);
      for (const id of obj.wallIds) walls.add(id);
    }
  }
  return polys.size === 0 ? null : { polys, walls };
}
