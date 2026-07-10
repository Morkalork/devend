/**
 * Capstones — the once-per-run exclusive perk ("Promotion").
 *
 * The first time the player finishes a level at or past the trigger level
 * (default 10), the shop exit routes through a mandatory 1-of-3 draft. The
 * chosen capstone's modifiers apply permanently for the rest of the run
 * (they survive ascension) and the two passed-over picks are gone for good.
 * Capstones are rule-breakers, not stat bumps. Defined in public/capstones.yml;
 * `modifiers` uses the same GameModifiers keys as upgrades/loadouts/doors.
 */
import { UpgradeTag } from '@/types/upgrade';

export interface CapstoneConfig {
  id: string;
  name: string;
  description: string;
  /** Archetype flavour, shown as a chip on the draft card. */
  tag?: UpgradeTag;
  modifiers: Record<string, number>;
}

export interface CapstoneData {
  /** First completed level at/past which the draft is offered (default 10). */
  offeredAfterLevel?: number;
  capstones: CapstoneConfig[];
}
