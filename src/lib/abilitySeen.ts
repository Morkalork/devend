/**
 * Tracks which ability info modals the player has already been shown (issue #38),
 * so each ability's explainer auto-opens exactly once - the first time it is
 * acquired. Persisted in localStorage; a small self-contained UI concern.
 */
const KEY = "devend:abilitiesSeen";

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

export function hasSeenAbility(id: string): boolean {
  return load().has(id);
}

export function markAbilitySeen(id: string): void {
  try {
    const seen = load();
    if (seen.has(id)) return;
    seen.add(id);
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore storage failures */
  }
}
