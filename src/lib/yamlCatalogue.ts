/**
 * Shared plumbing for the small YAML-backed catalogues (doors.yml,
 * capstones.yml, …): fetch + parse + per-entry validation, and a uniform
 * random draw. Each catalogue keeps its own module state and fallback
 * semantics; this only removes the copy-pasted mechanics.
 */
import yaml from 'js-yaml';

/**
 * Fetch a YAML file and coerce `doc[listKey]` through `parseEntry`, dropping
 * unusable entries. Throws (for the caller's fallback path) on fetch errors,
 * a missing list, or when nothing valid survives parsing. Returns the parsed
 * entries plus the raw document for catalogue-specific extras (e.g. a
 * top-level trigger level).
 */
export async function fetchYamlCatalogue<T>(
  url: string,
  listKey: string,
  parseEntry: (raw: unknown) => T | null,
): Promise<{ entries: T[]; doc: Record<string, unknown> }> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const doc = yaml.load(await response.text()) as Record<string, unknown> | null;
  const list = doc?.[listKey];
  if (!doc || !Array.isArray(list)) throw new Error(`Invalid ${url}: missing \`${listKey}\` array`);
  const entries = list.map(parseEntry).filter((e): e is T => e !== null);
  if (entries.length === 0) throw new Error(`${url} contained no valid entries`);
  return { entries, doc };
}

/**
 * Coerce a raw `modifiers` map to finite numbers, or null when absent/empty.
 * Every catalogue entry that carries GameModifiers goes through this.
 */
export function parseModifiers(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const modifiers: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) modifiers[k] = n;
  }
  return Object.keys(modifiers).length > 0 ? modifiers : null;
}

/**
 * Draw `n` distinct entries from the pool (uniform, no replacement).
 * `rng` defaults to Math.random; seeded runs pass getRunRng(...) so daily
 * players are offered the same draws (HIGHSCORES.md Phase D).
 */
export function drawRandom<T>(pool: T[], n: number, rng: () => number = Math.random): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, n));
}
