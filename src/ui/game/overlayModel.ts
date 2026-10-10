/**
 * What the board overlays decide, as pure functions: the canvas components
 * draw these, and the tests read them without a canvas.
 */
import type { BoardFrameCss } from "@/components/game/BoardPlaceholder";
import { deadlineColor, deadlineMilestone } from "@/lib/deadlineDisplay";
import type { LockDecision } from "@/lib/lockDiagnostics";
import type { TurnView } from "@/lib/net/pairTurn";
import { cssHex } from "./fxModel";
import type { Pt } from "./boardDraw";

// ── BoardAlert / WinGateFrame ──────────────────────────────────────────────

/** BoardAlert's alarm colour. Distinct from WinGateFrame's amber on purpose. */
export const ALARM = 0xff6b6b;

/**
 * WinGateFrame's colour: an outstanding requirement. Not the run's accent,
 * which means "done" everywhere else in the HUD; ONE colour, not one per
 * condition kind (see WinGateFrame for why).
 */
export const OUTSTANDING = 0xffb347;

/** BoardAlert's edge opacity: pulsing 0.35..1, or a steady 0.85 under reduced motion. */
export function alarmEdgeAlpha(pulse: number, reduceMotion: boolean): number {
  return reduceMotion ? 0.85 : 0.35 + 0.65 * pulse;
}

// ── DeadlineFrame ──────────────────────────────────────────────────────────

/**
 * Points along a rectangle traced clockwise from the middle of its top edge
 * (the same path as deadlineDisplay's clockRectPath), cut off at `fraction` of
 * its length. The stroked share is what the DOM drew with a dash the path's
 * length long and offset by the spent share.
 */
export function clockRectPoints(x: number, y: number, w: number, h: number, fraction: number): Pt[] {
  const cx = x + w / 2;
  const corners: Pt[] = [
    { x: cx, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }, { x: cx, y },
  ];
  const total = 2 * (w + h);
  let left = Math.max(0, Math.min(1, fraction)) * total;
  const out: Pt[] = [corners[0]];
  for (let i = 0; i < corners.length - 1 && left > 1e-9; i++) {
    const a = corners[i], b = corners[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= left) {
      out.push(b);
      left -= len;
    } else {
      const k = left / len;
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      left = 0;
    }
  }
  return out;
}

/** The length of a polyline. */
export function polylineLength(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}

export interface DeadlineGeometry {
  /** Share of the clock left, 0..1. */
  remaining: number;
  /** The band's stroke width. */
  band: number;
  /** The band's centre line, in the frame's own coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The whole path's length, and how much of it is still lit. */
  length: number;
  lit: number;
  color: number;
  /** The milestone numeral to flash this second, or null. */
  milestone: number | null;
}

/** DeadlineFrame's whole decision; null draws nothing (no clock, or not sized yet). */
export function deadlineGeometry(frame: BoardFrameCss | null, secondsLeft: number | null, limit: number | null): DeadlineGeometry | null {
  if (!frame || secondsLeft == null || limit == null || !(limit > 0)) return null;
  const remaining = Math.max(0, Math.min(1, secondsLeft / limit));
  // The centre line of the frame band, so the stroke covers the band itself.
  const band = Math.max(3, frame.frame * 0.6);
  const half = frame.frame / 2;
  const w = frame.width - frame.frame;
  const h = frame.height - frame.frame;
  const length = 2 * (w + h);
  return {
    remaining, band, x: half, y: half, w, h, length,
    lit: length * remaining,
    color: cssHex(deadlineColor(remaining)),
    milestone: deadlineMilestone(secondsLeft, limit),
  };
}

// ── BoardPlaceholder ───────────────────────────────────────────────────────

/** Grid spacing as a share of the arena, so it reads the same on any screen. */
export const PLACEHOLDER_GRID_CELLS = 12;

export interface PlaceholderGeometry {
  /** The arena inside the frame band, relative to the frame's outer edge. */
  inner: { x: number; y: number; width: number; height: number };
  /** Grid spacing. */
  cell: number;
  /** The scan line's height and its sweep (from, to) in the arena's own y. */
  scanHeight: number;
  scanFrom: number;
  scanTo: number;
}

export function placeholderGeometry(frame: BoardFrameCss): PlaceholderGeometry {
  const arena = frame.width - frame.frame * 2;
  return {
    inner: { x: frame.frame, y: frame.frame, width: arena, height: frame.height - frame.frame * 2 },
    cell: arena / PLACEHOLDER_GRID_CELLS,
    scanHeight: Math.max(24, arena * 0.12),
    scanFrom: -arena * 0.12,
    scanTo: arena,
  };
}

/** How long the placeholder fades before it leaves the tree. */
export const PLACEHOLDER_FADE_MS = 500;

// ── LockDebugOverlay ───────────────────────────────────────────────────────

export const OUTCOME_COLOR: Record<LockDecision["outcome"], number> = {
  locked: 0x6bffbc,
  "rejected-unsealed": 0xffd54a,
  "below-gate": 0x8899aa,
};

const OUTCOME_LABEL: Record<LockDecision["outcome"], string> = {
  locked: "LOCK",
  "rejected-unsealed": "open",
  "below-gate": "big",
};

/** One row of the lock log, exactly as the DOM overlay printed it. */
export function lockDecisionLine(d: LockDecision): string {
  return OUTCOME_LABEL[d.outcome].padEnd(5)
    + " cells=" + d.regionCells
    + " den=" + d.denominator
    + " " + d.percentage.toFixed(2) + "%<=" + d.thresholdPercent
    + " seal=" + (d.trulySealed === null ? "skip" : d.trulySealed ? "yes" : "NO")
    + (d.lockedBySliver ? " sliver" : "")
    + (d.containedInArea ? " inArea" : "")
    + (d.isBoss ? " boss" : "");
}

// ── PairTurnOverlay ────────────────────────────────────────────────────────

/** Whose colour the turn is drawn in: yours on your go, theirs while spectating. */
export function turnColor(view: TurnView, myColor: string, partnerColor: string): string {
  return view !== "theirs" ? myColor : partnerColor;
}

/** The splash plays on every change of hands, not once the fence is spent. */
export function turnSplashes(view: TurnView): boolean {
  return view !== "yoursSpent";
}

/** Your-turn glow opacity: breathing while the fence is still to draw, steady once drawn. */
export function turnGlowAlpha(view: TurnView, pulse: number): number {
  return view === "yours" ? 0.55 + 0.45 * pulse : 0.6;
}

// ── PlayChips ──────────────────────────────────────────────────────────────

export type ChipId = "freeze" | "derails" | "bands" | "fenceBudget";

export interface ChipSpec {
  id: ChipId;
  side: "left" | "right";
  /** Offset below the play region's top, in px. */
  top: number;
  /** The chip's colour as a CSS string. */
  color: string;
  /** Dimmed: out of uses. */
  alpha: number;
  text: string;
}

export interface ChipCount {
  left: number;
  total: number;
}

/** The fence budget's warning colour, at two fences left or fewer. */
export const FENCE_BUDGET_WARN = "#ff8a5b";

/**
 * The play region's counters and where each goes: freeze top-right, derails
 * under it, bands under derails (or in derails' place), the fence budget
 * top-left. The derail and band rations are a choiceGroup, so a player owns at
 * most one; the Playground can set both, and stacking rather than overlapping
 * is what makes that testable.
 */
export function playChipLayout(p: {
  accentColor: string;
  freeze: ChipCount | null;
  derails: ChipCount | null;
  bands: ChipCount | null;
  fenceBudget: ChipCount | null;
}): ChipSpec[] {
  const out: ChipSpec[] = [];
  const chip = (id: ChipId, side: "left" | "right", top: number, c: ChipCount, color: string): ChipSpec => ({
    id, side, top, color, alpha: c.left > 0 ? 1 : 0.4, text: `${c.left}/${Math.round(c.total)}`,
  });
  if (p.freeze) out.push(chip("freeze", "right", 8, p.freeze, p.accentColor));
  if (p.derails) out.push(chip("derails", "right", 44, p.derails, p.accentColor));
  if (p.bands) out.push(chip("bands", "right", p.derails ? 80 : 44, p.bands, p.accentColor));
  if (p.fenceBudget) {
    const col = p.fenceBudget.left <= 2 ? FENCE_BUDGET_WARN : p.accentColor;
    out.push(chip("fenceBudget", "left", 8, p.fenceBudget, col));
  }
  return out;
}
