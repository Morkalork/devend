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
import { MapMutator, ActiveMapMutator } from "@/types/mapMutator";
import { fetchYamlCatalogue, drawRandom } from "@/lib/yamlCatalogue";
import { PROCEDURAL_MIN_LEVEL } from "@/lib/mapSlots";
import type { Rng } from "@/lib/runRng";

const VALID_BEHAVIORS = new Set(["crunch", "overclock", "conveyor", "none"]);

let liveMutators: MapMutator[] = [];
/** Odds weight of "no mutator this map", so some eligible maps stay vanilla. */
let liveNoneWeight = 1;

export function getMapMutators(): MapMutator[] {
  return liveMutators;
}
export function getMutatorNoneWeight(): number {
  return liveNoneWeight;
}

/** Coerce one raw YAML entry into a MapMutator, or null if unusable. */
function parseMutatorEntry(raw: unknown): MapMutator | null {
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
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    clarify: typeof r.clarify === "string" ? r.clarify : undefined,
    behavior: r.behavior as MapMutator["behavior"],
    minLevel: num(r.minLevel),
    maxLevel: num(r.maxLevel),
    weight: num(r.weight),
    params,
    overtimePremium: num(r.overtimePremium),
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
  if (levelNumber < PROCEDURAL_MIN_LEVEL) return [];
  return pool.filter((m) => {
    const min = m.minLevel ?? PROCEDURAL_MIN_LEVEL;
    const max = m.maxLevel ?? Infinity;
    return levelNumber >= min && levelNumber <= max;
  });
}

/**
 * Pick one mutator for a map (or null for a vanilla map), deterministically
 * from `rng`. A synthetic "none" bucket of weight `noneWeight` leaves some maps
 * unmodified. Resolves per-map rolled fields (conveyor drift). Returns null when
 * the level is below the procedural band or nothing is eligible.
 */
export function selectMapMutator(
  levelNumber: number,
  rng: Rng,
  pool: MapMutator[] = liveMutators,
  noneWeight: number = liveNoneWeight,
): ActiveMapMutator | null {
  const eligible = eligibleMutators(levelNumber, pool);
  if (eligible.length === 0) return null;

  const weightOf = (m: MapMutator) => Math.max(0, m.weight ?? 1);
  const total = eligible.reduce((s, m) => s + weightOf(m), 0) + Math.max(0, noneWeight);
  if (total <= 0) return null;

  let r = rng() * total;
  let chosen: MapMutator | null = null;
  for (const m of eligible) {
    r -= weightOf(m);
    if (r < 0) { chosen = m; break; }
  }
  // Fell through into the "none" bucket → vanilla map.
  if (!chosen) return null;
  if (chosen.behavior === "none") return null;

  return resolveMutator(chosen, rng);
}

/** Fill in per-map rolled fields for a chosen mutator. */
function resolveMutator(m: MapMutator, rng: Rng): ActiveMapMutator {
  const active: ActiveMapMutator = { ...m };
  if (m.behavior === "conveyor") {
    const speed = m.params?.speed ?? 55;
    const horizontal = rng() < 0.5;
    const sign = rng() < 0.5 ? 1 : -1;
    active.driftX = horizontal ? speed * sign : 0;
    active.driftY = horizontal ? 0 : speed * sign;
  }
  return active;
}

// ── Pure application helpers (called from physics/scoring) ────────────────────

/**
 * The map-mutator speed multiplier applied to BOTH ball displacement (folded
 * into game.creepFactor so the aim line stays in sync) and mover speed. 1 for
 * conveyor/none/no-mutator.
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
