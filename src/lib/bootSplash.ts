/**
 * The boot splash: a plain HTML copy of the startup splash in index.html,
 * painted with the page's first frame so nothing else (the code background,
 * an empty canvas) is ever seen before the splash. The canvas splash
 * (TapToStartGate) calls this once it has been drawn, and the copy fades out
 * over it, identical underneath.
 */
export const BOOT_SPLASH_ID = "boot-splash";
/** Matches the fade in index.html's #boot-splash transition. */
const FADE_MS = 250;

export function dismissBootSplash(doc: Document = document): void {
  const el = doc.getElementById(BOOT_SPLASH_ID);
  if (!el || el.dataset.leaving) {
    return;
  }
  el.dataset.leaving = "1";
  el.style.opacity = "0";
  window.setTimeout(() => el.remove(), FADE_MS + 50);
}
