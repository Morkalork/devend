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
  pulseGlowMin: 0.15, // Minimum glow alpha (increased for visibility)
  pulseGlowMax: 0.35, // Maximum glow alpha (increased for visibility)
  pulseRadiusMin: 1.0, // Scale factor for radius
  pulseRadiusMax: 1.06, // Slight radius increase at peak
  
  // Wall collision effect
  wallHitDuration: 220, // ms
  wallHitGlowIntensity: 0.7, // Peak glow alpha (increased)
  wallHitRingRadius: 1.5, // Ring extends to 50% beyond ball radius
  wallHitRingWidth: 0.2, // Ring thickness as fraction of radius
  
  // Ball-to-ball collision effect
  ballHitDuration: 300, // ms - slightly longer
  ballHitGlowIntensity: 0.95, // Brighter than wall hit
  ballHitRingRadius: 1.8, // Larger ring
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
  const pulse = getBaselinePulse(state);
  
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // Additive blending for glow
  ctx.beginPath();
  const pulseRadius = screenRadius * pulse.radiusScale + 12 * scale;
  ctx.arc(screenX, screenY, pulseRadius, 0, Math.PI * 2);
  
  const pulseGlow = ctx.createRadialGradient(
    screenX, screenY, screenRadius * 0.3,
    screenX, screenY, pulseRadius
  );
  pulseGlow.addColorStop(0, hexToRgba(accentColor, pulse.glowAlpha * 0.6));
  pulseGlow.addColorStop(0.4, hexToRgba(accentColor, pulse.glowAlpha * 0.4));
  pulseGlow.addColorStop(0.7, hexToRgba(accentColor, pulse.glowAlpha * 0.15));
  pulseGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = pulseGlow;
  ctx.fill();
  ctx.restore();
  
  // ===== LAYER 2: Wall collision ring (medium intensity) =====
  const wallHit = getWallHitEffect(state);
  if (wallHit.active) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    
    // Outer glow
    const wallRingOuterRadius = screenRadius * wallHit.ringRadius;
    const wallRingInnerRadius = screenRadius * (wallHit.ringRadius - wallHit.ringWidth);
    
    ctx.beginPath();
    ctx.arc(screenX, screenY, wallRingOuterRadius + 5 * scale, 0, Math.PI * 2);
    
    const wallGlow = ctx.createRadialGradient(
      screenX, screenY, screenRadius * 0.5,
      screenX, screenY, wallRingOuterRadius + 10 * scale
    );
    wallGlow.addColorStop(0, hexToRgba(accentColor, wallHit.glowAlpha * 0.5));
    wallGlow.addColorStop(0.5, hexToRgba(accentColor, wallHit.glowAlpha * 0.7));
    wallGlow.addColorStop(0.8, hexToRgba(accentColor, wallHit.glowAlpha * 0.3));
    wallGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = wallGlow;
    ctx.fill();
    
    // Ring stroke - sharp edge for clarity
    ctx.beginPath();
    ctx.arc(screenX, screenY, (wallRingOuterRadius + wallRingInnerRadius) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(accentColor, wallHit.glowAlpha * 0.9);
    ctx.lineWidth = Math.max(2, (wallRingOuterRadius - wallRingInnerRadius) * 0.8);
    ctx.stroke();
    
    ctx.restore();
  }
  
  // ===== LAYER 3: Ball-to-ball collision effect (strongest) =====
  const ballHit = getBallHitEffect(state, now);
  if (ballHit.active) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    
    const ballRingRadius = screenRadius * ballHit.ringRadius;
    
    // Large bright glow - most intense effect
    ctx.beginPath();
    ctx.arc(screenX, screenY, ballRingRadius + 20 * scale, 0, Math.PI * 2);
    
    const ballGlow = ctx.createRadialGradient(
      screenX, screenY, screenRadius * 0.2,
      screenX, screenY, ballRingRadius + 20 * scale
    );
    ballGlow.addColorStop(0, hexToRgba(accentColor, ballHit.glowAlpha));
    ballGlow.addColorStop(0.2, hexToRgba(accentColor, ballHit.glowAlpha * 0.85));
    ballGlow.addColorStop(0.45, hexToRgba(accentColor, ballHit.glowAlpha * 0.5));
    ballGlow.addColorStop(0.7, hexToRgba(accentColor, ballHit.glowAlpha * 0.2));
    ballGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = ballGlow;
    ctx.fill();
    
    // Bright inner ring for "energy transfer" feel - white flash
    ctx.beginPath();
    ctx.arc(screenX, screenY, screenRadius * 1.15, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${ballHit.intensity * 0.8})`;
    ctx.lineWidth = 4 * scale * ballHit.intensity;
    ctx.stroke();
    
    // Secondary spark pulse (if active)
    if (ballHit.secondaryPulse > 0) {
      ctx.beginPath();
      ctx.arc(screenX, screenY, screenRadius * (1.3 + ballHit.secondaryPulse * 0.4), 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(accentColor, ballHit.secondaryPulse);
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
    }
    
    ctx.restore();
  }
}

// Helper function (matches GameCanvas)
function hexToRgba(hex: string, alpha: number = 1): string {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
