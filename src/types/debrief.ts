/**
 * The end-of-map debrief: what on the board earned overtime, and why
 * (lib/scoreDebrief.ts builds it, ui/game/ScoreDebrief.tsx draws it).
 */

/** What one lock paid, recorded at the moment it sealed (checkBallWonState). */
export interface LockPayout {
  /** Overtime hours this ball's lock paid, before the per-map cap. */
  hours: number;
  /** Graded superior: a tight pocket, paid the superior multiplier. */
  superior: boolean;
  /** Sealed inside a Colored Area, which multiplied it. */
  zone: boolean;
  /** How many balls the same cut sealed (2+ is a multi-lock). */
  together: number;
}

export type DebriefKind = "lock" | "superior" | "zone" | "smash" | "fences" | "space";

/** An i18n key and its values. */
export interface DebriefText {
  key: string;
  values?: Record<string, string | number>;
}

/** One thing on the board that scored, boxed. */
export interface DebriefItem {
  kind: DebriefKind;
  /** The box, in world units (the board is 900 across). */
  box: { x: number; y: number; w: number; h: number };
  title: DebriefText;
  /** Why it scored. */
  detail: DebriefText;
  /** What it paid, or null when it pays as part of a total. */
  hours: number | null;
  /** The box's colour, "#rrggbb"; null is the run's accent. */
  color: string | null;
  /**
   * A group of small things named once (the bricks smashed): each member gets
   * its own small brackets and a leader to the one tag, and `box` is the box
   * round all of them, which the tag is placed against.
   */
  members?: { x: number; y: number; w: number; h: number }[];
}

/** Something that scored without a place on the board (the clock, the win, an objective). */
export interface DebriefNote {
  title: DebriefText;
  hours: number;
}

export interface ScoreDebrief {
  items: DebriefItem[];
  notes: DebriefNote[];
  /** How long it stays up before the board shatters, ms. */
  durationMs: number;
}
