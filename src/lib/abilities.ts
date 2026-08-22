/**
 * Ability catalogue (destruct-up rewards, issue #38).
 *
 * The abilities a smashed chest can grant, loaded from public/abilities.yml the
 * same way ball types load from balls.yml:
 *  - baked into the bundle at build time (the `?raw` import), so the game always
 *    has a valid catalogue, and
 *  - re-fetched at runtime by `loadAbilities()`, so a deployed build (or the dev
 *    server) picks up YAML tweaks without a rebuild.
 *
 * This module is the catalogue + the (seeded, level-gated) reward roll only. The
 * effect LOGIC lives in src/lib/abilityEffects.ts (split so the chest/destroy
 * code can import the roll here without an import cycle through the effects,
 * which reach back into destructibles.ts for the region rebuild).
 */
import yaml from "js-yaml";
import abilitiesYamlRaw from "../../public/abilities.yml?raw";

/** The coded effect an ability triggers. A new kind needs code in abilityEffects.ts. */
export type AbilityKind = "freeze" | "slow" | "slowArea" | "descope" | "clearFences" | "magnet" | "shockwave" | "fenceRush" | "fenceShield";
/** Every coded kind, exported so nothing has to keep a second copy of the list. */
export const ABILITY_KINDS: readonly AbilityKind[] = [
  "freeze", "slow", "slowArea", "descope", "clearFences", "magnet", "shockwave",
  "fenceRush", "fenceShield",
];
const VALID_KINDS = new Set<AbilityKind>(ABILITY_KINDS);

/** An ability id is a catalogue key (dynamic, so just a string). */
export type AbilityId = string;

export interface AbilityDef {
  id: string;
  name: string;
  kind: AbilityKind;
  /** Gem + button colour (hex with '#'). */
  color: string;
  /** Relative roll weight within an eligible pool. */
  weight: number;
  /** Lowest level at which this reward may appear in a chest. */
  startLevel: number;
  /** freeze / slow: effect duration in seconds. */
  durationSeconds?: number;
  /** slow: creepFactor multiplier while active (<1). slowArea: the same, but
   *  applied only inside the placed zone, and for the rest of the map. */
  factor?: number;
  /** slowArea: side length of the placed zone, in world units. */
  size?: number;
  /** true = arm on tap, then the player taps the board to pick a point (magnet). */
  targeted?: boolean;
  /** Info modal: one-line "what it does". */
  description?: string;
  /** Info modal: one-line "how to use it". */
  howTo?: string;
}

function parseAbilityEntry(raw: unknown): AbilityDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const color = typeof r.color === "string" ? r.color : null;
  const kind = typeof r.kind === "string" && VALID_KINDS.has(r.kind as AbilityKind)
    ? (r.kind as AbilityKind)
    : null;
  if (!id || !color || !kind) return null;

  const weight = Number.isFinite(Number(r.weight)) && Number(r.weight) > 0 ? Number(r.weight) : 1;
  const startLevel = Number.isFinite(Number(r.startLevel)) ? Math.max(1, Math.round(Number(r.startLevel))) : 1;
  const durationSeconds = Number.isFinite(Number(r.durationSeconds)) && Number(r.durationSeconds) > 0
    ? Number(r.durationSeconds)
    : undefined;
  const factor = Number.isFinite(Number(r.factor)) && Number(r.factor) > 0 ? Number(r.factor) : undefined;
  const size = Number.isFinite(Number(r.size)) && Number(r.size) > 0 ? Number(r.size) : undefined;

  return {
    id,
    name: typeof r.name === "string" ? r.name : id,
    kind,
    color,
    weight,
    startLevel,
    durationSeconds,
    factor,
    size,
    targeted: r.targeted === true,
    description: typeof r.description === "string" ? r.description : undefined,
    howTo: typeof r.howTo === "string" ? r.howTo : undefined,
  };
}

/** Parse an abilities.yml document into validated defs ([] on any failure). */
function parseCatalogue(text: string): AbilityDef[] {
  try {
    const data = yaml.load(text) as { abilities?: unknown[] } | null;
    if (!data || !Array.isArray(data.abilities)) return [];
    return data.abilities.map(parseAbilityEntry).filter((a): a is AbilityDef => a !== null);
  } catch {
    return [];
  }
}

// Last resort so a malformed abilities.yml still keeps the game bootable.
const LAST_RESORT: AbilityDef[] = [
  { id: "freezeAll", name: "Freeze All", kind: "freeze", color: "#7fd4ff", weight: 3, startLevel: 1, durationSeconds: 3 },
];

const bakedCatalogue = parseCatalogue(abilitiesYamlRaw);
const DEFAULT_ABILITIES: AbilityDef[] = bakedCatalogue.length > 0 ? bakedCatalogue : LAST_RESORT;

// ── Live catalogue (loaded from abilities.yml, defaults until then) ──────────
let liveAbilities: AbilityDef[] = DEFAULT_ABILITIES;
let abilityById = new Map(liveAbilities.map(a => [a.id, a]));

/** All abilities currently in effect (default or YAML-loaded), in author order. */
export function getAllAbilities(): AbilityDef[] {
  return liveAbilities;
}

export function getAbility(id: string): AbilityDef | undefined {
  return abilityById.get(id);
}

/** Abilities eligible to appear in a chest at the given (1-based) level. */
export function getEligibleAbilities(level: number): AbilityDef[] {
  return liveAbilities.filter(a => a.startLevel <= level);
}

/**
 * Roll one ability id for a smashed chest: weighted, among every ability
 * unlocked at `level`, optionally narrowed to the chest's authored `pool`. Falls
 * back to the full eligible set (then the whole catalogue) if a narrowing leaves
 * nothing. Returns null only if the catalogue is somehow empty.
 */
/**
 * How many DISTINCT abilities a player may hold at once.
 *
 * A cap, rather than letting the bar grow to the whole catalogue, for the same
 * reason the upgrade shop offers three of a hundred: a loadout you chose is a
 * build, and a loadout you accumulated is an inventory. With every ability
 * available at once there is no wrong moment to smash a chest and no reason to
 * prefer one reward over another, so the whole system flattens into "press the
 * button that helps".
 *
 * Ascension tightens it (see AscensionRules.abilitySlots), which is a rules
 * change rather than a stat nerf: the same abilities, fewer of them at a time.
 */
export const MAX_ABILITY_SLOTS = 5;

/**
 * The reward a chest grants, honouring the slot cap.
 *
 * At the cap, a roll that lands on an ability the player does NOT hold is
 * re-rolled among the ones they do, so the chest still pays. Refusing the
 * grant outright was the alternative and it is worse: a chest is a thing the
 * player spent balls and time smashing, and "you get nothing because your bar
 * is full" punishes them for the reward system working. Converting it into a
 * charge of something they already chose keeps every chest worth opening and
 * turns the cap into a shape for the build rather than a wall.
 *
 * `held` is the ids currently holding a charge. Passing it is optional so every
 * existing caller and test keeps the uncapped behaviour.
 */
export function rollCappedAbilityReward(
  pool: string[] | undefined,
  level: number,
  rng: () => number,
  held?: readonly string[],
  slots: number = MAX_ABILITY_SLOTS,
): string | null {
  const first = rollAbilityReward(pool, level, rng);
  if (first === null || !held) return first;
  const distinct = new Set(held);
  if (distinct.size < Math.max(1, slots) || distinct.has(first)) return first;
  // At the cap and the roll is a stranger: re-roll among what is already held,
  // narrowed by the chest's own pool where that leaves anything.
  const heldIds = [...distinct];
  const narrowed = pool && pool.length > 0
    ? heldIds.filter(id => pool.includes(id))
    : heldIds;
  const from = narrowed.length > 0 ? narrowed : heldIds;
  return rollAbilityReward(from, level, rng) ?? from[0] ?? null;
}

export function rollAbilityReward(pool: string[] | undefined, level: number, rng: () => number): string | null {
  let eligible = getEligibleAbilities(level);
  if (eligible.length === 0) eligible = liveAbilities; // level below every startLevel
  if (pool && pool.length > 0) {
    const narrowed = eligible.filter(a => pool.includes(a.id));
    if (narrowed.length > 0) eligible = narrowed;
  }
  if (eligible.length === 0) return null;
  const total = eligible.reduce((s, a) => s + Math.max(0, a.weight), 0);
  if (total <= 0) return eligible[0].id;
  let roll = rng() * total;
  for (const a of eligible) {
    roll -= Math.max(0, a.weight);
    if (roll < 0) return a.id;
  }
  return eligible[eligible.length - 1].id;
}

/**
 * Re-fetch the ability catalogue from the SERVED public/abilities.yml. Returns
 * true on success; on any failure the build-time catalogue stays in effect.
 */
export async function loadAbilities(): Promise<boolean> {
  try {
    const response = await fetch("/abilities.yml", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load abilities.yml: ${response.status}`);
    const parsed = parseCatalogue(await response.text());
    if (parsed.length === 0) throw new Error("abilities.yml contained no valid abilities");
    liveAbilities = parsed;
    abilityById = new Map(parsed.map(a => [a.id, a]));
    return true;
  } catch (err) {
    console.warn("[abilities] Keeping the build-time catalogue:", err);
    return false;
  }
}
