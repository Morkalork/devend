/**
 * Small rules the between-map draft screens share (canvas ports of
 * components/game/*DraftScreen.tsx and DraftCard.tsx), kept out of the .tsx
 * files so they can be tested without rendering.
 */
import type { AscensionRung } from "@/types/loadout";
import { rungAt, rungsUpTo } from "@/lib/ascensionLadder";
import { tint } from "../kit/style";
import { COLOR, hex } from "../theme";

/** The draft screens' pale green body text. */
export const DRAFT_TEXT = hex("#c8ffd8");
/** Their dim green hint text. */
export const DRAFT_HINT = hex("#4a7a5a");
/** The curse red. */
export const DRAFT_RED = hex("#ff6b6b");

/** Tapping the selected card deselects it; tapping another moves the selection. */
export function toggleSelection(current: string | null, id: string): string | null {
  return current === id ? null : id;
}

/** Tailwind's `sm` breakpoint, where the draft grids go from one column to several. */
export const SM_BREAKPOINT = 640;

/**
 * Columns for a row of draft cards. A thin pool can return two; centre two
 * rather than leaving a hole in a three-wide grid (and narrow the grid to
 * `max-w-xl` for them).
 */
export function draftColumns(count: number, screenWidth: number, alwaysThree = false): { columns: number; maxWidth: number | null } {
  if (screenWidth < SM_BREAKPOINT) return { columns: 1, maxWidth: null };
  if (!alwaysThree && count === 2) return { columns: 2, maxWidth: 576 };
  return { columns: 3, maxWidth: null };
}

/** Split cards into grid rows of `columns`. */
export function gridRows<T>(list: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += columns) rows.push(list.slice(i, i + columns));
  return rows;
}

export interface DraftCardLook {
  background: string;
  border: number | string;
  /** Name glow (text-shadow) only when selected. */
  glow: number;
}

/**
 * The selected/unselected treatment every draft card shares: tinted ground,
 * solid accent border and a glow when chosen, a faint ground and a dim accent
 * border otherwise.
 */
export function draftCardLook(accent: number, selected: boolean): DraftCardLook {
  return {
    background: selected ? tint(accent, 0x1a / 255) : tint(COLOR.white, 0.04),
    border: selected ? accent : tint(accent, 0x44 / 255),
    glow: selected ? 12 : 0,
  };
}

/** A hold hint is a promise: only a card that does something on hold shows one. */
export function draftCardShowsHoldHint(onLongPress: (() => void) | undefined): boolean {
  return !!onLongPress;
}

/**
 * What ascending would switch on. Past the ladder's end no NEW rung lands, so
 * there is nothing to promise and the screen says only what already holds.
 */
export function ascensionBriefing(ascensionDepth: number, ladder: AscensionRung[]) {
  const nextDepth = ascensionDepth + 1;
  return {
    nextDepth,
    incoming: rungAt(nextDepth, ladder),
    alreadyInForce: rungsUpTo(ascensionDepth, ladder),
  };
}

export interface RichRun {
  text: string;
  bold?: boolean;
  /** The bold weight, when not 700 (font-semibold is 600). */
  weight?: "600" | "700";
  /** Overrides the paragraph's ink for this run. */
  color?: number;
  alpha?: number;
}

/**
 * A paragraph with a bold or coloured word in it (the DOM's `<b>` or `<span>`
 * inside a `<p>`), as the words a wrapping row lays out. A canvas text run has
 * one weight and one colour, so each word is its own run; pieces of a word that touch across a weight change
 * (`loadout` + `,`) stay glued in one group so no space opens between them.
 */
export function richWords(runs: RichRun[]): RichRun[][] {
  const groups: RichRun[][] = [];
  let joinNext = false;
  for (const run of runs) {
    // Breakable whitespace only: a no-break space (U+00A0) keeps its words in one group.
    const pieces = run.text.split(/([ \t\n]+)/);
    for (const piece of pieces) {
      if (piece === "") continue;
      if (/^[ \t\n]+$/.test(piece)) { joinNext = false; continue; }
      const word = { ...run, text: piece };
      if (joinNext && groups.length > 0) groups[groups.length - 1].push(word);
      else groups.push([word]);
      joinNext = true;
    }
  }
  return groups;
}
