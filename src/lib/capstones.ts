/**
 * Capstone pool loading + drawing (see src/types/capstone.ts for the feature
 * note). A module-level catalogue from public/capstones.yml with graceful
 * fallback: no pool simply skips the capstone draft.
 */
import { CapstoneConfig } from '@/types/capstone';
import { fetchYamlCatalogue, parseModifiers, drawRandom } from '@/lib/yamlCatalogue';
import { isAssignmentLevel } from '@/lib/doorDraft';

export const DEFAULT_CAPSTONE_LEVEL = 10;
/** Capstones offered in the (mandatory) 1-of-N draft. */
export const CAPSTONE_OFFER_COUNT = 3;

let liveCapstones: CapstoneConfig[] = [];
let liveTriggerLevel = DEFAULT_CAPSTONE_LEVEL;

export function getCapstones(): CapstoneConfig[] {
  return liveCapstones;
}

/** First completed level at/past which the draft is offered. */
export function getCapstoneTriggerLevel(): number {
  return liveTriggerLevel;
}

/**
 * Is the Promotion due after completing `completedLevel`?
 *
 * At or past the trigger level, and NEVER on an assignment level. That second
 * clause is the whole point of this function.
 *
 * The draft used to be reachable only from inside the assignment phase, which
 * meant it could never have a moment of its own: finishing level 10 handed the
 * player a score screen, a Feature Unlocked modal, the finished contract's
 * summary, the Promotion, and the next contract, back to back. Five rewards in
 * a row is no rewards - the rarest choice in the game, once per run and with
 * the two you pass gone for good, arrived fourth in a queue and read as more
 * confetti.
 *
 * So it is offered after an ORDINARY level now, before that level's shop, where
 * it is the only thing on screen and where the perk can still inform what the
 * player buys. Enforced here rather than left to the authored number, because
 * `offeredAfterLevel` sitting on a multiple of the assignment cadence would
 * silently rebuild the pile-up.
 */
export function capstoneDueAfter(completedLevel: number): boolean {
  if (completedLevel < getCapstoneTriggerLevel()) return false;
  return !isAssignmentLevel(completedLevel);
}

/** Coerce one raw YAML entry into a CapstoneConfig, or null if it's unusable. */
function parseCapstoneEntry(raw: unknown): CapstoneConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.description !== 'string') return null;
  const modifiers = parseModifiers(r.modifiers);
  if (!modifiers) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    tag: typeof r.tag === 'string' ? (r.tag as CapstoneConfig['tag']) : undefined,
    clarify: typeof r.clarify === 'string' ? r.clarify : undefined,
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
    const { entries, doc } = await fetchYamlCatalogue('/capstones.yml', 'capstones', parseCapstoneEntry);
    liveCapstones = entries;
    const trigger = Number(doc.offeredAfterLevel);
    liveTriggerLevel = Number.isFinite(trigger) && trigger > 0 ? Math.round(trigger) : DEFAULT_CAPSTONE_LEVEL;
    return true;
  } catch (err) {
    console.warn('[capstones] Capstone pool unavailable, playing without the draft:', err);
    return false;
  }
}

/** Draw `n` distinct capstones from the pool (uniform, no replacement). */
export function drawCapstoneOffers(pool: CapstoneConfig[], n: number, rng?: () => number): CapstoneConfig[] {
  return drawRandom(pool, n, rng);
}
