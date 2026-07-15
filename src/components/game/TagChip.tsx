/**
 * TagChip — the archetype-tag pill used everywhere a build is displayed:
 * shop cards, the build readout (shop header + bottom bar), the capstone
 * draft and the end-of-run recap. One source for the tag colour treatment.
 */
import { useTranslation } from 'react-i18next';
import { TAG_COLORS, UpgradeTag } from '@/types/upgrade';

interface TagChipProps {
  tag: UpgradeTag;
  /** Extra text after the localized tag label (e.g. a count or "2/3"). */
  suffix?: string;
  /** Pill shape + ring, used by the build readout when a set is active. */
  pill?: boolean;
  ringed?: boolean;
  /** Tailwind text-size class; the chip is tiny by default. */
  sizeClass?: string;
}

export function TagChip({ tag, suffix, pill = false, ringed = false, sizeClass = 'text-[9px]' }: TagChipProps) {
  const { t } = useTranslation();
  const tc = TAG_COLORS[tag];
  if (!tc) return null;
  return (
    <span
      className={`px-1.5 py-px ${pill ? 'rounded-full px-2' : 'rounded'} ${sizeClass} font-semibold uppercase tracking-wider ${tc.bg} ${tc.text} ${ringed ? 'ring-1 ring-current' : ''}`}
    >
      {t(`upgradeShop.tags.${tag}`)}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}
