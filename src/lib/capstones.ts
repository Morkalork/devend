/**
 * Capstone pool loading + drawing (see src/types/capstone.ts for the feature
 * note). Mirrors doorDraft.ts: a module-level catalogue from
 * public/capstones.yml with graceful fallback - no pool simply skips the
 * capstone draft.
 */
import yaml from 'js-yaml';
import { CapstoneConfig, CapstoneData } from '@/types/capstone';

export const DEFAULT_CAPSTONE_LEVEL = 10;

let liveCapstones: CapstoneConfig[] = [];
let liveTriggerLevel = DEFAULT_CAPSTONE_LEVEL;

export function getCapstones(): CapstoneConfig[] {
  return liveCapstones;
}

/** First completed level at/past which the draft is offered. */
export function getCapstoneTriggerLevel(): number {
  return liveTriggerLevel;
}

/** Coerce one raw YAML entry into a CapstoneConfig, or null if it's unusable. */
function parseCapstoneEntry(raw: unknown): CapstoneConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.description !== 'string') return null;
  if (!r.modifiers || typeof r.modifiers !== 'object') return null;
  const modifiers: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.modifiers as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) modifiers[k] = n;
  }
  if (Object.keys(modifiers).length === 0) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    tag: typeof r.tag === 'string' ? (r.tag as CapstoneConfig['tag']) : undefined,
    modifiers,
  };
}

/**
 * Load the capstone pool from public/capstones.yml. Returns true on success;
 * failure keeps the previous pool (initially empty) so a broken file never
 * gates play.
 */
export async function loadCapstones(): Promise<boolean> {
  try {
    const response = await fetch('/capstones.yml', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load capstones.yml: ${response.status}`);
    const data = yaml.load(await response.text()) as CapstoneData | null;
    if (!data || !Array.isArray(data.capstones)) throw new Error('Invalid capstones.yml: missing `capstones` array');
    const parsed = data.capstones.map(parseCapstoneEntry).filter((c): c is CapstoneConfig => c !== null);
    if (parsed.length === 0) throw new Error('capstones.yml contained no valid capstones');
    liveCapstones = parsed;
    liveTriggerLevel = Number.isFinite(Number(data.offeredAfterLevel)) && Number(data.offeredAfterLevel) > 0
      ? Math.round(Number(data.offeredAfterLevel))
      : DEFAULT_CAPSTONE_LEVEL;
    return true;
  } catch (err) {
    console.warn('[capstones] Capstone pool unavailable, playing without the draft:', err);
    return false;
  }
}

/** Draw `n` distinct capstones from the pool (uniform, no replacement). */
export function drawCapstoneOffers(pool: CapstoneConfig[], n: number): CapstoneConfig[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, n));
}
