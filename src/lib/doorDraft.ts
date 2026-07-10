/**
 * Door pool loading + drawing (see src/types/door.ts for the feature note).
 *
 * A module-level catalogue loaded from public/doors.yml, with graceful
 * fallback to an empty pool: no doors simply skips the door screen and the
 * game flows shop -> next map as before.
 */
import { DoorConfig } from '@/types/door';
import { fetchYamlCatalogue, parseModifiers, drawRandom } from '@/lib/yamlCatalogue';

/** Risk doors rolled per shop exit (the standard door is always offered). */
export const DOOR_OFFERS_PER_SHOP = 2;

let liveDoors: DoorConfig[] = [];

export function getDoors(): DoorConfig[] {
  return liveDoors;
}

/** Coerce one raw YAML entry into a DoorConfig, or null if it's unusable. */
function parseDoorEntry(raw: unknown): DoorConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  if (typeof r.risk !== 'string' || typeof r.reward !== 'string') return null;
  const modifiers = parseModifiers(r.modifiers);
  if (!modifiers) return null;
  return { id: r.id, name: r.name, risk: r.risk, reward: r.reward, modifiers };
}

/**
 * Load the door pool from public/doors.yml. Returns true on success; failure
 * keeps the previous pool (initially empty) so a broken file never gates play.
 */
export async function loadDoors(): Promise<boolean> {
  try {
    const { entries } = await fetchYamlCatalogue('/doors.yml', 'doors', parseDoorEntry);
    liveDoors = entries;
    return true;
  } catch (err) {
    console.warn('[doors] Door pool unavailable, playing without doors:', err);
    return false;
  }
}

/** Draw `n` distinct risk doors from the pool (uniform, no replacement). */
export function drawDoorOffers(pool: DoorConfig[], n: number): DoorConfig[] {
  return drawRandom(pool, n);
}
