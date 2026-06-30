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
import sv from './locales/sv.json';
import es from './locales/es.json';

export const defaultNS = 'translation';

export const resources = {
  en: { translation: en },
  sv: { translation: sv },
  es: { translation: es },
} as const;

/** Languages the app ships translations for. */
export const supportedLanguages = ['en', 'sv', 'es'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

/** Endonyms shown in the language picker (each in its own language). */
export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  sv: 'Svenska',
  es: 'Español',
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

/** Switch the active language and persist the choice for next launch. */
export function changeLanguage(lang: SupportedLanguage): Promise<unknown> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* localStorage unavailable — language still changes for this session */
  }
  return i18n.changeLanguage(lang);
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  defaultNS,
  interpolation: {
    escapeValue: false, // React already escapes against XSS
  },
  returnNull: false,
});

export default i18n;
