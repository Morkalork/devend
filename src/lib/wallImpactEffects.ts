// Wall Impact Effects System
// Provides lightweight, localized visual feedback for ball-wall collisions
// Uses time-based damped spring physics for smooth wobble animation

import { Vector2 } from './polygon';

export interface WallImpact {
  id: string;
  // Position along the wall segment (0-1, where 0 = start, 1 = end)
  position: number;
  // Wall segment endpoints (world coordinates)
  wallStart: Vector2;
  wallEnd: Vector2;
  // Impact properties
  strength: number; // 0-1, based on collision velocity
  startTime: number; // Performance.now() timestamp
  // Effect parameters
  glowIntensity: number; // Current glow (decays over time)
  wobblePhase: number; // Current wobble displacement
}

// Effect configuration
const CONFIG = {
  // Glow effect
  glowDuration: 100, // ms
  glowMaxIntensity: 0.7, // additive glow strength
  
  // Wobble effect
  wobbleDuration: 180, // ms
  wobbleMaxDisplacement: 3, // pixels (screen space)
  wobbleFrequency: 25, // Hz - creates elastic feel
  wobbleDamping: 8, // decay rate
  
  // Spatial spread
  effectRadius: 40, // world units - how far effect spreads along wall
  
  // Performance
  maxActiveImpacts: 8, // limit concurrent effects
};

// Active impacts storage (module-level for efficiency)
let activeImpacts: WallImpact[] = [];
let impactIdCounter = 0;

/**
 * Register a new wall impact
 * Called when a ball collides with a wall segment
 */
export function registerWallImpact(
  wallStart: Vector2,
  wallEnd: Vector2,
  impactPoint: Vector2,
  impactStrength: number = 1
): void {
  // Calculate position along wall (0-1)
  const wallDx = wallEnd.x - wallStart.x;
  const wallDy = wallEnd.y - wallStart.y;
  const wallLengthSq = wallDx * wallDx + wallDy * wallDy;
  
  if (wallLengthSq < 1) return; // Skip very short walls
  
  const t = Math.max(0, Math.min(1,
    ((impactPoint.x - wallStart.x) * wallDx + (impactPoint.y - wallStart.y) * wallDy) / wallLengthSq
  ));
  
  // Clamp strength
  const strength = Math.max(0.3, Math.min(1, impactStrength));
  
  // Create impact
  const impact: WallImpact = {
    id: `impact-${++impactIdCounter}`,
    position: t,
    wallStart: { ...wallStart },
    wallEnd: { ...wallEnd },
    strength,
    startTime: performance.now(),
    glowIntensity: CONFIG.glowMaxIntensity * strength,
    wobblePhase: 0,
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
    
    // Update glow (linear decay)
    if (elapsed < CONFIG.glowDuration) {
      const glowProgress = elapsed / CONFIG.glowDuration;
      impact.glowIntensity = CONFIG.glowMaxIntensity * impact.strength * (1 - glowProgress);
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
 * Get displacement for a point along a wall segment
 * Returns perpendicular displacement in screen pixels
 */
export function getWallDisplacement(
  wallStart: Vector2,
  wallEnd: Vector2,
  queryPoint: Vector2,
  scale: number
): { dx: number; dy: number; glow: number } {
  if (activeImpacts.length === 0) {
    return { dx: 0, dy: 0, glow: 0 };
  }
  
  // Calculate query position along wall
  const wallDx = wallEnd.x - wallStart.x;
  const wallDy = wallEnd.y - wallStart.y;
  const wallLength = Math.sqrt(wallDx * wallDx + wallDy * wallDy);
  
  if (wallLength < 1) return { dx: 0, dy: 0, glow: 0 };
  
  // Wall normal (perpendicular direction)
  const normalX = -wallDy / wallLength;
  const normalY = wallDx / wallLength;
  
  let totalDx = 0;
  let totalDy = 0;
  let totalGlow = 0;
  
  // Check each active impact
  for (const impact of activeImpacts) {
    // Check if this impact is on the same wall segment
    const sameWall = 
      Math.abs(impact.wallStart.x - wallStart.x) < 1 &&
      Math.abs(impact.wallStart.y - wallStart.y) < 1 &&
      Math.abs(impact.wallEnd.x - wallEnd.x) < 1 &&
      Math.abs(impact.wallEnd.y - wallEnd.y) < 1;
    
    if (!sameWall) continue;
    
    // Calculate distance from impact point
    const impactWorldX = wallStart.x + wallDx * impact.position;
    const impactWorldY = wallStart.y + wallDy * impact.position;
    const distToImpact = Math.sqrt(
      (queryPoint.x - impactWorldX) ** 2 + 
      (queryPoint.y - impactWorldY) ** 2
    );
    
    // Spatial falloff (Gaussian-like)
    const falloff = Math.exp(-(distToImpact * distToImpact) / (2 * CONFIG.effectRadius * CONFIG.effectRadius));
    
    if (falloff > 0.01) {
      // Apply wobble displacement
      const wobble = impact.wobblePhase * falloff * scale;
      totalDx += normalX * wobble;
      totalDy += normalY * wobble;
      
      // Accumulate glow
      totalGlow = Math.max(totalGlow, impact.glowIntensity * falloff);
    }
  }
  
  return { dx: totalDx, dy: totalDy, glow: totalGlow };
}

/**
 * Render wall segment with impact effects applied
 * This is called instead of normal wall stroke for affected segments
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
  // Check if any impacts affect this wall
  const hasImpacts = activeImpacts.some(impact => 
    Math.abs(impact.wallStart.x - wallStart.x) < 1 &&
    Math.abs(impact.wallStart.y - wallStart.y) < 1 &&
    Math.abs(impact.wallEnd.x - wallEnd.x) < 1 &&
    Math.abs(impact.wallEnd.y - wallEnd.y) < 1
  );
  
  if (!hasImpacts) {
    // No effects - render normally
    ctx.beginPath();
    ctx.moveTo(startScreen.x, startScreen.y);
    ctx.lineTo(endScreen.x, endScreen.y);
    ctx.stroke();
    return;
  }
  
  // Render with wobble: subdivide into small segments
  const segments = 12; // Balance between smoothness and performance
  ctx.beginPath();
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    
    // World position
    const worldX = wallStart.x + (wallEnd.x - wallStart.x) * t;
    const worldY = wallStart.y + (wallEnd.y - wallStart.y) * t;
    
    // Screen position (base)
    const screenX = startScreen.x + (endScreen.x - startScreen.x) * t;
    const screenY = startScreen.y + (endScreen.y - startScreen.y) * t;
    
    // Get displacement and glow
    const { dx, dy, glow } = getWallDisplacement(wallStart, wallEnd, { x: worldX, y: worldY }, scale);
    
    const finalX = screenX + dx;
    const finalY = screenY + dy;
    
    if (i === 0) {
      ctx.moveTo(finalX, finalY);
    } else {
      ctx.lineTo(finalX, finalY);
    }
    
    // Apply glow at midpoint of segment
    if (i === Math.floor(segments / 2) && glow > 0.05) {
      // Save current path
      ctx.stroke();
      
      // Draw additive glow overlay
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = baseWidth * (1 + glow * 2);
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = 15 * glow;
      ctx.globalAlpha = glow;
      
      ctx.beginPath();
      ctx.moveTo(startScreen.x, startScreen.y);
      ctx.lineTo(endScreen.x, endScreen.y);
      ctx.stroke();
      
      ctx.restore();
      
      // Continue main path
      ctx.beginPath();
      ctx.moveTo(finalX, finalY);
    }
  }
  
  ctx.stroke();
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
