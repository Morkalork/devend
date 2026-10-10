/**
 * The small pills' looks (canvas TagChip and ConditionChip).
 *
 * The tag colours stay in TAG_COLORS (types/upgrade.ts) as Tailwind classes,
 * one source for every place a build is shown, so the canvas reads them out of
 * that table rather than keeping a second, hand-copied one that could drift.
 */
import type { TFunction } from "i18next";
import { TAG_COLORS, type UpgradeTag } from "@/types/upgrade";
import { COLOR, TEXT } from "../theme";

/** Tailwind v3's palette, for the families and shades the game's class tables use. */
const PALETTE: Record<string, Record<number, number>> = {
  emerald: { 300: 0x6ee7b7, 400: 0x34d399, 500: 0x10b981 },
  cyan: { 300: 0x67e8f9, 400: 0x22d3ee, 500: 0x06b6d4 },
  yellow: { 300: 0xfde047, 400: 0xfacc15, 500: 0xeab308 },
  orange: { 300: 0xfdba74, 400: 0xfb923c, 500: 0xf97316 },
  red: { 300: 0xfca5a5, 400: 0xf87171, 500: 0xef4444 },
  blue: { 300: 0x93c5fd, 400: 0x60a5fa, 500: 0x3b82f6 },
  slate: { 300: 0xcbd5e1, 400: 0x94a3b8, 500: 0x64748b },
  purple: { 300: 0xd8b4fe, 400: 0xc084fc, 500: 0xa855f7 },
  amber: { 300: 0xfcd34d, 400: 0xfbbf24, 500: 0xf59e0b },
};

/** `bg-emerald-500/15` or `text-cyan-300` as a colour and an opacity; null if unknown. */
export function twColor(cls: string): { color: number; alpha: number } | null {
  const m = /^(?:bg|text|border|ring)-([a-z]+)-(\d{2,3})(?:\/(\d{1,3}))?$/.exec(cls.trim());
  if (!m) return null;
  const color = PALETTE[m[1]]?.[Number(m[2])];
  if (color === undefined) return null;
  return { color, alpha: m[3] !== undefined ? Number(m[3]) / 100 : 1 };
}

/** A Tailwind text-size class (`text-[9px]`, `text-xs`, ...) in px. */
export function textSizeOfClass(cls: string | undefined, fallback: number): number {
  if (!cls) return fallback;
  const px = /text-\[(\d+(?:\.\d+)?)px\]/.exec(cls);
  if (px) return Number(px[1]);
  const named = /(?:^|\s)text-(xs|sm|base|lg|xl|2xl|3xl|4xl)(?:\s|$)/.exec(cls);
  return named ? TEXT[named[1] as keyof typeof TEXT] : fallback;
}

export interface TagChipLook {
  text: number;
  background: number;
  backgroundAlpha: number;
}

/** A tag's colours, or null for a tag the table does not know (the chip renders nothing). */
export function tagChipLook(tag: UpgradeTag): TagChipLook | null {
  const tc = TAG_COLORS[tag];
  if (!tc) return null;
  const text = twColor(tc.text);
  const bg = twColor(tc.bg);
  if (!text || !bg) return null;
  return { text: text.color, background: bg.color, backgroundAlpha: bg.alpha };
}

export function tagChipText(t: TFunction, tag: UpgradeTag, suffix?: string): string {
  return `${t(`upgradeShop.tags.${tag}`)}${suffix ? ` ${suffix}` : ""}`;
}

export interface ConditionChipLook {
  color: number;
  border: number;
  borderAlpha: number;
  background: number;
  backgroundAlpha: number;
}

/** Live: the success green. Not now: muted, so it reads as information, not an error. */
export function conditionChipLook(live: boolean): ConditionChipLook {
  // The theme's --success is the same hsl(145 100% 53%) as --primary.
  return live
    ? { color: COLOR.primary, border: COLOR.primary, borderAlpha: 0.6, background: COLOR.primary, backgroundAlpha: 0.15 }
    : { color: COLOR.mutedForeground, border: COLOR.mutedForeground, borderAlpha: 0.4, background: COLOR.muted, backgroundAlpha: 0.4 };
}
