/**
 * mapMutators — per-map environmental modifiers (issue #54).
 *
 * A module-level catalogue loaded from public/mapMutators.yml (mirrors
 * doorDraft.ts), plus a deterministic per-map selector and the pure application
 * helpers the physics/scoring layer calls. Graceful fallback: a missing/broken
 * file leaves an empty pool, so maps simply play without a mutator.
 *
 * Rolling and effects both key off the run seed / game state only; no direct
 * Math.random here (the selector's rng is injected), so a Daily seed makes the
 * rotation identical for every player.
 */
import yaml from "js-yaml";
import mutatorsYamlRaw from "../../public/mapMutators.yml?raw";
import { MapMutator, ActiveMapMutator } from "@/types/mapMutator";
import { fetchYamlCatalogue } from "@/lib/yamlCatalogue";
import { PROCEDURAL_MIN_LEVEL } from "@/lib/mapSlots";
import { eligibleByLevel, weightedPick, finiteOrUndefined } from "@/lib/mapPools";
import type { Rng } from "@/lib/runRng";

// A behaviour not on this list makes parseMutatorEntry drop the whole entry, so
// an authored `behavior: conveyor` left in the YAML simply never loads rather
// than half-applying.
const VALID_BEHAVIORS = new Set(["crunch", "overclock", "gravity", "none"]);

/**
 * The catalogue as it is on disk, read at BUILD time.
 *
 * `loadMapMutators` fetches the same file at runtime and replaces this, which
 * is what lets the deployed build pick up an edited mapMutators.yml without a
 * rebuild. The seed is what makes the pool correct everywhere the fetch cannot
 * run: node (every test, and the headless bot) and any code path that reads the
 * catalogue before the load resolves.
 *
 * Without it `getMapMutators()` was simply empty under vitest, so a map that
 * PINS a mutator was swept with the mutator absent - and a gravity map measured
 * without gravity is not a harsh reading of that map, it is a reading of a
 * different one. Same shape ballTypes.ts has always used for balls.yml.
 */
function seedFromDisk(): { entries: MapMutator[]; noneWeight: number } {
  try {
    const doc = yaml.load(mutatorsYamlRaw) as { mutators?: unknown[]; noneWeight?: unknown };
    const entries = (doc?.mutators ?? [])
      .map(parseMutatorEntry)
      .filter((m): m is MapMutator => !!m);
    const none = finiteOrUndefined(doc?.noneWeight);
    return { entries, noneWeight: none ?? 1 };
  } catch {
    return { entries: [], noneWeight: 1 };
  }
}

const SEED = seedFromDisk();
let liveMutators: MapMutator[] = SEED.entries;
/** Odds weight of "no mutator this map", so some eligible maps stay vanilla. */
let liveNoneWeight = SEED.noneWeight;

export function getMapMutators(): MapMutator[] {
  return liveMutators;
}
/**
 * A mutator by its catalogue id, or null.
 *
 * The lookup an AUTHORED pin needs, and it deliberately ignores `weight` and
 * `minLevel`: those govern the procedural roll, and a map that names a mutator
 * has already made the decision the roll exists to make. That is what lets a
 * set-piece mutator ship at weight 0 - pinnable, never a random visitor.
 *
 * Shared rather than local because two callers need the same answer: the game
 * screen, and the headless bot (which must play the map the player gets, or a
 * sweep of a gravity map reports on a map with no gravity in it).
 */
export function mutatorById(id: string | undefined | null): MapMutator | null {
  if (!id) return null;
  return getMapMutators().find(m => m.id === id) ?? null;
}

export function getMutatorNoneWeight(): number {
  return liveNoneWeight;
}

/**
 * Coerce one raw YAML entry into a MapMutator, or null if unusable.
 *
 * Exported so a test can build the catalogue from public/mapMutators.yml
 * through the SAME parser the game uses. The live pool is fetched at runtime,
 * so it is empty under Node, and a test that read the YAML itself would accept
 * entries the game silently drops (a bad `behavior`, a missing description) and
 * so would bless a pin that resolves to nothing in play.
 */
export function parseMutatorEntry(raw: unknown): MapMutator | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  if (typeof r.description !== "string") return null;
  if (typeof r.behavior !== "string" || !VALID_BEHAVIORS.has(r.behavior)) return null;
  const params: Record<string, number> = {};
  if (r.params && typeof r.params === "object") {
    for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) params[k] = n;
    }
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    clarify: typeof r.clarify === "string" ? r.clarify : undefined,
    behavior: r.behavior as MapMutator["behavior"],
    gravity: (r as { gravity?: MapMutator["gravity"] }).gravity,
    minLevel: finiteOrUndefined(r.minLevel),
    maxLevel: finiteOrUndefined(r.maxLevel),
    weight: finiteOrUndefined(r.weight),
    params,
    overtimePremium: finiteOrUndefined(r.overtimePremium),
  };
}

/**
 * Load the mutator pool from public/mapMutators.yml. Returns true on success;
 * failure keeps the previous pool (initially empty) so a broken file never
 * gates play.
 */
export async function loadMapMutators(): Promise<boolean> {
  try {
    const { entries, doc } = await fetchYamlCatalogue("/mapMutators.yml", "mutators", parseMutatorEntry);
    liveMutators = entries;
    const none = Number(doc.noneWeight);
    liveNoneWeight = Number.isFinite(none) && none >= 0 ? none : 1;
    return true;
  } catch (err) {
    console.warn("[mapMutators] pool unavailable, playing without mutators:", err);
    return false;
  }
}

/** Mutators eligible at this level number (range gate + procedural band). */
export function eligibleMutators(levelNumber: number, pool: MapMutator[] = liveMutators): MapMutator[] {
  return eligibleByLevel(levelNumber, pool, PROCEDURAL_MIN_LEVEL);
}

/**
 * Pick one mutator for a map (or null for a vanilla map), deterministically
 * from `rng`. A synthetic "none" bucket of weight `noneWeight` leaves some maps
 * unmodified. Returns null when
 * the level is below the procedural band or nothing is eligible.
 */
export function selectMapMutator(
  levelNumber: number,
  rng: Rng,
  pool: MapMutator[] = liveMutators,
  noneWeight: number = liveNoneWeight,
): ActiveMapMutator | null {
  const chosen = weightedPick(eligibleMutators(levelNumber, pool), noneWeight, rng);
  // null = drew the "none" bucket; a `none`-behavior entry is also a vanilla map.
  if (!chosen || chosen.behavior === "none") return null;
  return resolveMutator(chosen);
}

/**
 * Fill in per-map rolled fields for a chosen mutator.
 *
 * Nothing rolls anything today - the conveyor's drift vector was the only one -
 * but the COPY still matters: `game.mapMutator` is written to during play, and
 * handing out the catalogue entry itself would let one map's state leak into
 * every later map that rolls the same mutator.
 */
function resolveMutator(m: MapMutator): ActiveMapMutator {
  return { ...m };
}

// ── Pure application helpers (called from physics/scoring) ────────────────────

/**
 * The map-mutator speed multiplier applied to BOTH ball displacement (folded
 * into game.creepFactor so the aim line stays in sync) and mover speed. 1 for
 * none/no-mutator.
 */
export function mutatorSpeedFactor(mut: ActiveMapMutator | null, lockedBallsCount: number): number {
  if (!mut) return 1;
  if (mut.behavior === "overclock") {
    const f = mut.params?.factor ?? 1.15;
    return f > 0 ? f : 1;
  }
  if (mut.behavior === "crunch") {
    const per = mut.params?.perLockPercent ?? 6;
    const max = mut.params?.maxPercent ?? 60;
    const pct = Math.min(Math.max(0, max), Math.max(0, lockedBallsCount) * per);
    return 1 + pct / 100;
  }
  return 1;
}

/** Overtime hours awarded on clear for having played the mutated map (under cap). */
export function mutatorOvertimePremium(mut: ActiveMapMutator | null): number {
  const p = mut?.overtimePremium ?? 0;
  return Number.isFinite(p) && p > 0 ? p : 0;
}
