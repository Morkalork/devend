/**
 * Live map tuning (admin only).
 *
 * The Playground can already edit a map's numbers, but only from outside a run:
 * you pick a level cold, guess, and restart. The useful moment for judging par
 * is the one where you have just cleared the map and can feel that it took five
 * cuts and not eight. This lets you tune the CURRENT map from inside a normal
 * run and keep playing.
 *
 * Overrides are keyed by level id, persisted, and applied to the level object
 * itself, so every consumer (win check, HUD, scoring, level-complete overlay)
 * picks them up without knowing this module exists. `expectedCuts` and
 * `sizeThreshold` are both read at check time rather than captured at map init,
 * so both take effect immediately, mid-map.
 *
 * A tuned run is not a real run: like the ?level= jump and the infinite-lives
 * flag, it is marked ledger-ineligible so highscores never learn from it.
 */
import type { LevelConfig } from "@/types/level";

const TUNING_KEY = "devend:mapTuning";

/** The tunable subset of a level. Ball roster / speeds slot in here next. */
export interface MapTuning {
  /** Par: fences a clean solve should take (LevelConfig.expectedCuts). */
  expectedCuts?: number;
  /** Clear threshold: % of the board that may remain (LevelConfig.sizeThreshold). */
  sizeThreshold?: number;
}

export const TUNABLE_FIELDS = ["expectedCuts", "sizeThreshold"] as const;

type TuningStore = Record<string, MapTuning>;

let store: TuningStore | null = null;
/** Bumped on every write so React can memoise the derived level safely. */
let version = 0;

function load(): TuningStore {
  if (store) return store;
  try {
    const raw = localStorage.getItem(TUNING_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    store = parsed && typeof parsed === "object" ? (parsed as TuningStore) : {};
  } catch {
    store = {}; // storage blocked or corrupt JSON: tune in memory for this session
  }
  return store;
}

const listeners = new Set<() => void>();

function persist(): void {
  version++;
  try {
    localStorage.setItem(TUNING_KEY, JSON.stringify(store ?? {}));
  } catch {
    /* storage blocked: the in-memory store still holds for this session */
  }
  for (const fn of listeners) fn();
}

/** Subscribe to tuning changes (useSyncExternalStore). Returns an unsubscribe. */
export function subscribeMapTuning(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Changes counter, so a memo can depend on "has anything been tuned since?". */
export function mapTuningVersion(): number {
  return version;
}

export function getMapTuning(levelId: string): MapTuning {
  return load()[levelId] ?? {};
}

/** Merge a patch into a map's overrides. An `undefined` value clears that field. */
export function setMapTuning(levelId: string, patch: MapTuning): void {
  const s = load();
  const next: MapTuning = { ...s[levelId], ...patch };
  for (const key of TUNABLE_FIELDS) {
    if (next[key] === undefined) delete next[key];
  }
  if (Object.keys(next).length === 0) delete s[levelId];
  else s[levelId] = next;
  persist();
}

export function clearMapTuning(levelId: string): void {
  const s = load();
  delete s[levelId];
  persist();
}

export function clearAllMapTuning(): void {
  store = {};
  persist();
}

/** True when ANY map has been tuned: the run must not file on the ledger. */
export function hasAnyMapTuning(): boolean {
  return Object.keys(load()).length > 0;
}

/** True when this specific map is currently overridden (drives the "TUNED" badge). */
export function isMapTuned(levelId: string): boolean {
  return Object.keys(getMapTuning(levelId)).length > 0;
}

/**
 * Authored values, captured the first time each level object is seen, before
 * any override is written onto it. Needed both to show "was N" in the tuner and
 * to restore a field when its override is cleared.
 */
const baselines = new Map<string, Required<MapTuning>>();

/** The map's authored values, or null if this level has not been seen yet. */
export function authoredBaseline(levelId: string): Required<MapTuning> | null {
  return baselines.get(levelId) ?? null;
}

/** Drop the captured baselines, so a fresh map.yml load re-captures them. */
export function resetMapTuningBaselines(): void {
  baselines.clear();
}

/**
 * Apply this map's overrides to the level the game plays, IN PLACE, and return
 * the same object.
 *
 * Mutating looks wrong until you follow the identity: GameCanvas re-inits the
 * entire game whenever the `level` prop changes identity, so returning a copy
 * would reset the board on every tweak. Neither tunable field is read by
 * createInitialGameData (both are read at check time, per cut and at
 * completion), so that reset would be pure loss: the same board, rebuilt, with
 * the player's progress on it thrown away. Keeping one object means a par
 * change lands on the map in progress, which is the entire point of tuning from
 * inside a run. Re-renders are driven by the subscription instead.
 */
export function applyMapTuning(level: LevelConfig | null): LevelConfig | null {
  if (!level) return level;

  if (!baselines.has(level.id)) {
    baselines.set(level.id, {
      expectedCuts: level.expectedCuts,
      sizeThreshold: level.sizeThreshold,
    });
  }
  const authored = baselines.get(level.id)!;
  const tuning = getMapTuning(level.id);

  // Always write both fields: a cleared override has to restore the authored
  // value on an object that may still be carrying the last one.
  level.expectedCuts = tuning.expectedCuts ?? authored.expectedCuts;
  level.sizeThreshold = tuning.sizeThreshold ?? authored.sizeThreshold;
  return level;
}

/** The overridden fields as YAML lines, for pasting into public/map.yml. */
export function tuningAsYaml(levelId: string): string {
  const tuning = getMapTuning(levelId);
  return TUNABLE_FIELDS
    .filter(k => tuning[k] !== undefined)
    .map(k => `    ${k}: ${tuning[k]}`)
    .join("\n");
}

/** Test seam: drop the memoised store so a test can start from clean storage. */
export function resetMapTuningCache(): void {
  store = null;
  baselines.clear();
}
