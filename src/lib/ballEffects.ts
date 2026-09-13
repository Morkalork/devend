import { hexToRgba } from "@/lib/gameUtils";
import {
  splatOutline, splatMetrics, isDeformed, ROUND, type SplatState,
} from "@/lib/rendering/splatShape";

// ── Pulse glow OffscreenCanvas cache ─────────────────────────────────────────
// Pre-renders the always-active baseline glow at max intensity (alpha = 1).
// Each frame the OC is blitted with globalAlpha = pulse.glowAlpha, eliminating
// createRadialGradient() calls per ball per frame.
interface PulseGlowEntry { oc: OffscreenCanvas; halfSize: number }
const _pulseGlowCache = new Map<string, PulseGlowEntry>();

function getPulseGlowOC(accentColor: string, screenRadius: number, scale: number): PulseGlowEntry {
  const maxOuterRadius = screenRadius * 1.08 + 12 * scale;
  const key = `${accentColor}:${Math.round(maxOuterRadius)}`;
  const existing = _pulseGlowCache.get(key);
  if (existing) return existing;
  const halfSize = Math.ceil(maxOuterRadius) + 2;
  const size = halfSize * 2;
  const oc = new OffscreenCanvas(size, size);
  const octx = oc.getContext('2d')!;
  octx.beginPath();
  octx.arc(halfSize, halfSize, maxOuterRadius, 0, Math.PI * 2);
  const grad = octx.createRadialGradient(
    halfSize, halfSize, screenRadius * 0.3,
    halfSize, halfSize, maxOuterRadius,
  );
  grad.addColorStop(0,   hexToRgba(accentColor, 0.6));
  grad.addColorStop(0.4, hexToRgba(accentColor, 0.4));
  grad.addColorStop(0.7, hexToRgba(accentColor, 0.15));
  grad.addColorStop(1,   'transparent');
  octx.fillStyle = grad;
  octx.fill();
  const entry: PulseGlowEntry = { oc, halfSize };
  _pulseGlowCache.set(key, entry);
  return entry;
}

/** Drop cached glow surfaces — call on window resize (scale changes). */
export function clearBallEffectsCache(): void {
  _pulseGlowCache.clear();
}

// Ball Visual Effects System
// Manages the visual hierarchy of ball effects:
// 1. Baseline pulse (always active, subtle)
// 2. Wall collision effect (medium intensity)
// 3. Ball-to-ball collision effect (strongest)

export interface BallEffectState {
  // Baseline pulse phase (0 to 2π, continuously cycles)
  pulsePhase: number;
  
  // Wall collision effect (0-1, decays over time)
  wallHitIntensity: number;
  wallHitTime: number; // timestamp when wall hit occurred
  
  // Ball-to-ball collision effect (0-1, decays over time)
  ballHitIntensity: number;
  ballHitTime: number; // timestamp when ball hit occurred

  // ── Squash & stretch on contact (issue #44) ────────────────────────────────
  // The impact axis and how hard the hit was, plus the four shape dials the
  // renderer draws from. See CONFIG's choreography block and splatShape.ts.
  /** Timestamp of the impact the current deformation came from. */
  squishTime: number;
  /** Unit impact normal: the axis the ball is pressed along, pointing OFF the wall. */
  squishNx: number;
  squishNy: number;
  /** Peak deformation for this hit, 0..1. A bounce is a small fraction of a splat. */
  squishAmount: number;
  /** While in the future the splat is pinned at full instead of releasing (Bug Squash). */
  squishHoldUntil: number;
  /** Timescale: 1 for a splat, faster for a passing bounce. */
  squishSpeed: number;
  /** The four dials, recomputed every tick. See SplatState in splatShape.ts. */
  splatD: number;
  splatV: number;
  splatW: number;
  splatStretch: number;
}

// Effect configuration
const CONFIG = {
  // Baseline pulse
  pulseFrequency: 1.2, // Hz - slow, non-distracting
  pulseGlowMin: 0.12, // Minimum glow alpha
  pulseGlowMax: 0.28, // Maximum glow alpha
  pulseRadiusMin: 1.0, // Scale factor for radius
  pulseRadiusMax: 1.08, // Slight radius increase at peak
  
  // Wall collision effect - LARGE HALO
  wallHitDuration: 280, // ms - slightly longer for bigger expansion
  wallHitGlowIntensity: 0.6, // Peak glow alpha
  wallHitRingRadius: 5.0, // Ring expands to 5x ball radius (was 1.5)
  wallHitRingWidth: 0.3, // Ring thickness as fraction of radius
  
  // Ball-to-ball collision effect - LARGEST HALO
  ballHitDuration: 350, // ms - longer for dramatic expansion
  ballHitGlowIntensity: 0.85, // Brighter than wall hit
  ballHitRingRadius: 6.5, // Expands to 6.5x ball radius (was 1.8)
  ballHitSecondaryPulse: true, // Optional spark-like secondary effect

  // ── Squash & stretch on contact (issue #44) ───────────────────────────────
  //
  // The SHAPE lives in rendering/splatShape.ts (a droplet: flat contact face,
  // mass pooled at the wall, domed crown). What is here is the CHOREOGRAPHY -
  // when each of the four dials moves - and it is the same for a passing bounce
  // and a Bug Squash splat, only faster and shallower for the bounce.
  //
  // The ordering is the whole effect, and it is why these are four dials rather
  // than one:
  //
  //   THE CONTACT FACE FORMS FIRST, alone, for about four frames. The ball
  //   still looks like a hard ball pressing into the wall, and only then does
  //   it give up and slump. That beat is what reads as "solid material suddenly
  //   went soft"; without it the ball simply appears in a different shape.
  //
  //   ON THE WAY OUT THE ORDER REVERSES. The crown lifts first while the
  //   footprint is still wide - the ball un-slumps upward before it lets go -
  //   and the contact face is the last thing to leave the wall.
  //
  // Times are milliseconds from the impact, at splat speed. A bounce runs the
  // identical curve at BOUNCE_SPEEDUP.
  splatContactMs: 70,       // contact face: 0 -> full
  splatSlumpFrom: 50,       // slump starts before the contact face has finished
  splatSlumpMs: 140,
  splatSpreadFrom: 60,
  splatSpreadMs: 130,
  splatInEndMs: 190,        // fully splatted
  splatSettleEndMs: 400,    // one jelly wobble after landing, then still

  // Release, measured from the moment the hold lifts.
  splatLiftMs: 350,         // crown recovers
  splatFaceFrom: 150,       // contact face starts letting go, later
  splatFaceMs: 370,
  splatFootFrom: 120,       // footprint narrows
  splatFootMs: 400,
  splatPeelFrom: 350,       // departure stretch along the normal
  splatPeelMs: 400,
  splatOutEndMs: 750,

  /**
   * A passing bounce runs the same droplet at a fraction of the depth, so the
   * material is consistent - a ball that goes soft when it sticks should not be
   * made of something else the rest of the time. Small on purpose: the contrast
   * with a full splat is part of what makes the splat read.
   */
  bounceSplatFraction: 0.15,
  /** ...and faster, so a bounce is over in ~380ms rather than ~940ms. */
  bounceSpeedup: 2.5,

  squishReferenceSpeed: 250, // world speed at which the squish magnitude saturates
};

/**
 * How much of the lost thickness a squashed ball spends spreading sideways.
 * 1 is strict area preservation (a disc); below it, some of the displacement is
 * read as going toward the viewer, where it cannot be seen. See getSquishEffect.
 */
const BULGE_EXPONENT = 0.75;

/**
 * Initialize effect state for a new ball
 */
export function createBallEffectState(): BallEffectState {
  return {
    pulsePhase: Math.random() * Math.PI * 2, // Random starting phase
    wallHitIntensity: 0,
    wallHitTime: 0,
    ballHitIntensity: 0,
    ballHitTime: 0,
    squishTime: 0,
    squishNx: 0,
    squishNy: 0,
    squishAmount: 0,
    squishHoldUntil: 0,
    squishSpeed: 1,
    splatD: 0,
    splatV: 0,
    splatW: 0,
    splatStretch: 0,
  };
}

/**
 * Update effect state each frame
 */
export function updateBallEffects(state: BallEffectState, dt: number, now: number): void {
  // Update baseline pulse phase (continuous cycle)
  state.pulsePhase += dt * CONFIG.pulseFrequency * Math.PI * 2;
  if (state.pulsePhase > Math.PI * 2) {
    state.pulsePhase -= Math.PI * 2;
  }
  
  // Decay wall hit effect
  if (state.wallHitIntensity > 0) {
    const elapsed = now - state.wallHitTime;
    if (elapsed >= CONFIG.wallHitDuration) {
      state.wallHitIntensity = 0;
    } else {
      // Ease-out decay
      const progress = elapsed / CONFIG.wallHitDuration;
      state.wallHitIntensity = 1 - (progress * progress);
    }
  }
  
  // Decay ball hit effect
  if (state.ballHitIntensity > 0) {
    const elapsed = now - state.ballHitTime;
    if (elapsed >= CONFIG.ballHitDuration) {
      state.ballHitIntensity = 0;
    } else {
      // Faster attack, smoother decay for more "pop"
      const progress = elapsed / CONFIG.ballHitDuration;
      state.ballHitIntensity = 1 - Math.pow(progress, 1.5);
    }
  }

  tickSplat(state, now);
}

/** 0..1, fast off the mark and settling in. easeOut(0) is 0, easeOut(1) is 1. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 2.2);
}
/** 0..1, slow off the mark. Used on the way out, so the ball is reluctant to leave. */
function easeIn(t: number): number {
  return Math.pow(clamp01(t), 1.8);
}
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Advance the four shape dials.
 *
 * Keyed on the CLOCK, never on a tick count, because a held ball may not be
 * ticked at all for a stretch (a hidden tab, a dropped frame) and must still
 * come back at the right point in the animation rather than resuming where it
 * left off.
 */
function tickSplat(state: BallEffectState, now: number): void {
  if (state.squishAmount <= 0) return;
  const C = CONFIG;
  const speed = state.squishSpeed || 1;
  const t = (now - state.squishTime) * speed;

  // Where the release begins: the end of the hold for a splat, or the moment
  // the ball is fully squashed for a bounce, which has no hold at all.
  const holdEnds = state.squishHoldUntil > 0
    ? (state.squishHoldUntil - state.squishTime) * speed
    : C.splatInEndMs;

  if (t < holdEnds) {
    // ── Going in ──────────────────────────────────────────────────────────
    state.splatD = easeOut(t / C.splatContactMs);
    state.splatV = easeOut((t - C.splatSlumpFrom) / C.splatSlumpMs);
    let w = easeOut((t - C.splatSpreadFrom) / C.splatSpreadMs);
    // One jelly wobble as it settles: the spread overshoots a touch and comes
    // back. Cheap, and it is most of what separates "soft" from "deformed".
    if (t > C.splatInEndMs && t < C.splatSettleEndMs) {
      const p = (t - C.splatInEndMs) / (C.splatSettleEndMs - C.splatInEndMs);
      w += 0.08 * Math.sin(p * Math.PI) * Math.cos(p * Math.PI * 1.5) * (1 - p);
    }
    state.splatW = w < 0 ? 0 : w;
    state.splatStretch = 0;
    return;
  }

  // ── Coming out. The crown lifts first, the contact face lets go last. ─────
  const r = t - holdEnds;
  state.splatV = 1 - easeIn(r / C.splatLiftMs);
  state.splatD = 1 - easeIn((r - C.splatFaceFrom) / C.splatFaceMs);
  state.splatW = 1 - easeIn((r - C.splatFootFrom) / C.splatFootMs);
  state.splatStretch = Math.sin(Math.PI * clamp01((r - C.splatPeelFrom) / C.splatPeelMs));

  if (r >= C.splatOutEndMs) {
    // Round again, and every dial cleared so the next hit starts from nothing.
    state.squishAmount = 0;
    state.squishHoldUntil = 0;
    state.squishSpeed = 1;
    state.splatD = state.splatV = state.splatW = state.splatStretch = 0;
  }
}

/**
 * Impact axis + normal-component speed for a reflection, derived from the
 * velocity either side of it.
 *
 * For a bounce, `vAfter - vBefore` is the impulse, which by definition points
 * along the SURFACE NORMAL, and its magnitude is twice the normal component of
 * the impact velocity. So both numbers the squash needs fall out of the two
 * velocities, with no need for any collision resolver to hand back its normal.
 *
 * This is also what makes the squash respond to ANGLE: a head-on hit reverses
 * the velocity and yields a large impulse, while a graze barely changes it and
 * yields almost none.
 */
export function bounceImpact(
  vBefore: { x: number; y: number },
  vAfter: { x: number; y: number },
): [nx: number, ny: number, normalSpeed: number] {
  const dx = vAfter.x - vBefore.x;
  const dy = vAfter.y - vBefore.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return [0, 0, 0];
  return [dx / mag, dy / mag, mag / 2];
}

/**
 * Trigger wall collision effect. Pass the impact NORMAL and the normal-component
 * impact speed (see bounceImpact) to also fire a squash along the axis the ball
 * was actually struck on; omit them (e.g. resting contacts) to keep the halo
 * without any squish.
 */
export function triggerWallHit(
  state: BallEffectState, now: number, vx = 0, vy = 0, speed = 0,
): void {
  state.wallHitIntensity = 1;
  state.wallHitTime = now;
  triggerSquish(state, vx, vy, speed, now);
}

/**
 * Trigger ball-to-ball collision effect (+ optional speed-scaled squash).
 */
export function triggerBallHit(
  state: BallEffectState, now: number, vx = 0, vy = 0, speed = 0,
): void {
  state.ballHitIntensity = 1;
  state.ballHitTime = now;
  triggerSquish(state, vx, vy, speed, now);
}

/**
 * Record a squash impulse.
 *
 * (nx, ny) is the IMPACT NORMAL - the axis the ball is compressed along - and
 * `speed` is the impact's component ALONG that normal, not the ball's total
 * speed. Both matter, and getting either wrong is visible:
 *
 * - Axis. The wall path used to pass the post-bounce VELOCITY as the axis. That
 *   equals the surface normal only for a head-on hit; on a glancing hit the
 *   post-bounce velocity is mostly tangential, so the ball squashed nearly
 *   PARALLEL to the surface it had just hit.
 * - Magnitude. It also passed total speed, so a fast ball merely grazing a wall
 *   saturated the squish as hard as one hitting it square.
 *
 * Use `bounceImpact()` to derive both from a reflection.
 */
function triggerSquish(
  state: BallEffectState, nx: number, ny: number, speed: number, now: number,
): void {
  const mag = Math.hypot(nx, ny) || 1;
  const amount = Math.min(1, speed / CONFIG.squishReferenceSpeed) * CONFIG.bounceSplatFraction;
  if (amount <= 0.002) return;
  state.squishNx = nx / mag;
  state.squishNy = ny / mag;
  state.squishAmount = amount;
  state.squishTime = now;
  // An ordinary bounce is a bounce whatever came before it: no hold, and the
  // brisk timescale, so a ball struck again while it is still peeling off a
  // splat stops being a tomato immediately.
  state.squishHoldUntil = 0;
  state.squishSpeed = CONFIG.bounceSpeedup;
  state.splatD = state.splatV = state.splatW = state.splatStretch = 0;
}

/**
 * Bug Squash: pin the ball's squash against the wall it just hit for `holdMs`.
 *
 * Call right after triggerWallHit, which has already recorded the impact
 * normal; this re-arms the envelope at full magnitude regardless of how hard
 * the ball actually hit (a splat is a splat), starts the ramp-in, and sets the
 * hold. Does nothing without a recorded normal, because a squash with no axis
 * would be drawn along whatever axis the last impact happened to leave behind.
 */
export function pinSquish(state: BallEffectState, now: number, holdMs: number): void {
  if (state.squishNx === 0 && state.squishNy === 0) return;
  // Full depth regardless of how hard the ball actually hit - a splat is a
  // splat - at the slow timescale, starting from round so the contact face is
  // watched forming rather than found already there.
  state.squishAmount = 1;
  state.squishTime = now;
  state.squishSpeed = 1;
  state.squishHoldUntil = now + Math.max(0, holdMs);
  state.splatD = state.splatV = state.splatW = state.splatStretch = 0;
}

/** True while a Bug Squash hold is pinning this ball's squash. */
export function isSquishPinned(state: BallEffectState, now: number): boolean {
  return state.squishHoldUntil > 0 && now < state.squishHoldUntil;
}

/**
 * Per-ball squish dial for big boss balls: the full deformation reads as
 * overblown on their large radius, so they squash at half strength.
 */
export const BOSS_SQUISH_SCALE = 0.5;

/**
 * The current deformation: the four shape dials, the axis they act along, and
 * two summary ratios.
 *
 * `scaleAlong` and `scalePerp` are the silhouette's height and width as
 * fractions of the round ball's DIAMETER - 1 and 1 when round, about 0.48 and
 * 1.77 at a full splat. They are measurements OF the droplet, not the model
 * behind it: the shape used to be an ellipse and those two numbers were its
 * definition, and keeping them as a summary is what lets a shadow be sized and
 * a test assert "flatter than a bounce" without either knowing about outlines.
 * Anything drawing the ball wants `splatOutline` instead.
 */
export function getSquishEffect(state: BallEffectState, scale = 1): {
  active: boolean;
  splat: SplatState;
  scaleAlong: number;
  scalePerp: number;
  nx: number;
  ny: number;
} {
  // NEGATED rather than `<= 0`, so undefined and NaN are inactive too. They
  // used to fall through to the maths below and come back as NaN scales, which
  // was invisible for as long as the only consumer was a display property Pixi
  // silently tolerates. The moment the same numbers were used to place the
  // SHADOW, the NaN reached real geometry and ballLayerNoBeams caught it on the
  // first run. A squash with no magnitude is no squash, whatever shape the
  // state is in.
  if (!(state.squishAmount > 0)) {
    return { active: false, splat: ROUND, scaleAlong: 1, scalePerp: 1, nx: 1, ny: 0 };
  }
  // `scale` dials the whole deformation down per ball, and the amount carries
  // how hard the hit was, so a graze on a boss ball barely registers and a
  // full splat on an ordinary one goes all the way.
  const k = Math.min(1, Math.max(0, state.squishAmount * scale));
  const splat: SplatState = {
    d: state.splatD * k,
    v: state.splatV * k,
    w: state.splatW * k,
    stretch: state.splatStretch * k,
  };
  // Measured on a unit ball, so these come back as ratios of the diameter
  // whatever size the ball actually is.
  const m = splatMetrics(splatOutline(splat, 0.5));
  return {
    active: isDeformed(splat),
    splat,
    scaleAlong: m.height,
    scalePerp: m.width,
    nx: state.squishNx,
    ny: state.squishNy,
  };
}

/**
 * Get current baseline pulse values
 */
export function getBaselinePulse(state: BallEffectState): { 
  glowAlpha: number; 
  radiusScale: number;
} {
  // Sinusoidal oscillation
  const pulse = (Math.sin(state.pulsePhase) + 1) / 2; // 0-1
  
  return {
    glowAlpha: CONFIG.pulseGlowMin + pulse * (CONFIG.pulseGlowMax - CONFIG.pulseGlowMin),
    radiusScale: CONFIG.pulseRadiusMin + pulse * (CONFIG.pulseRadiusMax - CONFIG.pulseRadiusMin),
  };
}

/**
 * Get wall hit effect values
 */
export function getWallHitEffect(state: BallEffectState): {
  active: boolean;
  intensity: number;
  ringRadius: number;
  ringWidth: number;
  glowAlpha: number;
} {
  if (state.wallHitIntensity <= 0) {
    return { active: false, intensity: 0, ringRadius: 1, ringWidth: 0, glowAlpha: 0 };
  }
  
  const intensity = state.wallHitIntensity;
  
  // Ring expands as it fades
  const expandProgress = 1 - intensity;
  const ringRadius = 1 + (CONFIG.wallHitRingRadius - 1) * (0.3 + expandProgress * 0.7);
  
  return {
    active: true,
    intensity,
    ringRadius,
    ringWidth: CONFIG.wallHitRingWidth * intensity,
    glowAlpha: CONFIG.wallHitGlowIntensity * intensity,
  };
}

/**
 * Get ball-to-ball hit effect values
 */
export function getBallHitEffect(state: BallEffectState, now: number): {
  active: boolean;
  intensity: number;
  ringRadius: number;
  glowAlpha: number;
  secondaryPulse: number; // 0-1, for spark-like accent
} {
  if (state.ballHitIntensity <= 0) {
    return { active: false, intensity: 0, ringRadius: 1, glowAlpha: 0, secondaryPulse: 0 };
  }
  
  const intensity = state.ballHitIntensity;
  const elapsed = now - state.ballHitTime;
  
  // Ring expands faster than wall hit
  const expandProgress = 1 - intensity;
  const ringRadius = 1 + (CONFIG.ballHitRingRadius - 1) * (0.2 + expandProgress * 0.8);
  
  // Secondary pulse - a quick "spark" that fires slightly after initial hit
  let secondaryPulse = 0;
  if (CONFIG.ballHitSecondaryPulse && elapsed > 40 && elapsed < 120) {
    const sparkProgress = (elapsed - 40) / 80;
    secondaryPulse = Math.sin(sparkProgress * Math.PI) * 0.6;
  }
  
  return {
    active: true,
    intensity,
    ringRadius,
    glowAlpha: CONFIG.ballHitGlowIntensity * intensity,
    secondaryPulse,
  };
}

/**
 * Render ball effects onto canvas
 * Call this BEFORE rendering the ball itself
 */
export function renderBallEffects(
  ctx: CanvasRenderingContext2D,
  state: BallEffectState,
  screenX: number,
  screenY: number,
  screenRadius: number,
  accentColor: string, // CRT-green or level accent
  ballColor: string,
  now: number,
  scale: number,
  squishScale = 1, // per-ball squish dial (0.5 for big boss balls)
): void {
  // ===== LAYER 1: Baseline pulse glow (always active) =====
  // Blit a pre-rendered OC keyed by accentColor + screenRadius instead of
  // creating a radial gradient per ball per frame.
  const pulse = getBaselinePulse(state);
  {
    const { oc: pulseOC, halfSize: pulseHalf } = getPulseGlowOC(accentColor, screenRadius, scale);
    ctx.save();
    // Squash & stretch the accent halo along the same impact axis as the ball
    // body, so the surrounding aura deforms with it instead of staying round.
    // The transient collision halos below are shockwaves and stay round.
    const squish = getSquishEffect(state, squishScale);
    if (squish.active) {
      const ang = Math.atan2(squish.ny, squish.nx);
      ctx.translate(screenX, screenY);
      ctx.rotate(ang);
      ctx.scale(squish.scaleAlong, squish.scalePerp);
      ctx.rotate(-ang);
      ctx.translate(-screenX, -screenY);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse.glowAlpha; // scales the pre-rendered max-intensity OC
    ctx.drawImage(pulseOC, Math.round(screenX - pulseHalf), Math.round(screenY - pulseHalf));
    ctx.restore();
  }
  
  // ===== LAYER 2: Wall collision halo (medium intensity, LARGE expanding) =====
  const wallHit = getWallHitEffect(state);
  if (wallHit.active) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    
    // Large expanding halo
    const wallHaloRadius = screenRadius * wallHit.ringRadius;
    
    ctx.beginPath();
    ctx.arc(screenX, screenY, wallHaloRadius, 0, Math.PI * 2);
    
    const wallGlow = ctx.createRadialGradient(
      screenX, screenY, screenRadius * 0.5,
      screenX, screenY, wallHaloRadius
    );
    wallGlow.addColorStop(0, hexToRgba(accentColor, wallHit.glowAlpha * 0.7));
    wallGlow.addColorStop(0.3, hexToRgba(accentColor, wallHit.glowAlpha * 0.5));
    wallGlow.addColorStop(0.6, hexToRgba(accentColor, wallHit.glowAlpha * 0.25));
    wallGlow.addColorStop(0.85, hexToRgba(accentColor, wallHit.glowAlpha * 0.08));
    wallGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = wallGlow;
    ctx.fill();
    
    // Outer ring edge for definition
    ctx.beginPath();
    ctx.arc(screenX, screenY, wallHaloRadius * 0.85, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(accentColor, wallHit.glowAlpha * 0.5);
    ctx.lineWidth = Math.max(2, 4 * scale * wallHit.intensity);
    ctx.stroke();
    
    ctx.restore();
  }
  
  // ===== LAYER 3: Ball-to-ball collision halo (strongest, LARGEST) =====
  const ballHit = getBallHitEffect(state, now);
  if (ballHit.active) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    
    const ballHaloRadius = screenRadius * ballHit.ringRadius;
    
    // Massive bright expanding halo
    ctx.beginPath();
    ctx.arc(screenX, screenY, ballHaloRadius, 0, Math.PI * 2);
    
    const ballGlow = ctx.createRadialGradient(
      screenX, screenY, screenRadius * 0.3,
      screenX, screenY, ballHaloRadius
    );
    ballGlow.addColorStop(0, hexToRgba(accentColor, ballHit.glowAlpha));
    ballGlow.addColorStop(0.2, hexToRgba(accentColor, ballHit.glowAlpha * 0.75));
    ballGlow.addColorStop(0.4, hexToRgba(accentColor, ballHit.glowAlpha * 0.45));
    ballGlow.addColorStop(0.65, hexToRgba(accentColor, ballHit.glowAlpha * 0.2));
    ballGlow.addColorStop(0.85, hexToRgba(accentColor, ballHit.glowAlpha * 0.06));
    ballGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = ballGlow;
    ctx.fill();
    
    // Bright inner flash ring
    ctx.beginPath();
    ctx.arc(screenX, screenY, screenRadius * 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${ballHit.intensity * 0.85})`;
    ctx.lineWidth = 5 * scale * ballHit.intensity;
    ctx.stroke();
    
    // Outer expanding ring edge
    ctx.beginPath();
    ctx.arc(screenX, screenY, ballHaloRadius * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(accentColor, ballHit.glowAlpha * 0.6);
    ctx.lineWidth = Math.max(2, 5 * scale * ballHit.intensity);
    ctx.stroke();
    
    // Secondary spark pulse (if active)
    if (ballHit.secondaryPulse > 0) {
      ctx.beginPath();
      ctx.arc(screenX, screenY, screenRadius * (2.0 + ballHit.secondaryPulse * 1.5), 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(accentColor, ballHit.secondaryPulse * 0.7);
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
    }
    
    ctx.restore();
  }
}
