/**
 * Bug catalogue (public/bugs.yml): what kinds of bug a board can grow.
 *
 * Loaded exactly the way fences, abilities and ball types are: baked into the
 * bundle at build time (`?raw`) so the game always has a valid catalogue, and
 * re-fetched at runtime by `loadBugs()` so a deployed build picks up YAML
 * tweaks without a rebuild.
 *
 * CATALOGUE ONLY, for the reason fences.ts is split from the physics: this
 * module is imported by the admin screens and the renderer, and a catalogue
 * that reached into the engine would drag the whole of it into the Playground.
 * What a bug DOES lives in physics/bugEffects.ts.
 */
import yaml from "js-yaml";
import bugsYamlRaw from "../../public/bugs.yml?raw";
import type { BugDef } from "@/types/bugs";

interface RawBug {
  id?: unknown;
  name?: unknown;
  color?: unknown;
  weight?: unknown;
  value?: unknown;
  valueMax?: unknown;
  value_max?: unknown;
  danger?: unknown;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * Parse a catalogue, dropping anything without an id.
 *
 * An entry with no id cannot be forced from admin, cannot be looked up by a
 * live bug, and cannot be spawned - it is not a partially-valid bug, it is a
 * typo, and keeping it would put an unnameable thing in the Playground picker.
 */
function parseCatalogue(text: string): BugDef[] {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (err) {
    console.warn("[bugs] bugs.yml did not parse:", err);
    return [];
  }
  const list = (doc as { bugs?: unknown } | null)?.bugs;
  if (!Array.isArray(list)) return [];

  const out: BugDef[] = [];
  for (const entry of list as RawBug[]) {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0) continue;
    const valueMax = entry.valueMax ?? entry.value_max;
    out.push({
      id: entry.id,
      name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
      color: typeof entry.color === "string" ? entry.color : "#ffffff",
      // A negative weight would quietly skew the whole pool through the
      // running total the draw walks, so it is floored rather than trusted.
      weight: Math.max(0, num(entry.weight, 1)),
      value: num(entry.value, 1),
      valueMax: typeof valueMax === "number" && Number.isFinite(valueMax) ? valueMax : undefined,
      danger: entry.danger === true,
    });
  }
  return out;
}

const DEFAULT_BUGS = parseCatalogue(bugsYamlRaw);

let liveBugs: BugDef[] = DEFAULT_BUGS;
let bugById = new Map(liveBugs.map(b => [b.id, b]));

/** Every bug type, in author order. */
export function getAllBugs(): BugDef[] {
  return liveBugs;
}

/** Look one up. Undefined for an unknown id, which callers must handle. */
export function getBug(id: string | undefined | null): BugDef | undefined {
  if (!id) return undefined;
  return bugById.get(id);
}

/** True when `id` names a bug this catalogue actually has. */
export function isKnownBug(id: string | undefined | null): boolean {
  return !!id && bugById.has(id);
}

/**
 * Draw a bug from the pool by weight, using the supplied 0..1 generator.
 *
 * The generator is passed in rather than taken from Math.random so a seeded
 * (Daily Stand-up) run draws the same bug on every device: which bug appears
 * changes the board from that moment on, so it is exactly the kind of decision
 * that has to agree across a lockstep pair.
 *
 * Returns undefined only when the catalogue is empty or every weight is 0.
 */
export function drawBug(rng: () => number): BugDef | undefined {
  const pool = liveBugs.filter(b => b.weight > 0);
  if (pool.length === 0) return undefined;
  let total = 0;
  for (const b of pool) total += b.weight;
  if (total <= 0) return undefined;
  let roll = rng() * total;
  for (const b of pool) {
    roll -= b.weight;
    if (roll <= 0) return b;
  }
  return pool[pool.length - 1];
}

/**
 * The magnitude for one squash: `value`, or a draw within [value, valueMax].
 *
 * Seeded like the draw above and for the same reason - Feature Bloat's growth
 * decides how hard the ball is to fence for the rest of the map.
 */
export function bugMagnitude(def: BugDef, rng: () => number): number {
  if (def.valueMax === undefined || def.valueMax <= def.value) return def.value;
  return def.value + rng() * (def.valueMax - def.value);
}

/**
 * Replace the live catalogue from bugs.yml TEXT. Returns whether it took.
 *
 * Refuses an empty parse rather than installing it: a malformed file must leave
 * the build-time catalogue standing, because the alternative is a board where
 * bugs silently stop spawning and nothing anywhere says why.
 */
export function applyBugCatalogue(text: string): boolean {
  const parsed = parseCatalogue(text);
  if (parsed.length === 0) return false;
  liveBugs = parsed;
  bugById = new Map(liveBugs.map(b => [b.id, b]));
  return true;
}

/** Re-fetch bugs.yml at runtime, exactly as loadFenceTypes does. */
export async function loadBugs(): Promise<boolean> {
  try {
    const response = await fetch("/bugs.yml", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load bugs.yml: ${response.status}`);
    if (!applyBugCatalogue(await response.text())) {
      throw new Error("bugs.yml contained no valid bugs");
    }
    return true;
  } catch (err) {
    console.warn("[bugs] Keeping the build-time catalogue:", err);
    return false;
  }
}
