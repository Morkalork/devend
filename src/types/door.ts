/**
 * Doors — risk/reward gates between maps (branching-choice feature).
 *
 * After each shop the player picks how to enter the next map: the standard
 * door (no modifiers) or one of a few risk doors, each bundling a downside
 * with a payoff that applies to that map only (and the shop right after it,
 * so shop-facing rewards like extra slots work). Defined in public/doors.yml;
 * `modifiers` uses the same GameModifiers keys as upgrades/loadouts.
 */
export interface DoorConfig {
  id: string;
  name: string;
  /** Downside text, shown in red on the door card. */
  risk: string;
  /** Payoff text, shown in accent colour. */
  reward: string;
  modifiers: Record<string, number>;
}

export interface DoorData {
  doors: DoorConfig[];
  /** Completed-level threshold at/past which doors start being offered. */
  offeredAfterLevel?: number;
}
