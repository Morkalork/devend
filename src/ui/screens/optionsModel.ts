/**
 * The Options screen's small rules as pure functions (canvas port of
 * components/game/OptionsScreen.tsx).
 */
import { supportedLanguages, type SupportedLanguage } from "@/i18n";

/**
 * The language the selector shows as active: i18n's resolved language when it
 * is one we ship, English otherwise.
 */
export function activeLanguageOf(resolvedLanguage: string | undefined, language: string): SupportedLanguage {
  const resolved = resolvedLanguage ?? language;
  return (supportedLanguages as readonly string[]).includes(resolved)
    ? (resolved as SupportedLanguage)
    : "en";
}

/** A slider's value at `x` px along a track `width` px wide: 0..1 in 0.01 steps, like the range input. */
export function sliderValueAt(x: number, width: number): number {
  if (!(width > 0)) return 0;
  const f = Math.max(0, Math.min(1, x / width));
  return Math.round(f * 100) / 100;
}

/** The percentage beside a volume slider. */
export function volumePercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}
