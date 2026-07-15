/**
 * handleBallCollisions — ball-to-ball elastic collision resolution.
 *
 * Extracted from GameCanvas so it can be unit-tested and shared without
 * React dependencies.
 */

import { CanvasGameState } from "@/types/gameState";
import { Ball } from "@/types/game";
import { triggerBallHit } from "@/lib/ballEffects";
import { playBallCollideSound } from "@/lib/gameAudio";

/** Resolve all pairwise ball-to-ball collisions for this physics step. */
export function handleBallCollisions(game: CanvasGameState): void {
  const balls = game.balls;
  const now = performance.now();
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const ball1 = balls[i];
      const ball2 = balls[j];

      // Skip collisions involving frozen ball - it should stay perfectly still
      if (game.frozenBallId && (ball1.id === game.frozenBallId || ball2.id === game.frozenBallId)) continue;

      // Skip collisions involving WON balls - they are stationary trophies
      if (ball1.state === 'won' || ball2.state === 'won') continue;

      if (ball1.regionId !== ball2.regionId) continue;

      // Feature Freeze: a tap-frozen ball is immovable (infinite mass). The
      // moving ball bounces off it; the frozen one keeps its position.
      const f1 = ball1.frozenUntil !== undefined && now < ball1.frozenUntil;
      const f2 = ball2.frozenUntil !== undefined && now < ball2.frozenUntil;
      if (f1 && f2) continue; // both frozen — nothing moves
      if (f1 || f2) {
        const frozen = f1 ? ball1 : ball2;
        const mover  = f1 ? ball2 : ball1;
        // Scalar math + in-place mutation: this runs O(n^2) per physics step, so
        // allocating vec2 temporaries here was a primary source of GC-pause jank.
        const dx = mover.position.x - frozen.position.x; // frozen → mover
        const dy = mover.position.y - frozen.position.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = ball1.radius + ball2.radius;
        if (distance < minDistance && distance > 0) {
          const nx = dx / distance, ny = dy / distance;
          const velNormal = mover.velocity.x * nx + mover.velocity.y * ny;
          if (velNormal < 0) {
            // reflect the mover's normal component; frozen ball is unaffected
            mover.velocity.x -= nx * 2 * velNormal;
            mover.velocity.y -= ny * 2 * velNormal;
          }
          // push the mover fully out of the frozen ball
          const push = minDistance - distance;
          mover.position.x += nx * push;
          mover.position.y += ny * push;
          triggerBallHit(mover.effects, now);
          triggerBallHit(frozen.effects, now);
          playBallCollideSound(Math.min(1, Math.abs(velNormal) / 300));
        }
        continue;
      }

      // Scalar math + in-place mutation (no vec2 temporaries): the delta below
      // was previously allocated for every same-region pair every step.
      const dx = ball2.position.x - ball1.position.x;
      const dy = ball2.position.y - ball1.position.y;
      const distance = Math.hypot(dx, dy);
      const minDistance = ball1.radius + ball2.radius;

      if (distance < minDistance && distance > 0) {
        const nx = dx / distance, ny = dy / distance;
        const relVelNormal =
          (ball1.velocity.x - ball2.velocity.x) * nx +
          (ball1.velocity.y - ball2.velocity.y) * ny;

        if (relVelNormal > 0) {
          // Capture each ball's speed at impact, before the elastic exchange, so
          // a purple's drain is measured against the pre-collision speed (a fixed
          // amount) instead of riding on top of the random elastic change.
          const preSpeed1 = Math.hypot(ball1.velocity.x, ball1.velocity.y);
          const preSpeed2 = Math.hypot(ball2.velocity.x, ball2.velocity.y);

          ball1.velocity.x -= nx * relVelNormal;
          ball1.velocity.y -= ny * relVelNormal;
          ball2.velocity.x += nx * relVelNormal;
          ball2.velocity.y += ny * relVelNormal;

          const overlap = minDistance - distance;
          const sepx = nx * overlap * 0.5;
          const sepy = ny * overlap * 0.5;
          ball1.position.x -= sepx;
          ball1.position.y -= sepy;
          ball2.position.x += sepx;
          ball2.position.y += sepy;

          // Trigger ball-to-ball collision effect (strongest visual). Both balls
          // squash along the shared contact normal, scaled by the closing speed.
          const now = performance.now();
          triggerBallHit(ball1.effects, now, nx, ny, relVelNormal);
          triggerBallHit(ball2.effects, now, nx, ny, relVelNormal);

          // Play ball collision sound
          const collisionIntensity = Math.min(1, Math.abs(relVelNormal) / 300);
          playBallCollideSound(collisionIntensity);

          // Purple "slow others": the struck ball ends at (its impact speed −
          // the purple's speedReduction), floored at its own minimum speed. A
          // yellow's random speed range is shrunk by the same amount.
          if (ball1.ability === 'slowOthers') slowBall(ball2, preSpeed2, ball1.speedReduction ?? 0);
          if (ball2.ability === 'slowOthers') slowBall(ball1, preSpeed1, ball2.speedReduction ?? 0);
        }
      }
    }
  }
}

/**
 * Set a struck ball's speed to (its pre-collision speed − `reduction`), never
 * below its own minimumSpeed, preserving its post-collision direction. Also
 * shrinks a yellow ball's speed range by the same amount so the drain sticks
 * across its future random speed changes.
 */
function slowBall(ball: Ball, preSpeed: number, reduction: number): void {
  if (reduction <= 0) return;
  const floor = ball.minimumSpeed ?? 0;
  const target = Math.max(floor, preSpeed - reduction);

  const cur = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (cur > 1e-6 && target < cur) {
    const r = target / cur;
    ball.velocity.x *= r;
    ball.velocity.y *= r;
    ball.speed = target;
  }

  if (ball.speedRange) {
    ball.speedRange = [
      Math.max(floor, ball.speedRange[0] - reduction),
      Math.max(floor, ball.speedRange[1] - reduction),
    ];
  }

  // Grey re-derives its speed from baseSpeed every frame, so to make the drain
  // stick, permanently lower its curve by dropping baseSpeed (floored at min).
  if (ball.ability === 'slowDown') {
    ball.baseSpeed = Math.max(floor, ball.baseSpeed - reduction);
  }
}
