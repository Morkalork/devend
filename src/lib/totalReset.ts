/**
 * Total Reset - wipe ALL game state from this device, returning the install to
 * a brand-new state.
 *
 * Rather than enumerate every progression store (certificates, meta stats,
 * unlock state + feature unlocks, achievements, hall of fame + daily, the saved
 * run, checkpoints, tutorials-seen, boss-intro flags, menu highlights, ability
 * info seen, ...), we remove EVERY localStorage entry except a small allowlist
 * of genuine device preferences. That way any state store added later is wiped
 * too, and the dynamic per-map keys (e.g. devend_boss_intro_<id>) go with it.
 *
 * After clearing we reload so every hook re-initialises from the now-empty
 * storage - the reliable way to flush all in-memory React state at once.
 */
import { LANGUAGE_STORAGE_KEY } from '@/i18n';

// Device/app preferences that are NOT game progression. A total reset keeps
// these so the player isn't dropped back into the wrong UI language, a blaring
// volume, or a different renderer. Everything else is game state and is deleted.
const PRESERVED_KEYS = new Set<string>([
  LANGUAGE_STORAGE_KEY, // 'jezzball_language'
  'devend:renderer',
  'devend:musicVolume',
  'devend:sfxVolume',
  'devend:soundMuted',
]);

/**
 * Delete all game state and reload. Preferences in PRESERVED_KEYS survive.
 * Exported separately from the reload so tests can assert the wipe.
 */
export function clearAllGameState(): void {
  try {
    // Object.keys snapshots the keys, so removing during iteration is safe.
    for (const key of Object.keys(localStorage)) {
      if (!PRESERVED_KEYS.has(key)) localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('[totalReset] Failed to clear game state', e);
  }
}

export function performTotalReset(): void {
  clearAllGameState();
  // Reboot so every in-memory store re-initialises from clean storage.
  try {
    window.location.reload();
  } catch {
    /* non-browser env (tests): nothing to reload */
  }
}
