/**
 * The Manual: mechanics you have met, readable whenever you want.
 *
 * These explanations used to be one-time modals. Each stopped the game to
 * deliver a paragraph, fired exactly once, and was then unreachable forever - so
 * a player who tapped through it, or came back a week later, had no way to get it
 * back. That is also why the modals felt so numerous: every mechanic needed its
 * own interruption, because an interruption was the only delivery it had.
 *
 * Now the first encounter files the entry here and badges the Specs button. The
 * player learns something new exists without losing the frame they were in, and
 * chooses when to read it. Discovery instead of interruption.
 *
 * The copy is unchanged - these reuse the same i18n keys the modals used - so
 * this moves WHERE an explanation lives, not what it says.
 *
 * Deliberately NOT moved: anything that can lose you the map if you meet it
 * unwarned (Scope Creep, the time limit, a boss), and the interactive fence
 * tutorial, which teaches by doing and is not a paragraph at all.
 */

const MET_KEY = 'devend:manualMet';
const UNREAD_KEY = 'devend:manualUnread';

/** A mechanic the player has met. Order is the order they appear in the panel. */
export interface ManualEntry {
  id: string;
  titleKey: string;
  bodyKey: string;
  /** Accent for the entry's marker, matching the modal it replaced. */
  color: string;
}

export const MANUAL_ENTRIES: ManualEntry[] = [
  { id: 'topBar', titleKey: 'game.topBarTutorialTitle', bodyKey: 'game.topBarTutorialBody', color: '#00ff88' },
  { id: 'bottomBar', titleKey: 'game.bottomBarTutorialTitle', bodyKey: 'game.bottomBarTutorialBody', color: '#00ff88' },
  { id: 'mover', titleKey: 'game.moverTutorialTitle', bodyKey: 'game.moverTutorialBody', color: '#ff8800' },
  { id: 'break', titleKey: 'game.breakTutorialTitle', bodyKey: 'game.breakTutorialBody', color: '#ffb454' },
  { id: 'circuit', titleKey: 'game.circuitTutorialTitle', bodyKey: 'game.circuitTutorialBody', color: '#7fe3d4' },
  { id: 'pickup', titleKey: 'game.pickupTutorialTitle', bodyKey: 'game.pickupTutorialBody', color: '#e879f9' },
  { id: 'gravityWell', titleKey: 'game.gravityWellTutorialTitle', bodyKey: 'game.gravityWellTutorialBody', color: '#ffa23c' },
];

const byId = new Map(MANUAL_ENTRIES.map(e => [e.id, e] as const));

/**
 * Two sets, and the distinction matters: MET is permanent (the manual keeps every
 * mechanic you have ever encountered, which is the whole point of moving these
 * out of one-shot modals), while UNREAD only drives the badge and clears the
 * moment the panel is opened. Collapsing them would empty the manual on first
 * read - the exact failure the old modals had.
 */
let met: Set<string> | null = null;
let unread: Set<string> | null = null;

function read(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string' && byId.has(i)) : []);
  } catch {
    return new Set(); // blocked storage must never break the HUD
  }
}

function write(key: string, set: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* blocked storage */ }
}

function loadMet(): Set<string> { return (met ??= read(MET_KEY)); }
function loadUnread(): Set<string> { return (unread ??= read(UNREAD_KEY)); }

/** File a newly met mechanic. Unknown ids are ignored rather than stored. */
export function fileManualEntry(id: string): void {
  if (!byId.has(id)) return;
  const m = loadMet();
  if (!m.has(id)) { m.add(id); write(MET_KEY, m); }
  const u = loadUnread();
  if (!u.has(id)) { u.add(id); write(UNREAD_KEY, u); }
}

/** Has this mechanic ever been met? Drives what the manual lists. */
export function hasMetManualEntry(id: string): boolean {
  return loadMet().has(id);
}

export function unreadManualCount(): number {
  return loadUnread().size;
}

/** Called when the panel is opened: the badge has done its job. */
export function markManualRead(): void {
  const u = loadUnread();
  if (u.size === 0) return;
  u.clear();
  write(UNREAD_KEY, u);
}

/** Test seam: forget the caches so fresh localStorage values are read. */
export function resetManualCache(): void {
  met = null;
  unread = null;
}
