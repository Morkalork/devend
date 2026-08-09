/**
 * Human-readable labels for certificate effects.
 *
 * certificates.yml stores effects as raw `{ type, value }` pairs, so the store
 * could only ever show flavour text and a price: "Perpetually reduced ball
 * speeds" next to "Lv 2 (5h)". That asks the player to spend a scarce currency
 * without telling them what they get. This turns the pair into "Ball speed -5%".
 *
 * Upgrades and achievements don't need this - they carry an authored
 * `description` per entry - but a certificate's levels share one description
 * between them, so the per-level delta has nowhere else to come from.
 *
 * An unrecognised type returns '' rather than a guess: the card falls back to
 * its description, which is wrong-looking but never WRONG.
 */
import type { TFunction } from 'i18next';
import type { CertEffect } from '@/types/certificate';
import { MULTIPLICATIVE_KEYS, type GameModifiers } from '@/hooks/useActiveModifiers';

/** `1.05` -> `+5`, `0.93` -> `-7`. Rounded: 0.93 - 1 is -0.07000000000000006. */
function pctDelta(value: number): number {
  return Math.round((value - 1) * 1000) / 10;
}

/** `0.01` -> `-1` for the "per something" rates, which are always reductions. */
function ratePct(value: number): number {
  return Math.round(value * 1000) / 10;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/**
 * Types whose value is not a plain delta and so cannot be formatted generically.
 * Everything else falls through to the multiplicative/additive split below.
 */
type SpecialFormatter = (t: TFunction, value: number) => string;

const SPECIAL: Partial<Record<string, SpecialFormatter>> = {
  // Absolute, not additive: Index.tsx takes the max across owned head-starts.
  startingLevelBonus: (t, v) => t('certificateEffects.startingLevelBonus', { level: v }),
  startingCapturePercent: (t, v) => t('certificateEffects.startingCapturePercent', { percent: v }),
  extraCertificateHours: (t, v) => t('certificateEffects.extraCertificateHours', { hours: v }),
  // Conditional rates: the value is a per-unit reduction, not a flat one.
  bankedSlowPer50h: (t, v) => t('certificateEffects.bankedSlowPer50h', { percent: signed(-ratePct(v)) }),
  microManagerPerLock: (t, v) => t('certificateEffects.microManagerPerLock', { percent: signed(-ratePct(v)) }),
  // A toggle, so a signed number would be meaningless.
  showHighscoreProgress: t => t('certificateEffects.showHighscoreProgress'),
};

/** Additive effects, keyed to a noun the count reads naturally against. */
const ADDITIVE_KEYS = new Set([
  'extraLives',
  'instantFencesPerMap',
  'additionalConcurrentFences',
  'ballPathPredictionBounces',
]);

export function certEffectLabel(t: TFunction, effect: CertEffect): string {
  const special = SPECIAL[effect.type];
  if (special) return special(t, effect.value);

  if (MULTIPLICATIVE_KEYS.includes(effect.type as keyof GameModifiers)) {
    const delta = pctDelta(effect.value);
    if (delta === 0) return '';
    return t(`certificateEffects.${effect.type}`, {
      percent: signed(delta),
      defaultValue: '',
    }) as string;
  }

  // Phrased "<stat> +1", never "+1 life", so no label needs pluralising.
  if (ADDITIVE_KEYS.has(effect.type)) {
    return t(`certificateEffects.${effect.type}`, {
      value: signed(effect.value),
      defaultValue: '',
    }) as string;
  }

  return '';
}
