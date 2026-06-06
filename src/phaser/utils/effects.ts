/**
 * Visual effects module — particles, tweens, and FX for gameplay.
 * Used by scenes to create impact bursts, animations, and polish.
 */
import Phaser from 'phaser';
import { Vector2 } from '@/types/game';

const IMPACT_TEX = 'fx-impact-particle';
const TRAIL_TEX = 'fx-trail-particle';

/**
 * Pooled particle emitters reused for the whole scene lifetime. Created once in
 * scene `create()` (see {@link createEffectEmitters}) instead of allocating
 * GameObjects + textures per collision/frame.
 */
export interface EffectEmitters {
  impact: Phaser.GameObjects.Particles.ParticleEmitter;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
}

/** Bake the small particle textures once per scene (idempotent). */
function ensureParticleTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(IMPACT_TEX)) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 3);
    g.generateTexture(IMPACT_TEX, 8, 8);
    g.destroy();
  }
  if (!scene.textures.exists(TRAIL_TEX)) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 6, 6);
    g.generateTexture(TRAIL_TEX, 12, 12);
    g.destroy();
  }
}

/**
 * Create the reusable impact + trail emitters. Particles are white textures
 * tinted per emit, so a single emitter serves every colour. Call once in
 * `create()` and keep the returned handle for the scene's lifetime.
 */
export function createEffectEmitters(scene: Phaser.Scene): EffectEmitters {
  ensureParticleTextures(scene);

  const impact = scene.add.particles(0, 0, IMPACT_TEX, {
    lifespan: 400,
    speed: { min: 60, max: 200 },
    scale: { start: 1, end: 0 },
    alpha: { start: 1, end: 0 },
    emitting: false,
  });
  impact.setDepth(60);

  const trail = scene.add.particles(0, 0, TRAIL_TEX, {
    lifespan: 300,
    speed: 0,
    scale: { start: 1, end: 0.1 },
    alpha: { start: 0.6, end: 0 },
    emitting: false,
  });
  trail.setDepth(9);

  return { impact, trail };
}

/** Burst of impact particles at a point, tinted to `color`. */
export function emitImpact(
  emitters: EffectEmitters,
  position: Vector2,
  color: number = 0x00ff88,
  count: number = 8
): void {
  emitters.impact.setParticleTint(color);
  emitters.impact.emitParticleAt(position.x, position.y, count);
}

/** Single fading motion-trail dot at a ball position, tinted to `color`. */
export function emitTrail(
  emitters: EffectEmitters,
  position: Vector2,
  color: number = 0x00ff88
): void {
  emitters.trail.setParticleTint(color);
  emitters.trail.emitParticleAt(position.x, position.y, 1);
}

/**
 * Level complete dissolve effect.
 */
export function playLevelCompleteAnimation(
  scene: Phaser.Scene,
  callback?: () => void
): void {
  const overlay = scene.add.rectangle(450, 450, 900, 900, 0xffffff, 0).setOrigin(0.5).setDepth(5000);

  scene.tweens.add({
    targets: overlay,
    alpha: 0.8,
    duration: 800,
    ease: 'Power2.easeInOut',
    onComplete: () => {
      scene.tweens.add({
        targets: overlay,
        alpha: 0,
        duration: 400,
        ease: 'Power2.easeIn',
        onComplete: () => {
          overlay.destroy();
          callback?.();
        },
      });
    },
  });
}

/**
 * Ball assimilation/lock animation.
 */
export function playBallLockAnimation(scene: Phaser.Scene, sprite: Phaser.Physics.Matter.Sprite): void {
  scene.tweens.add({
    targets: sprite,
    scale: 0.2,
    alpha: 0,
    duration: 400,
    ease: 'Back.easeIn',
  });
}

/**
 * Growing wall animation from start to end.
 */
export function animateWallGrowth(
  scene: Phaser.Scene,
  start: Vector2,
  end: Vector2,
  duration: number = 500,
  color: number = 0x00ff88
): Phaser.GameObjects.Graphics {
  const gfx = scene.add.graphics().setDepth(50);
  const totalDist = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);

  let elapsedTime = 0;
  const interval = scene.time.addEvent({
    delay: 16,
    repeat: -1,
    callback: () => {
      elapsedTime += 16;
      const progress = Math.min(1, elapsedTime / duration);

      gfx.clear();
      gfx.lineStyle(6, color, 0.8);
      gfx.beginPath();
      gfx.moveTo(start.x, start.y);

      const currentDist = totalDist * progress;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      const currentEnd = {
        x: start.x + (dx / length) * currentDist,
        y: start.y + (dy / length) * currentDist,
      };

      gfx.lineTo(currentEnd.x, currentEnd.y);
      gfx.strokePath();

      if (progress >= 1) {
        interval.remove();
      }
    },
  });

  return gfx;
}

/**
 * Neon glow pulse effect.
 */
export function playNeonGlowPulse(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  duration: number = 400
): void {
  const originalAlpha = (target as any).alpha || 1;

  scene.tweens.add({
    targets: target,
    alpha: originalAlpha * 1.5,
    duration: duration / 2,
    ease: 'Sine.easeInOut',
    yoyo: true,
  });
}

/**
 * Screen flash (impact feedback).
 */
export function screenFlash(
  scene: Phaser.Scene,
  color: number = 0xffffff,
  duration: number = 100,
  intensity: number = 0.5
): void {
  const flash = scene.add
    .rectangle(450, 450, 900, 900, color, intensity)
    .setOrigin(0.5)
    .setDepth(4999);

  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration,
    ease: 'Quad.easeOut',
    onComplete: () => flash.destroy(),
  });
}
