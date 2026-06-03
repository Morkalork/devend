/**
 * Visual effects module — particles, tweens, and FX for gameplay.
 * Used by scenes to create impact bursts, animations, and polish.
 */
import Phaser from 'phaser';
import { Vector2 } from '@/types/game';

/**
 * Particle burst on wall impact.
 */
export function emitWallImpactParticles(
  scene: Phaser.Scene,
  position: Vector2,
  color: number = 0x00ff88,
  count: number = 8
): void {
  // Create a temporary graphics object for particle texture
  const gfx = scene.make.graphics({ x: 0, y: 0, add: false });
  gfx.fillStyle(color, 1);
  gfx.fillCircle(4, 4, 3);
  gfx.generateTexture('wall-impact-particle', 8, 8);
  gfx.destroy();

  // Emit particles in a burst
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const vx = Math.cos(angle) * 200;
    const vy = Math.sin(angle) * 200;

    const particle = scene.add
      .image(position.x, position.y, 'wall-impact-particle')
      .setOrigin(0.5);

    scene.tweens.add({
      targets: particle,
      x: position.x + Math.cos(angle) * 60,
      y: position.y + Math.sin(angle) * 60,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }
}

/**
 * Motion trail effect following a ball.
 */
export function createBallTrail(
  scene: Phaser.Scene,
  position: Vector2,
  color: number = 0x00ff88,
  trailLength: number = 5
): void {
  const trail = scene.add
    .circle(position.x, position.y, 6, color)
    .setOrigin(0.5)
    .setAlpha(0.6);

  scene.tweens.add({
    targets: trail,
    alpha: 0,
    scale: 0.1,
    duration: 300,
    ease: 'Quad.easeOut',
    onComplete: () => trail.destroy(),
  });
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
