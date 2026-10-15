/**
 * Canvas text is rasterised once, with whatever font is loaded at that moment,
 * and is not redrawn when a web font arrives later. So the interface waits for
 * its four faces before its first frame. The tap-to-start gate is in front of
 * it anyway, so this costs nothing a player sees.
 */
import { setScriptFontLoader } from "@/i18n";

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

/**
 * The Bangla face (src/index.css). Its @font-face has a unicode-range, so a
 * plain `load()` of the family would fetch nothing: a Bengali sample text is
 * passed so the browser fetches the files a Bengali glyph needs.
 */
const BENGALI_FACES = [400, 500, 600, 700].map(w => `${w} 16px 'Noto Sans Bengali'`);
const BENGALI_SAMPLE = "অআকখ";

let bengali: Promise<void> | null = null;

/**
 * Load the Bangla face. Called before the interface first draws when the game
 * starts in Bangla, and before switching to it, because canvas text is
 * rasterised once: a label drawn before the face arrived would keep the
 * system fallback until its text changed.
 */
export function loadBengaliFonts(): Promise<void> {
  if (bengali) return bengali;
  if (typeof document === "undefined" || !document.fonts?.load) return (bengali = Promise.resolve());
  const timeout = new Promise<void>(r => setTimeout(r, 2500));
  bengali = Promise.race([
    Promise.all(BENGALI_FACES.map(f => document.fonts.load(f, BENGALI_SAMPLE).catch(() => []))).then(() => undefined),
    timeout,
  ]);
  return bengali;
}

export function loadUiFonts(language?: string): Promise<void> {
  if (ready) return ready;
  if (typeof document === "undefined" || !document.fonts?.load) return (ready = Promise.resolve());
  // A face that fails to load must not hold the interface hostage: the
  // fallback family is set on every style.
  const timeout = new Promise<void>(r => setTimeout(r, 2500));
  ready = Promise.race([
    Promise.all([
      ...FACES.map(f => document.fonts.load(f).catch(() => [])),
      ...(language === "bn" ? [loadBengaliFonts()] : []),
    ]).then(() => undefined),
    timeout,
  ]);
  return ready;
}

// Switching to Bangla waits for its face (see changeLanguage).
setScriptFontLoader(lang => (lang === "bn" ? loadBengaliFonts() : Promise.resolve()));
