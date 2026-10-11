/**
 * The pipeline pieces' rules as data (pipeline.tsx draws them), split out so
 * they can be tested without a canvas and so pipeline.tsx exports only
 * components (lint: react-refresh/only-export-components).
 */
import { ROLE } from "../theme";

/** Where a stage of the between-map pipeline is. */
export type StageState = "done" | "now" | "todo";

export interface Stage {
  id: string;
  title: string;
  /** One short line under the title: what happened, or what is coming. */
  detail?: string;
  state: StageState;
}

/** How a stage's marker on the rail looks. */
export interface StageMark {
  /** The ring's colour. */
  ring: number;
  /** Filled (done), or hollow. */
  filled: boolean;
  /** The title's colour. */
  title: number;
}

/**
 * The current stage is the only one in gold: it is the one asking for a
 * decision, and gold is the colour the hours being spent there wear. Done
 * stages take the band's accent; stages still to come are drawn in the edge
 * colour so they read as "later", not as disabled.
 */
export function stageMark(state: StageState, accent: number): StageMark {
  if (state === "done") {
    return { ring: accent, filled: true, title: ROLE.ink };
  }
  if (state === "now") {
    return { ring: ROLE.hours, filled: false, title: ROLE.ink };
  }
  return { ring: ROLE.edge, filled: false, title: ROLE.muted };
}

/** A line in the debrief log. */
export interface LedgerRow {
  label: string;
  /** Right-hand figure, already formatted ("+18h", "-6h", "1 284h"). */
  value?: string;
  /**
   * pass: a condition met (a check, the accent); fail: missed or taken away
   * (a cross, red); total: a summing line, below the rule (sigma, gold);
   * note: no mark, muted.
   */
  tone?: "pass" | "fail" | "total" | "note";
}

/** The mark and colours a ledger row is drawn with. */
export function ledgerLook(tone: LedgerRow["tone"], accent: number): { mark: string; markColor: number; textColor: number } {
  switch (tone) {
    case "pass": return { mark: "✓", markColor: accent, textColor: ROLE.ink };
    case "fail": return { mark: "✗", markColor: ROLE.cost, textColor: ROLE.ink };
    case "total": return { mark: "Σ", markColor: ROLE.hours, textColor: ROLE.ink };
    default: return { mark: "", markColor: ROLE.muted, textColor: ROLE.muted };
  }
}

/**
 * The rows above the rule and the totals below it, each in the order given.
 * The rule is drawn only when both halves have rows.
 */
export function splitLedger(rows: readonly LedgerRow[]): { body: LedgerRow[]; totals: LedgerRow[] } {
  return {
    body: rows.filter(r => r.tone !== "total"),
    totals: rows.filter(r => r.tone === "total"),
  };
}

/**
 * Hours as the pipeline writes them: a space between thousands so
 * "1 284h" scans as one figure, and an explicit sign when asked for.
 */
export function formatHours(n: number, signed = false): string {
  const whole = Math.round(n);
  const abs = Math.abs(whole).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sign = whole < 0 ? "-" : signed ? "+" : "";
  return `${sign}${abs}h`;
}
