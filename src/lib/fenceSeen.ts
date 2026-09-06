/**
 * Which fence-type explainers the player has already been shown, so each one
 * auto-opens exactly once - the first time it is acquired.
 *
 * A separate key from abilitySeen rather than a shared "things seen" store: the
 * two catalogues have independent ids, and a fence type sharing an id with an
 * ability (nothing stops `slowArea` being both one day) would suppress the
 * other's explainer for a reason nobody could find.
 *
 * Persisted in localStorage, and every access is wrapped: a private window, a
 * cleared store or a browser blocking site data must cost the player a repeated
 * explainer, never a crash on the path that draws the bar.
 */
/**
 * Exported so "Re-enable All Tutorials" can clear it. A one-time explainer
 * whose key only that file knows is a tutorial the reset button silently
 * skips, which is exactly how the circuit explainer became unrecoverable.
 */
export const FENCE_TYPES_SEEN_KEY = "devend:fenceTypesSeen";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(FENCE_TYPES_SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function hasSeenFenceType(id: string): boolean {
  return load().has(id);
}

export function markFenceTypeSeen(id: string): void {
  try {
    const seen = load();
    if (seen.has(id)) return;
    seen.add(id);
    localStorage.setItem(FENCE_TYPES_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore storage failures */
  }
}

/**
 * Whether the player has been shown how the SLOT BAR works, once ever.
 *
 * A separate one-shot from the per-type explainers above, because it answers a
 * different question. A type's card says what that fence does; nothing said
 * that the bar is a chooser at all, so the first special arrived and the
 * player was told about a fence without being told they now had to pick
 * between fences. The card's own footer mentions it in a line at the bottom,
 * which is where a reader who already knows looks and a reader who does not
 * never does.
 */
export const FENCE_SWITCHING_SEEN_KEY = "devend:fenceSwitchingSeen";

export function hasSeenFenceSwitching(): boolean {
  try {
    return localStorage.getItem(FENCE_SWITCHING_SEEN_KEY) === "1";
  } catch {
    // Blocked storage costs a repeated explainer, never a crash on the path
    // that draws the bar.
    return false;
  }
}

export function markFenceSwitchingSeen(): void {
  try {
    localStorage.setItem(FENCE_SWITCHING_SEEN_KEY, "1");
  } catch {
    /* ignore storage failures */
  }
}
