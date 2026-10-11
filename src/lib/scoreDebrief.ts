/**
 * The end-of-map debrief: which things on the board earned overtime, and why.
 *
 * When a map is won the board holds for a beat before it shatters into the
 * results card. That beat used to be a grey wave sweeping down the board. Now
 * it boxes each thing that scored, the way a strategy game marks its units:
 * corner brackets round a locked pocket, a smashed slab, the fences that came
 * in under par, the space left; each with a tag saying what it paid and why.
 * The results card then reads as a total of things the player just watched
 * being named, rather than a list of numbers.
 *
 * Pure: built from the game state at the moment the map is won, so the boxes
 * show exactly what scoring used, and so it can be tested without a canvas.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { DebriefItem, DebriefNote, ScoreDebrief } from "@/types/debrief";
import { isPlayerFence } from "@/lib/wallGeometry";

/** Box colours by kind: the accent marks ordinary scoring; the rest say what is special. */
export const DEBRIEF_COLORS = {
  superior: "#ffcf4a",
  smash: "#ff9a3c",
  fences: "#5ad8ff",
} as const;

/** What the scoring at the moment of the win added up to (applyCut has all of it). */
export interface DebriefSummary {
  underParBonus: number;
  fencesUsed: number;
  par: number;
  spaceBonus: number;
  remainingPercent: number;
  thresholdPercent: number;
  shipEarlyBonus: number;
  winBonus: number;
  objectiveBonus: number;
  hazardPay: number;
  pushBonus: number;
}

/** How long the debrief stays up: long enough to read, a beat per extra box, never long. */
export function debriefDurationMs(itemCount: number, noteCount: number): number {
  return Math.round(Math.max(1800, Math.min(3400, 1500 + itemCount * 160 + noteCount * 120)));
}

/** The stagger between boxes appearing, ms. */
export const DEBRIEF_STAGGER_MS = 150;

type Box = DebriefItem["box"];

function boxOf(points: readonly { x: number; y: number }[], pad = 0): Box | null {
  if (points.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** Every locked ball, boxed round its pocket, with what its lock paid. */
function lockItems(game: CanvasGameState): DebriefItem[] {
  const out: DebriefItem[] = [];
  const payouts = game.lockPayouts ?? {};
  for (const [ballId, pay] of Object.entries(payouts)) {
    const flash = game.assimilations.get(ballId);
    const ball = game.balls.find(b => b.id === ballId);
    const pocket = flash ? boxOf(flash.contours.flat(), 6) : null;
    const at = flash?.ballPos ?? ball?.position;
    const r = (ball?.radius ?? 12) * 2.5;
    const box = pocket ?? (at ? { x: at.x - r, y: at.y - r, w: r * 2, h: r * 2 } : null);
    if (!box) continue;
    const kind = pay.superior ? "superior" : pay.zone ? "zone" : "lock";
    const detail = pay.together > 1
      ? { key: "debrief.multiDetail", values: { n: pay.together } }
      : { key: `debrief.${kind}Detail` };
    out.push({
      kind, box, hours: pay.hours,
      title: { key: `debrief.${kind}` },
      detail,
      color: kind === "superior" ? DEBRIEF_COLORS.superior : kind === "zone" ? (flash?.zoneColor ?? null) : null,
    });
  }
  return out;
}

/** Each slab or mirror smashed this map: each one raised the map's payout. */
function smashItems(game: CanvasGameState): DebriefItem[] {
  const out: DebriefItem[] = [];
  for (const d of game.destructibles ?? []) {
    if (!d.destroyed) continue;
    const poly = d.obstaclePolygon ?? d.mirrorPolygon;
    const box = poly ? boxOf(poly.vertices, 4) : null;
    if (!box) continue;
    out.push({
      kind: "smash", box, hours: null,
      title: { key: "debrief.smash" },
      detail: { key: d.objective ? "debrief.smashObjectiveDetail" : "debrief.smashDetail" },
      color: DEBRIEF_COLORS.smash,
    });
  }
  return out;
}

/** The player's fences, boxed together, when they came in under par. */
function fenceItem(game: CanvasGameState, s: DebriefSummary): DebriefItem | null {
  if (!(s.underParBonus > 0)) return null;
  const fences = game.walls.filter(w => isPlayerFence(w) && !w.isMirror && !w.isObstacleBoundary);
  const box = boxOf(fences.flatMap(w => [w.start, w.end]), 8);
  if (!box) return null;
  return {
    kind: "fences", box, hours: Math.round(s.underParBonus),
    title: { key: "debrief.fences" },
    detail: { key: "debrief.fencesDetail", values: { used: s.fencesUsed, par: s.par } },
    color: DEBRIEF_COLORS.fences,
  };
}

/** The space still live when the map was won, boxed, with how far under the target it came. */
function spaceItem(game: CanvasGameState, s: DebriefSummary): DebriefItem | null {
  const grid = game.spaceGrid;
  if (!grid || s.remainingPercent > s.thresholdPercent) return null;
  const pts: { x: number; y: number }[] = [];
  for (const region of game.gridRegions ?? []) {
    for (const idx of region.cellIndices) {
      const col = idx % grid.width, row = Math.floor(idx / grid.width);
      pts.push({ x: grid.originX + col * grid.cellSize, y: grid.originY + row * grid.cellSize });
      pts.push({ x: grid.originX + (col + 1) * grid.cellSize, y: grid.originY + (row + 1) * grid.cellSize });
    }
  }
  const box = boxOf(pts);
  if (!box) return null;
  return {
    kind: "space", box, hours: s.spaceBonus > 0 ? Math.round(s.spaceBonus) : null,
    title: { key: "debrief.space" },
    detail: { key: "debrief.spaceDetail", values: { left: Math.round(s.remainingPercent), target: Math.round(s.thresholdPercent) } },
    color: null,
  };
}

/** What scored without a place on the board. */
function notesOf(s: DebriefSummary): DebriefNote[] {
  const notes: DebriefNote[] = [];
  const add = (key: string, hours: number) => { if (hours > 0) notes.push({ title: { key }, hours: Math.round(hours) }); };
  add("debrief.shipEarly", s.shipEarlyBonus);
  add("debrief.winBonus", s.winBonus);
  add("debrief.objective", s.objectiveBonus);
  add("debrief.hazardPay", s.hazardPay);
  add("debrief.push", s.pushBonus);
  return notes;
}

export function buildScoreDebrief(game: CanvasGameState, s: DebriefSummary): ScoreDebrief {
  const items: DebriefItem[] = [
    ...[spaceItem(game, s)].filter((i): i is DebriefItem => i !== null),
    ...[fenceItem(game, s)].filter((i): i is DebriefItem => i !== null),
    ...smashItems(game),
    // Locks last: they are the big money, and the eye ends where the tags stop.
    ...lockItems(game),
  ];
  const notes = notesOf(s);
  return { items, notes, durationMs: debriefDurationMs(items.length, notes.length) };
}
