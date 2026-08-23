/**
 * Undo/redo for the map builder: a bounded past, a present, and a future.
 *
 * Kept as a pure module rather than a hook so the awkward parts are testable
 * without a canvas. The awkward parts are not the stack, they are the two
 * questions every editor history has to answer and usually gets wrong:
 *
 * ── What counts as one action? ─────────────────────────────────────────────
 *
 * Dragging a wall fires an update on every pointer move, sixty a second. With
 * ten slots, a one-second drag would push the entire history out and undo would
 * step backwards through single pixels. So a push carries a `key` naming what
 * is being edited ("entity:wall-3"), and consecutive pushes with the same key
 * inside `coalesceMs` REPLACE the present instead of stacking on it. A drag is
 * one entry, typing into a number field is one entry, and undo steps by
 * something a person would recognise as a thing they did.
 *
 * A push with no key never coalesces, which is what structural edits want:
 * adding, deleting or duplicating is always its own step even if you do three
 * of them in a second.
 *
 * ── What happens to the future? ────────────────────────────────────────────
 *
 * Editing after an undo discards the redo stack, the same as every editor. The
 * alternative is a branching history nobody asked for and no UI to show it.
 */

/** How many actions the past holds. Older entries fall off the bottom. */
export const HISTORY_LIMIT = 10;

/** Consecutive edits to the same target inside this window are one action. */
export const COALESCE_MS = 700;

export interface History<T> {
  /** Older states, oldest first. At most HISTORY_LIMIT of them. */
  past: T[];
  present: T;
  /** States undone away, nearest-first, so redo takes future[0]. */
  future: T[];
  /** What the present edit was to, for coalescing. Null after undo/redo. */
  lastKey: string | null;
  /** When the present edit landed, in ms. */
  lastAt: number;
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export interface PushOptions {
  /**
   * What is being edited, e.g. "entity:wall-3". Consecutive pushes with the
   * same key inside `coalesceMs` merge into one action. Omit for structural
   * edits, which should always be their own step.
   */
  key?: string;
  /** Now, in ms. Injectable so tests do not depend on wall-clock timing. */
  at?: number;
  coalesceMs?: number;
  limit?: number;
}

/**
 * Record a new state.
 *
 * Coalescing overwrites the present and leaves the past alone, so a drag that
 * ran for a thousand frames costs exactly one slot and undoing it returns to
 * where the object was before the drag started, not to the previous frame of
 * it.
 */
export function pushHistory<T>(history: History<T>, next: T, options: PushOptions = {}): History<T> {
  const { key, at = Date.now(), coalesceMs = COALESCE_MS, limit = HISTORY_LIMIT } = options;

  const merges =
    key !== undefined &&
    key === history.lastKey &&
    at - history.lastAt <= coalesceMs;

  if (merges) {
    // Same action still in progress: swap the present, keep the past intact.
    return { ...history, present: next, lastAt: at, future: [] };
  }

  const past = [...history.past, history.present];
  return {
    // Drop from the FRONT, so the ten most recent actions are the ones kept.
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
    lastKey: key ?? null,
    lastAt: at,
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/**
 * Step back one action.
 *
 * Clears `lastKey`, so the next edit always starts a fresh entry rather than
 * coalescing into whatever the undo just restored. Without that, undoing a drag
 * and immediately dragging again would silently overwrite the state you had
 * just stepped back to, and the undo would look like it had not worked.
 */
export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const present = history.past[history.past.length - 1];
  return {
    past,
    present,
    future: [history.present, ...history.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [present, ...future] = history.future;
  return {
    past: [...history.past, history.present],
    present,
    future,
    lastKey: null,
    lastAt: 0,
  };
}

/**
 * Throw the history away and start again from `present`.
 *
 * For loading a file: the state before a load is not something anyone wants to
 * undo back into, and offering it would let one Ctrl+Z replace the file you
 * just opened with the one you had open before it.
 */
export function resetHistory<T>(present: T): History<T> {
  return createHistory(present);
}

/** Which keyboard gesture, if any, an event is. Undo is Ctrl/Cmd+Z, redo is
 *  Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y (Windows editors use both). */
export function historyGesture(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">,
): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}
