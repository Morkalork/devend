/**
 * The startup splash as plain HTML (index.html's #boot-splash), painted with
 * the page's first frame, before any script, font or background has loaded.
 *
 * It is the only splash anyone sees, from the first frame to the last. The
 * canvas splash (TapToStartGate) runs underneath it: it decides what the label
 * says and takes the tap, and dismisses this one when it is done. It used to
 * hand over instead, the canvas drawing its own copy of the logo and this one
 * fading out over it, and the two renderings of the logo never landed on
 * exactly the same pixel (browser and canvas text metrics round differently,
 * 0 to 3px depending on the screen), which read as the logo twitching.
 */
export const BOOT_SPLASH_ID = "boot-splash";
/** Matches the fade in index.html's #boot-splash transition. */
const FADE_MS = 200;

export type BootSplashMode = "loading" | "tap";

function splash(doc: Document): HTMLElement | null {
  const el = doc.getElementById(BOOT_SPLASH_ID);
  return el && !el.dataset.leaving ? el : null;
}

/**
 * The canvas splash takes the HTML one over, so index.html's backstop timer
 * leaves it alone. False when there is none (it was already dismissed, or the
 * page is the Admin preview).
 */
export function takeOverBootSplash(doc: Document = document): boolean {
  const el = splash(doc);
  if (!el) {
    return false;
  }
  el.dataset.owned = "1";
  return true;
}

/** What the label says, and whether it is the breathing prompt. */
export function setBootSplashLabel(text: string, mode: BootSplashMode, accent?: string, doc: Document = document): void {
  const el = splash(doc);
  const label = el?.querySelector<HTMLElement>(".label");
  if (!el || !label) {
    return;
  }
  if (label.textContent !== text) {
    label.textContent = text;
  }
  label.classList.toggle("tap", mode === "tap");
  el.setAttribute("aria-label", text);
  if (accent) {
    el.style.setProperty("--boot-accent", accent);
  }
}

/** Fade the HTML splash out and remove it. Idempotent. */
export function dismissBootSplash(doc: Document = document): void {
  const el = splash(doc);
  if (!el) {
    return;
  }
  el.dataset.leaving = "1";
  el.style.opacity = "0";
  window.setTimeout(() => el.remove(), FADE_MS + 50);
}
