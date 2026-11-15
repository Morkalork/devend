/**
 * Cron Job: on a fixed interval, freeze one random eligible ball.
 *
 * Lifted out of useGameLoop, unchanged, so the headless bot ticks it too: it
 * lived only in the browser loop, and the upgrade sweep reported every Cron
 * Job card as changing nothing.
 */
import type { CanvasGameState } from "@/types/gameState";
import { AUTO_FREEZE_INTERVAL_MS, FREEZE_COOLDOWN_MULTIPLIER } from "@/lib/gameConstants";
import { simNow } from "@/lib/simClock";
import { runStream } from "@/lib/runRng";

/** `autoFreezeDuration` in seconds (0 = upgrade off); `freezeNoCooldown` > 0 is Absolute Zero. */
export function tickAutoFreeze(
  game: CanvasGameState, autoFreezeDuration: number, freezeNoCooldown: number,
): void {
  // Cron Job: on a fixed interval, freeze one random eligible ball. Reuses the
  // same frozenUntil/freezeReadyAt path as the tap-driven Feature Freeze, so
  // the physics loop below (and rendering) already hold and visualise it.
  if (autoFreezeDuration > 0 && !game.isRecovering) {
    const now = simNow();
    if (game.lastAutoFreezeAt === 0) {
      // First active frame of the map — start the clock so the first freeze
      // lands one full interval in, not immediately at map start.
      game.lastAutoFreezeAt = now;
    } else if (now - game.lastAutoFreezeAt >= AUTO_FREEZE_INTERVAL_MS) {
      const eligible = game.balls.filter(b =>
        b.state === "active" &&
        !(b.frozenUntil && now < b.frozenUntil) &&     // not already frozen
        !(b.freezeReadyAt && now < b.freezeReadyAt)     // not on thaw cooldown
      );
      if (eligible.length > 0) {
        // Seeded: Cron Job picking a different ball on each device would
        // put the two boards on different paths within seconds.
        const target = eligible[Math.floor(runStream("autoFreeze")() * eligible.length)];
        const durationMs = autoFreezeDuration * 1000;
        target.frozenUntil   = now + durationMs;
        // Absolute Zero (freeze set bonus): no re-freeze cooldown after thaw.
        target.freezeReadyAt = freezeNoCooldown > 0
          ? now + durationMs
          : now + durationMs * (1 + FREEZE_COOLDOWN_MULTIPLIER);
        game.lastAutoFreezeAt = now;
      }
      // No eligible ball (all frozen/cooling) — leave the clock so it retries
      // next frame rather than skipping this scheduled tick entirely.
    }
  }
}
