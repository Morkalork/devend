/**
 * Pickups — on-board power-up tokens.
 *
 * A token spawns in open playable space and is CLAIMED by locking a ball in a
 * pocket that contains it (rule: the reward is for leading a ball to the token
 * and sealing them in together). Capturing the token's area with no ball locked
 * in that pocket WASTES it, and an unclaimed token expires after its lifetime.
 * Tuning lives in public/game-config.yml (`pickups:`); per-map overrides in
 * map.yml (`pickupChance`, `pickupSpots`).
 */
import { Vector2 } from "@/lib/polygon";

export type PickupEffect =
  | "overtime"
  | "fork"
  | "capRaise"
  | "freezeCharge"
  | "freeShopItem"
  | "extraLife"        // grants +value extra lives immediately (#52)
  | "overtimePercent"  // pays value% of the run's banked overtime, after the cap (#52)
  | "rainbowConvert";  // turns a random active ball into a rainbow ball (#52)

/** A live token on the board. */
export interface PickupState {
  id: string;
  effect: PickupEffect;
  /** Effect magnitude: overtime hours / cap raise hours / freeze seconds (fork ignores it). */
  value: number;
  position: Vector2;
  /** game.activePlaySeconds timestamps, so pauses never eat a token's lifetime. */
  spawnedAtSeconds: number;
  expiresAtSeconds: number;
}

/** Transient feedback marker rendered where a token was claimed or wasted. */
export interface PickupFeedback {
  id: string;
  effect: PickupEffect;
  value: number;
  position: Vector2;
  /** performance.now() — feedback is pure presentation, wall-clock is fine. */
  startTime: number;
  kind: "claimed" | "wasted";
}

export interface PickupEffectDef {
  effect: PickupEffect;
  weight: number;
  value: number;
}

/** Parsed `pickups:` block of game-config.yml. */
export interface PickupConfig {
  /** First level number tokens may spawn on (a map's `pickupChance` overrides the gate). */
  startLevel: number;
  /** A spawn roll happens every N active-play seconds. */
  spawnCheckSeconds: number;
  /** Chance per roll, 0-1 (when fewer than maxSimultaneous tokens are alive). */
  spawnChance: number;
  maxSimultaneous: number;
  lifetimeSeconds: number;
  effects: PickupEffectDef[];
}

export const DEFAULT_PICKUP_CONFIG: PickupConfig = {
  startLevel: 8,
  spawnCheckSeconds: 5,
  spawnChance: 0.1,
  maxSimultaneous: 2,
  lifetimeSeconds: 14,
  effects: [
    { effect: "overtime", weight: 4, value: 4 },
    { effect: "fork", weight: 2, value: 0 },
    { effect: "capRaise", weight: 2, value: 5 },
    { effect: "freezeCharge", weight: 2, value: 3 },
    // One free item (the cheapest offer) in the next OPEN store (issue #48).
    { effect: "freeShopItem", weight: 1, value: 1 },
    // Stronger rewards so tokens stay worth chasing late (#52).
    { effect: "extraLife", weight: 1, value: 1 },
    { effect: "overtimePercent", weight: 2, value: 15 }, // value = percent of banked overtime
    { effect: "rainbowConvert", weight: 1, value: 1 },
  ],
};
