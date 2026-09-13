import { hexToRgba } from "@/lib/gameUtils";

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

  // Squash & stretch on contact (issue #44). The ball deforms along the impact
  // normal and springs back, like a soft ball bouncing. 0 everywhere = round.
  squishIntensity: number; // signed spring envelope: +compress along normal, -stretch, decays to 0
  squishTime: number;      // timestamp of the impact
  squishNx: number;        // unit impact-normal x (the compression axis)
  squishNy: number;        // unit impact-normal y
  squishAmount: number;    // 0-1 speed-scaled magnitude captured at impact (0 = no squish)
  // Bug Squash hold. While `squishHoldUntil` is in the future the squash ramps
  // in and then PINS at full compression instead of springing back; the
  // spring-back plays from the moment the hold lifts. `squishBoost` scales the
  // pinned deformation past the ordinary bounce's, so a stuck ball reads as
  // splatted rather than merely nudged.
  squishHoldUntil: number;
  squishBoost: number;
  /**
   * Spring-back duration for the CURRENT deformation, ms. An ordinary bounce
   * leaves this at squishDuration; a Bug Squash splat sets the slower
   * stickReleaseMs, because a soft body that spread over 150ms does not
   * recover in the time a firm one takes to bounce.
   */
  squishSpringMs: number;
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

  // Squash & stretch on contact (issue #44) - speed-scaled. Reference speed sits
  // near typical ball speeds (200-340 in balls.yml) so an ordinary bounce fires a
  // clear squash while faster hits saturate. The duration is the perceptual knob:
  // the compression phase is the first third of it, and anything under ~150ms of
  // compression dies inside 4-5 frames and reads as nothing at ball size (~13px),
  // especially with the round highlight ring and glow masking the silhouette.
  squishDuration: 500,       // ms spring-back to round (compress ~165ms, stretch, settle)
  // Peak compression fraction along the impact axis at full speed.
  //
  // Dialled back twice, both times on play feedback, and the second time for a
  // reason worth recording: 0.35 -> 0.245 because a square hit read as rubbery
  // rather than as a ball with some give, then 0.245 -> 0.1715 (another 30%)
  // once the board's objects started casting readable shadows. The squash used
  // to be carrying the whole impact on its own, on a ~13px ball, against a flat
  // board. With the geometry throwing real shadows the hit is legible from the
  // scene, so the deformation can stop over-acting.
  squishMaxCompress: 0.1715,
  squishReferenceSpeed: 250, // world speed at which the squish magnitude saturates

  // ── Bug Squash: the stuck ball, and it is a TOMATO ────────────────────────
  //
  // Everything above is tuned for a ball with some give that bounces off. This
  // is a different object for two seconds: something slightly overripe hitting
  // a wall, spreading against it, and peeling back off. Reported as "there is
  // no animation for the ball squashing", with the mechanic working - and the
  // envelope WAS running exactly as designed. It was just too small and too
  // quick to be an animation at ball size, which is the same failure mode
  // squishMaxCompress's own note above describes.
  //
  // Three numbers, and each fixes a different half of "I cannot see it":
  //
  //   RAMP. 90ms is five frames. The ball did not appear to squash, it appeared
  //   to already be flat - the deformation was a state, not a motion. 150ms is
  //   nine, which is enough to watch it spread.
  //
  //   DEPTH. 3.0 puts the pinned compression at ~0.51: the ball loses half its
  //   thickness and doubles across. That is far past the 0.35 this file once
  //   dialled back for a passing bounce, and deliberately so - the thing being
  //   drawn is not a bounce, and anything subtler on a ~13px ball is a slightly
  //   oval circle.
  //
  //   RELEASE. A ripe tomato does not ping back. 620ms rather than the bounce's
  //   500, so the peel-off is slower than the splat that made it, and the
  //   shared spring's stretch phase (which pulls PAST round before settling) is
  //   3x deeper here too, so it comes away from the wall stringy.
  stickRampMs: 150,
  stickCompressBoost: 3.0,
  stickReleaseMs: 620,
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
    squishIntensity: 0,
    squishTime: 0,
    squishNx: 0,
    squishNy: 0,
    squishAmount: 0,
    squishHoldUntil: 0,
    squishBoost: 1,
    squishSpringMs: CONFIG.squishDuration,
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

  // Bug Squash hold: ramp into the squash, then pin there until the hold lifts.
  // The spring-back below is then played from the moment of release, so the
  // ball visibly un-squashes as it leaves rather than snapping round. This
  // branch runs whether or not the physics ticked during the hold (the browser
  // loop skips a held ball, the harness does not), which is why release is
  // keyed on the clock rather than on a tick count.
  if (state.squishHoldUntil > 0) {
    if (now < state.squishHoldUntil) {
      const p = Math.min(1, (now - state.squishTime) / CONFIG.stickRampMs);
      state.squishIntensity = Math.sin(p * Math.PI / 2); // ease-out into the splat
      return;
    }
    state.squishHoldUntil = 0;
    state.squishTime = now;
    state.squishIntensity = 1;
  }

  // Spring the squish back to round. One gentle overshoot (compress -> slight
  // stretch -> settle) under a linear-decay envelope, like a soft ball rebounding.
  // The duration is per-deformation, not global: a Bug Squash splat peels off
  // over stickReleaseMs, which is slower than a bounce's recovery.
  if (state.squishAmount > 0) {
    const springMs = state.squishSpringMs || CONFIG.squishDuration;
    const elapsed = now - state.squishTime;
    if (elapsed >= springMs) {
      state.squishAmount = 0;
      state.squishIntensity = 0;
      state.squishBoost = 1;
      state.squishSpringMs = CONFIG.squishDuration;
    } else {
      const p = elapsed / springMs;
      state.squishIntensity = (1 - p) * Math.cos(p * Math.PI * 1.5);
    }
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
  const vx = nx, vy = ny;
  const amount = Math.min(1, speed / CONFIG.squishReferenceSpeed);
  if (amount <= 0.01) return;
  const mag = Math.hypot(vx, vy) || 1;
  state.squishNx = vx / mag;
  state.squishNy = vy / mag;
  state.squishAmount = amount;
  state.squishIntensity = 1;
  state.squishTime = now;
  // An ordinary bounce recovers at the ordinary rate, whatever the last
  // deformation was: a ball hit again while peeling off a splat is a bouncing
  // ball now, not a tomato.
  state.squishSpringMs = CONFIG.squishDuration;
  state.squishBoost = 1;
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
  state.squishAmount = 1;
  state.squishIntensity = 0;
  state.squishTime = now;
  state.squishHoldUntil = now + Math.max(0, holdMs);
  state.squishBoost = CONFIG.stickCompressBoost;
  state.squishSpringMs = CONFIG.stickReleaseMs;
}

/** True while a Bug Squash hold is pinning this ball's squash. */
export function isSquishPinned(state: BallEffectState, now: number): boolean {
  return state.squishHoldUntil > 0 && now < state.squishHoldUntil;
}

/**
 * Current squash-and-stretch deformation. `scaleAlong` compresses the ball along
 * the impact normal (nx,ny); `scalePerp` stretches perpendicular to preserve
 * area. Both are 1 when round. Apply as a rotated non-uniform scale at render.
 */
/**
 * Per-ball squish dial for big boss balls: the full ~35% compression reads as
 * overblown on their large radius, so they squish at half strength. Shared by
 * both renderers (Pixi rig + 2D transform) so the factor lives in one place.
 */
export const BOSS_SQUISH_SCALE = 0.5;

export function getSquishEffect(state: BallEffectState, scale = 1): {
  active: boolean;
  scaleAlong: number;
  scalePerp: number;
  nx: number;
  ny: number;
} {
  // NEGATED rather than `<= 0`, so undefined and NaN are inactive too. They
  // used to fall through to the maths below and come back as NaN scales, which
  // was invisible for as long as the only consumer was holder.scale.set() - a
  // display property Pixi silently tolerates. The moment the same numbers were
  // used to place the SHADOW, the NaN reached real geometry and
  // ballLayerNoBeams caught it on the first run. A squash with no magnitude is
  // no squash, whatever shape the state is in.
  if (!(state.squishAmount > 0)) {
    return { active: false, scaleAlong: 1, scalePerp: 1, nx: 1, ny: 0 };
  }
  // Signed compression along the normal, and a perpendicular bulge that spreads
  // with it. `scale` dials the whole deformation down per ball (e.g. 0.5 for
  // large boss balls, which look overblown at the full compression). Clamped so
  // no future dial can push scaleAlong through zero and turn the ball inside
  // out.
  const s = Math.min(0.8,
    state.squishIntensity * state.squishAmount * CONFIG.squishMaxCompress * state.squishBoost * scale);
  // The bulge is DAMPED area preservation: (1/(1-s)) raised to BULGE_EXPONENT
  // rather than the strict inverse. A flat 1/(1-s) is right for a disc, which
  // this is not: a real soft body pressed against a wall also bulges toward the
  // viewer, and that third dimension is invisible here, so a strict inverse
  // spends all of it sideways. Barely distinguishable on an ordinary bounce
  // (43.5 world units across becomes 41.5) and the whole difference between a
  // tomato and a water balloon at Bug Squash depth, where the strict version
  // spread the ball to 2.06x its own width.
  return {
    active: true,
    scaleAlong: 1 - s,
    scalePerp: Math.pow(1 / (1 - s), BULGE_EXPONENT),
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
