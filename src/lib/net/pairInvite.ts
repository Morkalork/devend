/**
 * The pairing invitation this page was opened with, captured once at startup.
 *
 * The guest arrives on `/#pair=...` from the host's QR. Nothing routed that
 * link: the app opens on the welcome screen, and the only reader of the
 * fragment was the 2-Player screen, which is not mounted until somebody taps
 * 2-Player. So the second phone opened the normal game and the host waited on
 * its QR for ever.
 *
 * It is also not safe to read late. The Android back guard pushes a history
 * entry with an empty URL on mount, and under the WHATWG URL rules an empty
 * URL resolves to the page without its fragment.
 *
 * So the invitation is read here, at module load, before React renders and
 * before any effect can rewrite the URL. The fragment is cleared at the same
 * moment, so a refresh does not try to answer an offer that has been spent.
 * The navigation starts on the 2-Player screen when one is waiting, and the
 * lobby takes it from here.
 */
import { parsePairUrl, type PairLink } from "@/lib/net/sdp";

let pending: PairLink | null = null;

/** Read the invitation out of the current URL and clear it from the address bar. */
export function capturePairInvite(win: Window = window): PairLink | null {
  const link = parsePairUrl(win.location.hash);
  if (!link) {
    return null;
  }
  try {
    win.history.replaceState(win.history.state, "", win.location.pathname + win.location.search);
  } catch {
    // No history API (an embedded webview): the fragment is harmless if it lingers.
  }
  pending = link;
  return link;
}

/** Whether the page was opened on a pairing link that has not been answered yet. */
export function hasPairInvite(): boolean {
  return pending !== null;
}

/** Hand the invitation over, once. Later calls get null. */
export function takePairInvite(): PairLink | null {
  const link = pending;
  pending = null;
  return link;
}

if (typeof window !== "undefined") {
  capturePairInvite();
}
