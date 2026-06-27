/**
 * handleBallCollisions — ball-to-ball elastic collision resolution.
 *
 * Extracted from GameCanvas so it can be unit-tested and shared without
 * React dependencies.
 */

import { CanvasGameState } from "@/types/gameState";
import {
  vec2Add,
  vec2Sub,
  vec2Scale,
  vec2Normalize,
  vec2Length,
  vec2Dot,
} from "@/lib/polygon";
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
        const delta = vec2Sub(mover.position, frozen.position); // frozen → mover
        const distance = vec2Length(delta);
        const minDistance = ball1.radius + ball2.radius;
        if (distance < minDistance && distance > 0) {
          const normal = vec2Normalize(delta);
          const velNormal = vec2Dot(mover.velocity, normal);
          if (velNormal < 0) {
            // reflect the mover's normal component; frozen ball is unaffected
            mover.velocity = vec2Sub(mover.velocity, vec2Scale(normal, 2 * velNormal));
          }
          // push the mover fully out of the frozen ball
          mover.position = vec2Add(mover.position, vec2Scale(normal, minDistance - distance));
          triggerBallHit(mover.effects, now);
          triggerBallHit(frozen.effects, now);
          playBallCollideSound(Math.min(1, Math.abs(velNormal) / 300));
        }
        continue;
      }

      const delta = vec2Sub(ball2.position, ball1.position);
      const distance = vec2Length(delta);
      const minDistance = ball1.radius + ball2.radius;

      if (distance < minDistance && distance > 0) {
        const normal = vec2Normalize(delta);
        const relVel = vec2Sub(ball1.velocity, ball2.velocity);
        const relVelNormal = vec2Dot(relVel, normal);

        if (relVelNormal > 0) {
          ball1.velocity = vec2Sub(ball1.velocity, vec2Scale(normal, relVelNormal));
          ball2.velocity = vec2Add(ball2.velocity, vec2Scale(normal, relVelNormal));

          const overlap = minDistance - distance;
          const separation = vec2Scale(normal, overlap / 2);
          ball1.position = vec2Sub(ball1.position, separation);
          ball2.position = vec2Add(ball2.position, separation);

          // Trigger ball-to-ball collision effect (strongest visual)
          const now = performance.now();
          triggerBallHit(ball1.effects, now);
          triggerBallHit(ball2.effects, now);

          // Play ball collision sound
          const collisionIntensity = Math.min(1, Math.abs(relVelNormal) / 300);
          playBallCollideSound(collisionIntensity);
        }
      }
    }
  }
}
