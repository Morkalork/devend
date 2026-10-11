/**
 * Canvas text is rasterised once, with whatever font is loaded at that moment,
 * and is not redrawn when a web font arrives later. So the interface waits for
 * its four faces before its first frame. The tap-to-start gate is in front of
 * it anyway, so this costs nothing a player sees.
 */
const FACES = [
  "400 16px Michroma",
  "500 16px Oxanium",
  "600 16px Oxanium",
  "700 16px Oxanium",
  "400 16px 'Space Grotesk'",
  "500 16px 'Space Grotesk'",
  "600 16px 'Space Grotesk'",
  "700 16px 'Space Grotesk'",
  "400 16px 'JetBrains Mono'",
  "500 16px 'JetBrains Mono'",
  "700 16px 'JetBrains Mono'",
];

let ready: Promise<void> | null = null;

export function loadUiFonts(): Promise<void> {
  if (ready) return ready;
  if (typeof document === "undefined" || !document.fonts?.load) return (ready = Promise.resolve());
  // A face that fails to load must not hold the interface hostage: the
  // fallback family is set on every style.
  const timeout = new Promise<void>(r => setTimeout(r, 2500));
  ready = Promise.race([
    Promise.all(FACES.map(f => document.fonts.load(f).catch(() => []))).then(() => undefined),
    timeout,
  ]);
  return ready;
}
