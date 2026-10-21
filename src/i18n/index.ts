/**
 * i18n setup (react-i18next).
 *
 * All user-visible UI text lives in the locale files under `locales/`.
 * English (`en`) is the source-of-truth language; add a new language by
 * dropping a `<lang>.json` next to `en.json` (same key structure) and
 * registering it in `resources` below.
 *
 * Components read strings with the `useTranslation` hook:
 *
 *     const { t } = useTranslation();
 *     <button>{t('welcome.startGame')}</button>
 *
 * Interpolated values use the `{{name}}` placeholder syntax:
 *
 *     t('topBar.percentToGo', { percent: 20 })   // "20% to go"
 *
 * Import this module once, for its side effect, before the app renders
 * (see src/main.tsx).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

export const defaultNS = 'translation';

/**
 * English is bundled: it is the fallback for any key a translation lacks,
 * and the language most players start in. Every other language is its own
 * chunk, fetched when it is first needed (loadLanguage). All four used to ship
 * in the main bundle, 567KB of text of which a player reads one language's
 * worth; Bangla alone was 223KB.
 */
export const resources = {
  en: { translation: en },
} as const;

const loaders = import.meta.glob<{ default: Record<string, unknown> }>(['./locales/*.json', '!./locales/en.json']);

/** Languages the app ships translations for. */
export const supportedLanguages = ['en', 'sv', 'es', 'bn'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

/** Endonyms shown in the language picker (each in its own language). */
export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  sv: 'Svenska',
  es: 'Español',
  bn: 'বাংলা',
};

/** localStorage key holding the player's explicit language choice. */
export const LANGUAGE_STORAGE_KEY = 'jezzball_language';

function isSupported(lang: string): lang is SupportedLanguage {
  return (supportedLanguages as readonly string[]).includes(lang);
}

/**
 * Pick a starting language: an explicit saved choice wins, otherwise fall
 * back to the device language, otherwise English.
 */
function detectInitialLanguage(): SupportedLanguage {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && isSupported(saved)) return saved;
  } catch {
    /* localStorage unavailable (private mode / SSR) — ignore */
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.split('-')[0];
    if (isSupported(lang)) return lang;
  }
  return 'en';
}

/**
 * Languages whose script none of the bundled Latin faces covers, and the
 * loader for the face that does (src/ui/fonts.ts). Registered by the
 * interface so this module stays free of it.
 */
let scriptFontLoader: ((lang: SupportedLanguage) => Promise<void>) | null = null;
export function setScriptFontLoader(load: ((lang: SupportedLanguage) => Promise<void>) | null): void {
  scriptFontLoader = load;
}

/**
 * Fetch a language's strings, once. English is always there. A failed fetch
 * (offline, a deploy replaced the chunk) leaves the language unloaded, and
 * i18next shows English for it rather than keys.
 */
export async function loadLanguage(lang: SupportedLanguage): Promise<void> {
  if (lang === 'en' || i18n.hasResourceBundle(lang, defaultNS)) return;
  const load = loaders[`./locales/${lang}.json`];
  if (!load) return;
  try {
    const mod = await load();
    i18n.addResourceBundle(lang, defaultNS, mod.default, true, true);
  } catch {
    /* stays on English for this language */
  }
}

/** Every language, for the tests and the screen gallery's language switch. */
export async function loadAllLanguages(): Promise<void> {
  await Promise.all(supportedLanguages.map(loadLanguage));
}

/**
 * Switch the active language and persist the choice for next launch. The
 * strings are fetched first, and Bangla waits for its face too: canvas text
 * is rasterised once, and a label drawn before the face arrived would keep
 * the system fallback.
 */
export async function changeLanguage(lang: SupportedLanguage): Promise<unknown> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* localStorage unavailable — language still changes for this session */
  }
  await loadLanguage(lang);
  if (scriptFontLoader) await scriptFontLoader(lang).catch(() => undefined);
  return i18n.changeLanguage(lang);
}

/** The document's language, for the browser's own text shaping and font picks. */
function syncHtmlLang(lang: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

const initialLanguage = detectInitialLanguage();

i18n.use(initReactI18next).init({
  resources,
  // English until the player's own language has arrived (i18nReady).
  lng: 'en',
  fallbackLng: 'en',
  defaultNS,
  interpolation: {
    escapeValue: false, // React already escapes against XSS
  },
  returnNull: false,
});

syncHtmlLang(i18n.language);
i18n.on('languageChanged', syncHtmlLang);

/**
 * Settles once the player's starting language is loaded and active. The app
 * renders after it (main.tsx), so the first frame is already in the right
 * language; the HTML splash covers the wait.
 */
export const i18nReady: Promise<void> = initialLanguage === 'en'
  ? Promise.resolve()
  : loadLanguage(initialLanguage).then(() => i18n.changeLanguage(initialLanguage)).then(() => undefined);

export default i18n;
