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
};

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
}

/**
 * Trigger wall collision effect
 */
export function triggerWallHit(state: BallEffectState, now: number): void {
  state.wallHitIntensity = 1;
  state.wallHitTime = now;
}

/**
 * Trigger ball-to-ball collision effect
 */
export function triggerBallHit(state: BallEffectState, now: number): void {
  state.ballHitIntensity = 1;
  state.ballHitTime = now;
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
  scale: number
): void {
  // ===== LAYER 1: Baseline pulse glow (always active) =====
  // Blit a pre-rendered OC keyed by accentColor + screenRadius instead of
  // creating a radial gradient per ball per frame.
  const pulse = getBaselinePulse(state);
  {
    const { oc: pulseOC, halfSize: pulseHalf } = getPulseGlowOC(accentColor, screenRadius, scale);
    ctx.save();
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
