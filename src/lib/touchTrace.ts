/**
 * Touch trace: what the board did with each touch, written where a tester can
 * read it (Admin switch, persisted; drawn by ui/game/TouchTraceOverlay).
 *
 * Reported as "she drew a perfect fence and it got ignored, nothing
 * happened". The input layer has a dozen ways to decline a touch, several of
 * them on purpose, and on somebody else's phone none of them can be seen: no
 * console, no breakpoints, only a fence that did not appear. With the switch
 * on, every decision useGameInput makes about a pointer is a line here, so the
 * next "nothing happened" comes with the reason attached.
 *
 * Costs nothing while off: traceTouch returns before building anything, and
 * callers pass a closure so the line itself is never formatted.
 */

const TOUCH_TRACE_KEY = "devend:touchTrace";
/** Lines kept: enough for one gesture and the one before it. */
export const TOUCH_TRACE_LINES = 8;

let enabled: boolean | null = null;
const lines: string[] = [];
let version = 0;

export function isTouchTraceEnabled(): boolean {
  if (enabled === null) {
    try { enabled = localStorage.getItem(TOUCH_TRACE_KEY) === "1"; } catch { enabled = false; }
  }
  return enabled;
}

export function setTouchTraceEnabled(on: boolean): void {
  enabled = on;
  if (!on) { lines.length = 0; version++; }
  try {
    if (on) localStorage.setItem(TOUCH_TRACE_KEY, "1");
    else localStorage.removeItem(TOUCH_TRACE_KEY);
  } catch {
    /* storage blocked: the in-memory flag still holds for this session */
  }
}

/** Record one decision. `line` is only called when the trace is on. */
export function traceTouch(line: () => string): void {
  if (!isTouchTraceEnabled()) return;
  const t = (performance.now() / 1000).toFixed(1);
  lines.push(`${t} ${line()}`);
  if (lines.length > TOUCH_TRACE_LINES) lines.shift();
  version++;
}

/** The newest lines, oldest first. */
export function touchTraceLines(): readonly string[] { return lines; }

/** Bumped on every change, so a reader can skip a render when nothing moved. */
export function touchTraceVersion(): number { return version; }

/** Tests: forget the cached flag and the lines. */
export function resetTouchTrace(): void {
  enabled = null;
  lines.length = 0;
  version++;
}
