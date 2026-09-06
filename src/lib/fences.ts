/**
 * Fence-type catalogue (FENCE_TYPES_PLAN.md): what KIND of fence a cut draws.
 *
 * Loaded from public/fences.yml exactly the way abilities and ball types are:
 * baked into the bundle at build time (the `?raw` import) so the game always has
 * a valid catalogue, and re-fetched at runtime by `loadFenceTypes()` so a
 * deployed build picks up YAML tweaks without a rebuild.
 *
 * This module is the CATALOGUE ONLY. It holds no game state and reaches into no
 * physics: what a type does lives at the sites that already own those decisions
 * (the build speed in fenceZones' factor stack, the speed step in updateBall
 * beside the ball-type abilities, the drill in destructibles). Split that way
 * for the reason abilities.ts is split from abilityEffects.ts - the catalogue is
 * imported from everywhere, and a catalogue that imported the physics would drag
 * the whole engine into the store screen.
 */
import yaml from "js-yaml";
import fencesYamlRaw from "../../public/fences.yml?raw";

/** Where a fence type comes from. Documentation until step 7 wires acquisition. */
/**
 * Where a type comes from.
 *
 * "store" is deliberately absent. The plan named the store and the upgrade
 * chains as separate channels, and in this game they are one: the upgrade shop
 * IS the store, so five types are entries in upgrades.yml and inventing a
 * parallel shelf mechanism would have been a second way to buy the same thing.
 * "Openly in the store" is therefore a ROOT upgrade rather than a new
 * mechanism, and "earned by staying the course" is `unlockAfterChoice` on a
 * family's top tier. The certificate store is genuinely separate, because what
 * it sells outlives the run.
 */
export type FenceSource = "always" | "upgrade" | "certificate";

const ALL_SOURCES: Record<FenceSource, true> = {
  always: true, upgrade: true, certificate: true,
};
export const FENCE_SOURCES = Object.keys(ALL_SOURCES) as FenceSource[];
const VALID_SOURCES = new Set<string>(FENCE_SOURCES);

/** A fence-type id is a catalogue key (dynamic, so just a string). */
export type FenceTypeId = string;

/**
 * The id every fence falls back to.
 *
 * Named rather than written as `"standard"` at each site, because it is the
 * answer to three different questions that must never diverge: which type slot
 * 1 holds, what an unset `fenceTypeId` means, and what a wall saved before this
 * feature existed should read as.
 */
export const STANDARD_FENCE_ID = "standard";

export interface FenceTypeDef {
  id: FenceTypeId;
  name: string;
  /** The fence's colour on the board (hex with '#'). */
  color: string;
  /**
   * Growth multiplier. 1 is the standard fence; below 1 is slower.
   *
   * This is the price of every special type. Multiplied into the same factor
   * stack as fence zones and the ability/upgrade multipliers, never added.
   */
  buildSpeed: number;
  /**
   * World-units a ball's speed changes when it bounces off this fence.
   * Negative slows (ice), positive speeds up (flare), 0 does nothing.
   */
  ballSpeedStep: number;
  /** Ball hits this fence survives before fracturing. Undefined = the default. */
  maxHits?: number;
  /**
   * Milliseconds the first ball to bounce off a FINISHED fence of this type is
   * held still. 0 = this type does not hold.
   */
  holdMs: number;
  /**
   * How many holds the MAP gets, across every fence of this type on it.
   *
   * Per map rather than per fence, because a fence type is unlimited once
   * owned: per fence would let a player chain-hold one ball across a whole
   * board, which is a stronger effect than any freeze upgrade in the tree.
   */
  holdsPerMap: number;
  /**
   * Can a finished fence of this type be grabbed and thrown with?
   *
   * The one property that is not about what happens when a ball ARRIVES. A
   * slingshot fence sits there finished until the player pulls it back and lets
   * go, once, so it is the only type whose effect the player has to spend a
   * gesture on rather than a cut.
   */
  slingshot: boolean;
  /** May a cut START on a breakable? Only the drill. */
  anchorOnBreakable: boolean;
  /** Damage per second dealt to a breakable this fence is touching. */
  drillDamage: number;
  source: FenceSource;
  description?: string;
  howTo?: string;
}

function parseEntry(raw: unknown): FenceTypeDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const color = typeof r.color === "string" ? r.color : null;
  if (!id || !color) return null;

  const num = (v: unknown, fallback: number): number =>
    Number.isFinite(Number(v)) ? Number(v) : fallback;

  // buildSpeed is clamped rather than merely defaulted: a zero or negative
  // would be a fence that never finishes or grows backwards, and a YAML typo
  // should cost the tuning it names, not the game.
  const buildSpeed = Math.max(0.1, Math.min(4, num(r.buildSpeed, 1)));
  const maxHits = Number.isFinite(Number(r.maxHits)) && Number(r.maxHits) > 0
    ? Math.round(Number(r.maxHits))
    : undefined;

  return {
    id,
    name: typeof r.name === "string" ? r.name : id,
    color,
    buildSpeed,
    ballSpeedStep: num(r.ballSpeedStep, 0),
    maxHits,
    holdMs: Math.max(0, num(r.holdMs, 0)),
    // Defaulted to one rather than zero: a type that states a holdMs and no
    // count means "it holds", and reading that as "it holds zero times" would
    // be a fence whose whole entry does nothing with nothing on screen to say.
    holdsPerMap: Math.max(0, Math.round(num(r.holdsPerMap, r.holdMs ? 1 : 0))),
    slingshot: r.slingshot === true,
    anchorOnBreakable: r.anchorOnBreakable === true,
    drillDamage: Math.max(0, num(r.drillDamage, 0)),
    source: typeof r.source === "string" && VALID_SOURCES.has(r.source)
      ? (r.source as FenceSource)
      : "upgrade",
    description: typeof r.description === "string" ? r.description : undefined,
    howTo: typeof r.howTo === "string" ? r.howTo : undefined,
  };
}

function parseCatalogue(text: string): FenceTypeDef[] {
  try {
    const data = yaml.load(text) as { fences?: unknown[] } | null;
    if (!data || !Array.isArray(data.fences)) return [];
    return data.fences.map(parseEntry).filter((f): f is FenceTypeDef => f !== null);
  } catch {
    return [];
  }
}

/**
 * The one type the game cannot do without, so a malformed fences.yml still
 * leaves every cut drawable. Deliberately identical to the YAML's `standard`.
 */
const LAST_RESORT: FenceTypeDef = {
  id: STANDARD_FENCE_ID,
  name: "Standard",
  color: "#00ff88",
  buildSpeed: 1,
  ballSpeedStep: 0,
  holdMs: 0,
  holdsPerMap: 0,
  slingshot: false,
  anchorOnBreakable: false,
  drillDamage: 0,
  source: "always",
};

/**
 * Guarantee the standard type exists and is first.
 *
 * Slot 1 holds it, every unset `fenceTypeId` resolves to it, and the whole
 * feature degrades to "the game as it was" when it is present. A catalogue that
 * dropped it would take the ordinary fence away, which is the one failure this
 * module must not be able to have.
 */
function withStandard(list: FenceTypeDef[]): FenceTypeDef[] {
  const rest = list.filter(f => f.id !== STANDARD_FENCE_ID);
  const standard = list.find(f => f.id === STANDARD_FENCE_ID) ?? LAST_RESORT;
  return [standard, ...rest];
}

const DEFAULT_FENCES = withStandard(parseCatalogue(fencesYamlRaw));

let liveFences: FenceTypeDef[] = DEFAULT_FENCES;
let fenceById = new Map(liveFences.map(f => [f.id, f]));

/** Every fence type, standard first, then in author order. */
export function getAllFenceTypes(): FenceTypeDef[] {
  return liveFences;
}

/** The standard type, which always exists. */
export function standardFenceType(): FenceTypeDef {
  return fenceById.get(STANDARD_FENCE_ID) ?? LAST_RESORT;
}

/**
 * Look one up, falling back to the standard type.
 *
 * NEVER returns undefined, and that is the point. Every caller is on a path
 * that has to draw a fence, and an unknown id - a stale save, a slot holding a
 * type removed from the YAML, a typo in a store card - must degrade to an
 * ordinary fence rather than to a crash or an invisible one.
 */
export function getFenceType(id: FenceTypeId | undefined | null): FenceTypeDef {
  if (!id) return standardFenceType();
  return fenceById.get(id) ?? standardFenceType();
}

/** True when `id` names a type this catalogue actually has. */
export function isKnownFenceType(id: FenceTypeId | undefined | null): boolean {
  return !!id && fenceById.has(id);
}

/**
 * How many slots sit under the board, standard included.
 *
 * The same number as MAX_ABILITY_SLOTS and deliberately not shared with it:
 * they are two different bars that happen to agree today, and coupling them
 * would mean an ascension rule tightening one silently tightened the other.
 */
export const FENCE_SLOTS = 5;

/**
 * Replace the live catalogue from fences.yml TEXT. Returns whether it took.
 *
 * Refuses an empty parse rather than installing it: a malformed file must leave
 * the build-time catalogue standing, because the alternative is a board where
 * every fence silently becomes standard and nothing on screen says why.
 */
export function applyFenceCatalogue(text: string): boolean {
  const parsed = parseCatalogue(text);
  if (parsed.length === 0) return false;
  liveFences = withStandard(parsed);
  fenceById = new Map(liveFences.map(f => [f.id, f]));
  return true;
}

/**
 * Re-fetch fences.yml at runtime, exactly as loadAbilities does.
 *
 * This existed only as the text-taking function above and NOTHING CALLED IT, so
 * the runtime re-fetch the module header promises was never happening: a
 * deployed build served whatever fences.yml was baked in at build time, and a
 * YAML tweak on staging did nothing at all. Silent, because the build-time
 * catalogue is valid - the game plays correctly and simply ignores the file.
 *
 * Same shape and same failure behaviour as the abilities and ball-type loaders,
 * so all three are called together and none of them is the odd one out.
 */
export async function loadFenceTypes(): Promise<boolean> {
  try {
    const response = await fetch("/fences.yml", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load fences.yml: ${response.status}`);
    if (!applyFenceCatalogue(await response.text())) {
      throw new Error("fences.yml contained no valid fence types");
    }
    return true;
  } catch (err) {
    console.warn("[fences] Keeping the build-time catalogue:", err);
    return false;
  }
}
