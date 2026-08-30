/**
 * Persisting the run from outside React.
 *
 * The run is written once per MAP ENTRY, which is the right granularity for
 * the map itself: being killed mid-map costs that map, not the session, and a
 * roguelike resuming you at the start of the map you were on is normal.
 *
 * The gap is everything BETWEEN maps. Upgrades bought, a draft taken, an
 * assignment accepted - none of it reaches disk until the next map begins. On a
 * phone that window is very reachable: you clear a map, open the shop, get
 * distracted, the OS reclaims the tab, and you come back to the map's start
 * with the purchases gone. From the player's side the game took their overtime
 * and gave them nothing.
 *
 * So the current snapshot is registered here, and flushed when the page is
 * being hidden or torn down - and by the error boundary, before it offers a way
 * out of a crash.
 */

/** Writes the current run to storage. Registered by the session hook. */
type Flush = () => void;

let current: Flush | null = null;

/**
 * Latched by a Total Reset, after which no flush ever writes again.
 *
 * A reset clears storage and reloads, and the reload fires `pagehide` - which
 * is one of the listeners below, so the run being wiped was written straight
 * back into the storage that had just been cleared. The player asked for a
 * clean install, the page came back, and their run was waiting for them.
 *
 * A latch rather than `registerRunFlush(null)`: the session hook re-registers
 * on its own schedule, so a null would be quietly undone by any render between
 * the reset and the reload actually happening.
 */
let disabled = false;

/**
 * Register (or clear, with null) the function that persists the live run.
 *
 * A single slot rather than a list: there is exactly one run, and letting two
 * registrations coexist would mean the older one silently writing stale state
 * over the newer one at teardown.
 */
export function registerRunFlush(flush: Flush | null): void {
  current = flush;
}

/**
 * Stop persisting the run, permanently, for a Total Reset.
 *
 * There is no re-enable: the only caller is about to reload the page, which
 * resets this module along with everything else.
 */
export function disableRunFlush(): void {
  disabled = true;
  current = null;
}

/**
 * Persist the run now, if there is one.
 *
 * Never throws. Every caller is a last-chance path - a page being torn down, or
 * an error boundary already handling a crash - and a save that threw there
 * would turn one failure into a worse one.
 */
export function flushRunSave(): void {
  if (disabled) return;
  try {
    current?.();
  } catch (err) {
    console.error('[runSave] flush failed', err);
  }
}

/**
 * Flush whenever the page is hidden or going away.
 *
 * `visibilitychange` to hidden is the one that fires reliably when a phone
 * locks or the player switches app, and it is the case that actually loses
 * work. `pagehide` covers a real navigation away. `beforeunload` is
 * deliberately not used: it is unreliable on mobile and browsers increasingly
 * ignore it for anything but a confirmation prompt.
 */
export function installRunFlushListeners(): () => void {
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushRunSave();
  };
  const onPageHide = () => flushRunSave();

  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
  };
}
