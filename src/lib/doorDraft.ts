/**
 * Door pool loading + drawing (see src/types/door.ts for the feature note).
 *
 * A module-level catalogue loaded from public/doors.yml, with graceful
 * fallback to an empty pool: no doors makes assignment levels fall back to
 * the regular shop, so a broken file never gates play.
 */
import { DoorConfig } from '@/types/door';
import { fetchYamlCatalogue, parseModifiers, drawRandom } from '@/lib/yamlCatalogue';

/** Doors rolled per assignment; the pick is mandatory (no standard door). */
export const ASSIGNMENT_OFFER_COUNT = 3;

/** Default assignment cadence: one every N completed levels. */
export const DEFAULT_DOOR_LEVEL = 5;

let liveDoors: DoorConfig[] = [];
let liveTriggerLevel = DEFAULT_DOOR_LEVEL;

export function getDoors(): DoorConfig[] {
  return liveDoors;
}

/** Assignment cadence N (doors.yml offeredAfterLevel): one every N levels. */
export function getDoorTriggerLevel(): number {
  return liveTriggerLevel;
}

/**
 * Assignments replace the shop on every Nth completed level (5, 10, 15, ...
 * with the default cadence). The picked door's bundle then runs until the
 * next assignment swaps it out.
 */
export function isAssignmentLevel(completedLevel: number): boolean {
  const n = getDoorTriggerLevel();
  return n > 0 && completedLevel > 0 && completedLevel % n === 0;
}

/** Coerce one raw YAML entry into a DoorConfig, or null if it's unusable. */
function parseDoorEntry(raw: unknown): DoorConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  if (typeof r.risk !== 'string' || typeof r.reward !== 'string') return null;
  const modifiers = parseModifiers(r.modifiers);
  if (!modifiers) return null;
  return {
    id: r.id,
    name: r.name,
    risk: r.risk,
    reward: r.reward,
    clarify: typeof r.clarify === 'string' ? r.clarify : undefined,
    modifiers,
  };
}

/**
 * Load the door pool from public/doors.yml. Returns true on success; failure
 * keeps the previous pool (initially empty) so a broken file never gates play.
 */
export async function loadDoors(): Promise<boolean> {
  try {
    const { entries, doc } = await fetchYamlCatalogue('/doors.yml', 'doors', parseDoorEntry);
    liveDoors = entries;
    const trigger = Number(doc.offeredAfterLevel);
    liveTriggerLevel = Number.isFinite(trigger) && trigger > 0 ? Math.round(trigger) : DEFAULT_DOOR_LEVEL;
    return true;
  } catch (err) {
    console.warn('[doors] Door pool unavailable, playing without doors:', err);
    return false;
  }
}

/** Draw `n` distinct doors from the pool (uniform, no replacement). */
export function drawDoorOffers(pool: DoorConfig[], n: number): DoorConfig[] {
  return drawRandom(pool, n);
}
