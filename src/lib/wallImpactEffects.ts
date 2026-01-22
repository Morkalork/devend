// Wall Impact Effects System
// Provides lightweight, localized visual feedback for ball-wall collisions
// Uses time-based damped spring physics for smooth wobble animation

import { Vector2, pointToSegmentDistance } from './polygon';

export interface WallImpact {
  id: string;
  // Impact position in world coordinates
  impactPoint: Vector2;
  // Impact properties
  strength: number; // 0-1, based on collision velocity
  startTime: number; // Performance.now() timestamp
  // Effect parameters (updated each frame)
  glowIntensity: number; // Current glow (decays over time)
  wobblePhase: number; // Current wobble displacement
}

// Effect configuration
const CONFIG = {
  // Glow effect
  glowDuration: 120, // ms
  glowMaxIntensity: 0.85, // additive glow strength
  
  // Wobble effect
  wobbleDuration: 200, // ms
  wobbleMaxDisplacement: 4, // pixels (screen space)
  wobbleFrequency: 20, // Hz - creates elastic feel
  wobbleDamping: 6, // decay rate
  
  // Spatial spread
  effectRadius: 50, // world units - how far effect spreads along wall
  
  // Performance
  maxActiveImpacts: 12, // limit concurrent effects
};

// Active impacts storage (module-level for efficiency)
let activeImpacts: WallImpact[] = [];
let impactIdCounter = 0;

/**
 * Register a new wall impact
 * Called when a ball collides with a wall segment
 */
export function registerWallImpact(
  _wallStart: Vector2,
  _wallEnd: Vector2,
  impactPoint: Vector2,
  impactStrength: number = 1
): void {
  // Clamp strength
  const strength = Math.max(0.4, Math.min(1, impactStrength));
  
  // Create impact
  const impact: WallImpact = {
    id: `impact-${++impactIdCounter}`,
    impactPoint: { ...impactPoint },
    strength,
    startTime: performance.now(),
    glowIntensity: CONFIG.glowMaxIntensity * strength,
    wobblePhase: CONFIG.wobbleMaxDisplacement * strength,
  };
  
  // Add to active list (limit max concurrent)
  activeImpacts.push(impact);
  if (activeImpacts.length > CONFIG.maxActiveImpacts) {
    activeImpacts.shift(); // Remove oldest
  }
}

/**
 * Update all active impacts (call each frame)
 * Returns true if any effects are active (for render optimization)
 */
export function updateWallImpacts(): boolean {
  if (activeImpacts.length === 0) return false;
  
  const now = performance.now();
  
  // Update each impact
  activeImpacts = activeImpacts.filter(impact => {
    const elapsed = now - impact.startTime;
    
    // Check if effect has expired
    const maxDuration = Math.max(CONFIG.glowDuration, CONFIG.wobbleDuration);
    if (elapsed > maxDuration) return false;
    
    // Update glow (fast attack, smooth decay)
    if (elapsed < CONFIG.glowDuration) {
      const glowProgress = elapsed / CONFIG.glowDuration;
      // Ease-out curve for natural decay
      impact.glowIntensity = CONFIG.glowMaxIntensity * impact.strength * (1 - glowProgress * glowProgress);
    } else {
      impact.glowIntensity = 0;
    }
    
    // Update wobble (damped sine wave)
    if (elapsed < CONFIG.wobbleDuration) {
      const wobbleProgress = elapsed / CONFIG.wobbleDuration;
      const damping = Math.exp(-CONFIG.wobbleDamping * wobbleProgress);
      const oscillation = Math.sin(2 * Math.PI * CONFIG.wobbleFrequency * (elapsed / 1000));
      impact.wobblePhase = CONFIG.wobbleMaxDisplacement * impact.strength * damping * oscillation;
    } else {
      impact.wobblePhase = 0;
    }
    
    return true;
  });
  
  return activeImpacts.length > 0;
}

/**
 * Get displacement and glow for any point near an impact
 */
function getEffectsAtPoint(
  queryPoint: Vector2,
  wallNormalX: number,
  wallNormalY: number,
  scale: number
): { dx: number; dy: number; glow: number } {
  let totalDx = 0;
  let totalDy = 0;
  let totalGlow = 0;
  
  for (const impact of activeImpacts) {
    // Distance from query point to impact point
    const distToImpact = Math.sqrt(
      (queryPoint.x - impact.impactPoint.x) ** 2 + 
      (queryPoint.y - impact.impactPoint.y) ** 2
    );
    
    // Skip if too far
    if (distToImpact > CONFIG.effectRadius * 2) continue;
    
    // Spatial falloff (Gaussian-like)
    const falloff = Math.exp(-(distToImpact * distToImpact) / (2 * CONFIG.effectRadius * CONFIG.effectRadius));
    
    if (falloff > 0.02) {
      // Apply wobble displacement perpendicular to wall
      const wobble = impact.wobblePhase * falloff * scale;
      totalDx += wallNormalX * wobble;
      totalDy += wallNormalY * wobble;
      
      // Accumulate glow (take max for overlapping effects)
      totalGlow = Math.max(totalGlow, impact.glowIntensity * falloff);
    }
  }
  
  return { dx: totalDx, dy: totalDy, glow: totalGlow };
}

/**
 * Check if any impacts are near a wall segment
 */
function hasNearbyImpacts(wallStart: Vector2, wallEnd: Vector2): boolean {
  for (const impact of activeImpacts) {
    const dist = pointToSegmentDistance(impact.impactPoint, wallStart, wallEnd);
    if (dist < CONFIG.effectRadius * 1.5) {
      return true;
    }
  }
  return false;
}

/**
 * Render wall segment with impact effects applied
 */
export function renderWallWithEffects(
  ctx: CanvasRenderingContext2D,
  startScreen: { x: number; y: number },
  endScreen: { x: number; y: number },
  wallStart: Vector2,
  wallEnd: Vector2,
  scale: number,
  baseColor: string,
  baseWidth: number
): void {
  // Check if any impacts are near this wall
  if (activeImpacts.length === 0 || !hasNearbyImpacts(wallStart, wallEnd)) {
    // No effects - render normally
    ctx.beginPath();
    ctx.moveTo(startScreen.x, startScreen.y);
    ctx.lineTo(endScreen.x, endScreen.y);
    ctx.stroke();
    return;
  }
  
  // Calculate wall normal (perpendicular direction)
  const wallDx = wallEnd.x - wallStart.x;
  const wallDy = wallEnd.y - wallStart.y;
  const wallLength = Math.sqrt(wallDx * wallDx + wallDy * wallDy);
  
  if (wallLength < 1) {
    ctx.beginPath();
    ctx.moveTo(startScreen.x, startScreen.y);
    ctx.lineTo(endScreen.x, endScreen.y);
    ctx.stroke();
    return;
  }
  
  const normalX = -wallDy / wallLength;
  const normalY = wallDx / wallLength;
  
  // Find max glow for this wall segment
  let maxGlow = 0;
  const segments = 16;
  const points: { x: number; y: number }[] = [];
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    
    // World position
    const worldX = wallStart.x + wallDx * t;
    const worldY = wallStart.y + wallDy * t;
    
    // Screen position (base)
    const screenX = startScreen.x + (endScreen.x - startScreen.x) * t;
    const screenY = startScreen.y + (endScreen.y - startScreen.y) * t;
    
    // Get displacement and glow
    const { dx, dy, glow } = getEffectsAtPoint(
      { x: worldX, y: worldY },
      normalX,
      normalY,
      scale
    );
    
    points.push({ x: screenX + dx, y: screenY + dy });
    maxGlow = Math.max(maxGlow, glow);
  }
  
  // Draw the wobbled wall
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  
  // Draw glow overlay if significant
  if (maxGlow > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = baseWidth * (1 + maxGlow * 1.5);
    ctx.shadowColor = baseColor;
    ctx.shadowBlur = 20 * maxGlow * scale;
    ctx.globalAlpha = maxGlow * 0.8;
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    
    ctx.restore();
  }
}

/**
 * Clear all active impacts (call on level reset)
 */
export function clearWallImpacts(): void {
  activeImpacts = [];
}

/**
 * Get current number of active impacts (for debugging)
 */
export function getActiveImpactCount(): number {
  return activeImpacts.length;
}
