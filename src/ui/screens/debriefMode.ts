/**
 * Which Debrief the between-map pipeline opens with.
 *
 * The ticket (the default, being tried): the map's Acceptance Criteria card,
 * the one shown before the map, with each row marked met or missed, and
 * nothing else but the hours and the rare notices. The full one (the
 * breakdown, the axes, the totals) is kept whole behind this switch, so it can
 * be compared in Admin and brought back without rebuilding it.
 *
 * A display preference, not a run flag: it changes nothing about play, so it
 * lives here rather than in lib/devFlags (whose flags keep a run off the
 * ledger).
 */
const KEY = "devend:debrief:full";

let full: boolean | null = null;

export function isFullDebrief(): boolean {
  if (full === null) {
    try { full = localStorage.getItem(KEY) === "1"; } catch { full = false; }
  }
  return full;
}

export function setFullDebrief(on: boolean): void {
  full = on;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the in-memory value still holds for this session */
  }
}
