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
const KEY = "devend:fenceTypesSeen";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
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
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore storage failures */
  }
}
