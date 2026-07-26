/**
 * Bonus-lock zones (LEVELDESIGN.md convention 2, the greed hook).
 *
 * A zone is a rect where locking a ball pays a multiplier. Zones are authored in
 * `map.yml` (LevelConfig.lockZones), rotated with the map at load, and stored on
 * game.lockZones in world space. The lock payout (checkBallWonState) multiplies a
 * ball's lock points by the zone it was locked in; renderers tint the pocket so
 * the player can see the prize.
 */
import type { LockZone } from "@/types/level";

/**
 * The lock-points multiplier at a world point: the largest multiplier among the
 * zones that contain it (zones do not stack), or 1 if none. Test the locked
 * ball's position, which sits inside the sealed pocket.
 */
export function bonusLockMultiplierAt(x: number, y: number, zones: LockZone[]): number {
  let m = 1;
  for (const z of zones) {
    if (x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height && z.multiplier > m) {
      m = z.multiplier;
    }
  }
  return m;
}
