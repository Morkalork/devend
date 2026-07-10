/**
 * Door pool loading + drawing (see src/types/door.ts for the feature note).
 *
 * Mirrors the ballTypes.ts pattern: a module-level catalogue loaded from
 * public/doors.yml, with graceful fallback to an empty pool (no doors simply
 * skips the door screen — the game flows shop -> next map as before).
 */
import yaml from 'js-yaml';
import { DoorConfig, DoorData } from '@/types/door';

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
  if (!r.modifiers || typeof r.modifiers !== 'object') return null;
  const modifiers: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.modifiers as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) modifiers[k] = n;
  }
  if (Object.keys(modifiers).length === 0) return null;
  return { id: r.id, name: r.name, risk: r.risk, reward: r.reward, modifiers };
}

/**
 * Load the door pool from public/doors.yml. Returns true on success; failure
 * keeps the previous pool (initially empty) so a broken file never gates play.
 */
export async function loadDoors(): Promise<boolean> {
  try {
    const response = await fetch('/doors.yml', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load doors.yml: ${response.status}`);
    const data = yaml.load(await response.text()) as DoorData | null;
    if (!data || !Array.isArray(data.doors)) throw new Error('Invalid doors.yml: missing `doors` array');
    const parsed = data.doors.map(parseDoorEntry).filter((d): d is DoorConfig => d !== null);
    if (parsed.length === 0) throw new Error('doors.yml contained no valid doors');
    liveDoors = parsed;
    return true;
  } catch (err) {
    console.warn('[doors] Door pool unavailable, playing without doors:', err);
    return false;
  }
}

/** Draw `n` distinct risk doors from the pool (uniform, no replacement). */
export function drawDoorOffers(pool: DoorConfig[], n: number): DoorConfig[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, n));
}
