/**
 * Where ScoreDebrief draws each box and its tag, and when (pure, so the
 * placement can be tested without a canvas).
 *
 * The debrief marks what scored the way a strategy game marks a selected unit:
 * corner brackets round the thing, a short leader, and a tag plate with what it
 * paid and why. The tags are a fixed size so they can be placed before they
 * are drawn: above the box first, then below, right, left, then inside it (a
 * box the size of the board has no outside), skipping any spot that leaves the
 * board or lands on a tag already placed.
 */
import { BOARD_HEIGHT, BOARD_WIDTH } from "@/lib/boardConstants";
import type { DebriefItem } from "@/types/debrief";

export interface Rect { x: number; y: number; w: number; h: number }

/** The world-to-screen mapping: the canvas box inside GameCanvas's container. */
export interface DebriefCanvas {
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetLeft: number;
  canvasOffsetTop: number;
}

/** The smallest box drawn, CSS px: a lone ball's lock still gets brackets you can see. */
export const MIN_BOX = 22;
/** The gap between a box and its tag. */
export const TAG_GAP = 8;
export const TAG_H = 38;

/** A tag's width: wide enough for a title and a reason, never most of the board. */
export function tagWidth(bounds: Rect): number {
  return Math.round(Math.max(120, Math.min(190, bounds.w * 0.48)));
}

export function worldToCss(box: Rect, c: DebriefCanvas): Rect {
  const sx = c.canvasWidth / BOARD_WIDTH, sy = c.canvasHeight / BOARD_HEIGHT;
  let x = c.canvasOffsetLeft + box.x * sx, y = c.canvasOffsetTop + box.y * sy;
  let w = box.w * sx, h = box.h * sy;
  if (w < MIN_BOX) { x -= (MIN_BOX - w) / 2; w = MIN_BOX; }
  if (h < MIN_BOX) { y -= (MIN_BOX - h) / 2; h = MIN_BOX; }
  return { x, y, w, h };
}

function inside(r: Rect, b: Rect): boolean {
  return r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function clampInto(r: Rect, b: Rect): Rect {
  return {
    ...r,
    x: Math.max(b.x, Math.min(b.x + b.w - r.w, r.x)),
    y: Math.max(b.y, Math.min(b.y + b.h - r.h, r.y)),
  };
}

/** Where a tag may go round `box`, best first. */
function candidates(box: Rect, w: number, h: number): Rect[] {
  const g = TAG_GAP;
  const right = box.x + box.w - w;
  return [
    { x: box.x, y: box.y - g - h, w, h },                 // above, left-aligned
    { x: right, y: box.y - g - h, w, h },                 // above, right-aligned
    { x: box.x, y: box.y + box.h + g, w, h },             // below
    { x: right, y: box.y + box.h + g, w, h },
    { x: box.x + box.w + g, y: box.y, w, h },             // right
    { x: box.x - g - w, y: box.y, w, h },                 // left
    { x: box.x + g, y: box.y + g, w, h },                 // inside, top-left
    { x: box.x + box.w - g - w, y: box.y + box.h - g - h, w, h }, // inside, bottom-right
  ];
}

export interface PlacedItem {
  box: Rect;
  tag: Rect;
  /** The leader: from the box's nearest corner to the tag's nearest corner. */
  leader: [{ x: number; y: number }, { x: number; y: number }];
}

function corners(r: Rect) {
  return [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h },
  ];
}

function leaderBetween(box: Rect, tag: Rect): PlacedItem["leader"] {
  let best: PlacedItem["leader"] = [{ x: box.x, y: box.y }, { x: tag.x, y: tag.y }];
  let bestD = Infinity;
  for (const a of corners(box)) for (const b of corners(tag)) {
    const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    if (d < bestD) { bestD = d; best = [a, b]; }
  }
  return best;
}

/**
 * Every item's box and tag, in CSS px relative to GameCanvas's container.
 * `keepOut` is space the tags must not take (the notes panel). A tag also
 * stays off the other small boxes, so it never hides the next thing named; a
 * box a quarter of the board or more (all the fences, the space left) has no
 * room round it to keep clear of, so it is not counted.
 */
export function placeDebrief(items: readonly DebriefItem[], canvas: DebriefCanvas, bounds: Rect, keepOut: Rect | null = null): PlacedItem[] {
  const w = tagWidth(bounds), h = TAG_H;
  const taken: Rect[] = keepOut ? [keepOut] : [];
  const boxes = items.map(item => worldToCss(item.box, canvas));
  const small = (r: Rect) => r.w * r.h < bounds.w * bounds.h * 0.25;
  const out: PlacedItem[] = [];
  boxes.forEach((box, i) => {
    const others = boxes.filter((b, j) => j !== i && small(b));
    // Each spot as drawn and slid back onto the board, scored: on another tag
    // is worst, on another box bad, over its own box only when nothing else will do.
    const opts = candidates(box, w, h).flatMap(r => [r, clampInto(r, bounds)]).filter(r => inside(r, bounds));
    const cost = (r: Rect) =>
      taken.reduce((s, t) => s + overlap(r, t) * 4, 0) + others.reduce((s, t) => s + overlap(r, t), 0) + overlap(r, box) * 0.5;
    let placed = clampInto(candidates(box, w, h)[0], bounds), least = Infinity;
    for (const r of opts) {
      const c = cost(r);
      if (c < least) { least = c; placed = r; }
    }
    taken.push(placed);
    out.push({ box, tag: placed, leader: leaderBetween(box, placed) });
  });
  return out;
}

/** The notes panel, top-right inside the board. */
export function notesRect(bounds: Rect, count: number): Rect | null {
  if (count === 0) return null;
  const w = tagWidth(bounds), rowH = 16, pad = 6;
  const h = pad * 2 + 14 + count * rowH;
  return { x: bounds.x + bounds.w - w - 6, y: bounds.y + 6, w, h };
}

// ── Timing ──────────────────────────────────────────────────────────────────

/** How long one box takes to lock on, ms: brackets slam in, blink, then the tag types out. */
export const LOCK_ON_MS = 260;
export const TYPE_MS = 240;
/** The overlay's fade as the board shatters, ms (the hold after the debrief is 500). */
export const FADE_MS = 220;

export interface ItemFrame {
  /** 0 before it appears. */
  alpha: number;
  /** The brackets' scale: from wide to tight as they lock on. */
  scale: number;
  /** 0..1 of the tag's text shown. */
  typed: number;
}

/**
 * One box at `t` ms into the debrief (after its delay), `index` in order.
 * Blinks twice while locking on, as a targeting box does.
 */
export function itemFrame(t: number, index: number, stagger: number, reduceMotion: boolean): ItemFrame {
  const local = t - index * stagger;
  if (local < 0) return { alpha: 0, scale: 1, typed: 0 };
  if (reduceMotion) return { alpha: 1, scale: 1, typed: 1 };
  const k = Math.min(1, local / LOCK_ON_MS);
  const ease = 1 - (1 - k) ** 3;
  const blink = local < LOCK_ON_MS && Math.floor(local / 65) % 2 === 1 ? 0.35 : 1;
  return {
    alpha: blink,
    scale: 1 + 0.6 * (1 - ease),
    typed: Math.max(0, Math.min(1, (local - LOCK_ON_MS * 0.5) / TYPE_MS)),
  };
}

/** The whole overlay's alpha: out over FADE_MS once the debrief is over, unless held. */
export function overlayAlpha(t: number, durationMs: number, hold: boolean): number {
  if (hold || t <= durationMs) return 1;
  return Math.max(0, 1 - (t - durationMs) / FADE_MS);
}

/** "+12h"; a box with no figure of its own shows none. */
export function hoursText(hours: number | null): string {
  return hours == null ? "" : `+${Math.round(hours)}h`;
}

/** The first `typed` share of `s`, for the tag typing itself out. */
export function typedText(s: string, typed: number): string {
  if (typed >= 1) return s;
  return s.slice(0, Math.ceil(s.length * Math.max(0, typed)));
}
