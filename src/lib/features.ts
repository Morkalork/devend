/**
 * Game feature catalogue — the general "Feature Unlocked" system.
 *
 * Some systems stay hidden until the player earns them mid-run. When the
 * unlock condition is met the run surfaces a "Feature Unlocked" modal
 * (FeatureUnlockedModal) and the feature is remembered forever
 * (UnlockState.unlockedFeatureIds, via useMetaProgression).
 *
 * The catalogue is CONFIG-DRIVEN from public/features.yml, loaded the same way
 * as abilities.yml / balls.yml:
 *  - baked into the bundle at build time (the `?raw` import), so a valid
 *    catalogue is always available synchronously, and
 *  - re-fetched at runtime by `loadFeatures()`, so a deployed build (or the dev
 *    server) picks up YAML tweaks without a rebuild.
 *
 * To add a feature: add an entry to public/features.yml, add its
 * `features.<id>.name` / `.body` strings to every locale, gate the feature's UI
 * on `isFeatureUnlocked('<id>')`, and (if it uses a new icon) map the icon name
 * in FeatureUnlockedModal.
 */
import yaml from "js-yaml";
import featuresYamlRaw from "../../public/features.yml?raw";

export interface GameFeature {
  /** Stable id; also the i18n namespace (`features.<id>.name` / `.body`). */
  id: string;
  /**
   * Completing this level number, at ascension depth 0, unlocks the feature.
   * OPTIONAL: event-unlocked features (e.g. certificates on the first hour)
   * omit it and are armed from code instead of by level completion.
   */
  unlockLevel?: number;
  /** lucide-react icon NAME; resolved to a component in FeatureUnlockedModal. */
  icon: string;
  /** Accent colour for the unlock modal (hex with '#'). */
  color: string;
}

function parseFeatureEntry(raw: unknown): GameFeature | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  if (!id) return null;
  const unlockLevel = Number.isFinite(Number(r.unlockLevel)) ? Math.max(1, Math.round(Number(r.unlockLevel))) : undefined;
  return {
    id,
    unlockLevel,
    icon: typeof r.icon === "string" ? r.icon : "Sparkles",
    color: typeof r.color === "string" && r.color.startsWith("#") ? r.color : "#00ff88",
  };
}

/** Parse a features.yml document into validated defs ([] on any failure). */
function parseCatalogue(text: string): GameFeature[] {
  try {
    const data = yaml.load(text) as { features?: unknown[] } | null;
    if (!data || !Array.isArray(data.features)) return [];
    return data.features.map(parseFeatureEntry).filter((f): f is GameFeature => f !== null);
  } catch {
    return [];
  }
}

// Last resort so a malformed features.yml still keeps the game bootable and
// loadouts still unlockable at the level-10 boss.
const LAST_RESORT: GameFeature[] = [
  { id: "loadouts", unlockLevel: 10, icon: "Backpack", color: "#00ff88" },
];

const bakedCatalogue = parseCatalogue(featuresYamlRaw);
const DEFAULT_FEATURES: GameFeature[] = bakedCatalogue.length > 0 ? bakedCatalogue : LAST_RESORT;

// ── Live catalogue (loaded from features.yml, defaults until then) ───────────
let liveFeatures: GameFeature[] = DEFAULT_FEATURES;
let featureById = new Map(liveFeatures.map(f => [f.id, f]));

/** All features currently in effect (default or YAML-loaded), in author order. */
export function getAllFeatures(): GameFeature[] {
  return liveFeatures;
}

export function getFeature(id: string): GameFeature | undefined {
  return featureById.get(id);
}

/** Every feature whose unlock level is exactly this level number. */
export function featuresUnlockedAtLevel(level: number): GameFeature[] {
  return liveFeatures.filter(f => f.unlockLevel === level);
}

/**
 * Carry players forward from the pre-feature-system unlock flags so nobody
 * loses access they already earned. Today: the old `loadoutsIntroduced`
 * first-win flag maps to the 'loadouts' feature. Returns a new array (never
 * mutates the input) with any legacy grants merged in.
 */
export function seedLegacyFeatureUnlocks(ids: string[], loadoutsIntroduced: boolean): string[] {
  if (loadoutsIntroduced && !ids.includes("loadouts")) return [...ids, "loadouts"];
  return ids;
}

/**
 * Re-fetch the feature catalogue from the SERVED public/features.yml. Returns
 * true on success; on any failure the build-time catalogue stays in effect.
 */
export async function loadFeatures(): Promise<boolean> {
  try {
    const response = await fetch("/features.yml", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load features.yml: ${response.status}`);
    const parsed = parseCatalogue(await response.text());
    if (parsed.length === 0) throw new Error("features.yml contained no valid features");
    liveFeatures = parsed;
    featureById = new Map(parsed.map(f => [f.id, f]));
    return true;
  } catch (err) {
    console.warn("[features] Keeping the build-time catalogue:", err);
    return false;
  }
}
