/**
 * mapSlots — seeded procedural map layouts (issue #53).
 *
 * A level may declare `slots` (see src/types/level.ts). Each slot resolves,
 * through the run RNG, into one or more concrete `LevelEntity` objects that are
 * appended to the level's fixed `entities`. Because the resolver draws from
 * `getRunRng('slots:'+id)` (see initGame.ts), the same level number produces a
 * structurally different board on every NORMAL run (Math.random passthrough),
 * yet is deterministic on a Daily seed (everyone plays the identical board).
 *
 * Design: a slot offers authored `candidates` (weighted pick-one); any numeric
 * field of a candidate may be a `[min, max]` range the RNG resolves. Discrete
 * candidates keep winnability controllable; ranged fields add continuous jitter.
 * A lightweight viability guard (coverage cap + no obstacle swallowing the
 * centre) re-rolls a few times and falls back to authored-only if it can't find
 * a sane layout, so a bad range combo can never ship an unplayable board.
 *
 * Pure module: no React, no DOM, no direct Math.random (the RNG is injected).
 */

import { Rng } from "@/lib/runRng";
import {
  LevelConfig,
  LevelEntity,
  EntitySlot,
  SlotCandidate,
  SlotValue,
} from "@/types/level";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { ARENA_MARGIN } from "@/lib/gameConstants";

/**
 * Levels below this stay authored/fixed: L1-10 are one-idea-per-map teaching
 * set-pieces (see the early-map-teaching-cadence design) and must not shuffle.
 * Slots on an earlier level are ignored by initGame.
 */
export const PROCEDURAL_MIN_LEVEL = 11;

/** How much of the arena resolved obstacles may cover before a layout is rejected. */
const MAX_COVERAGE = 0.5;
/** A single obstacle sitting on the arena centre may cover at most this fraction. */
const MAX_CENTRE_OBSTACLE = 0.12;
/** How many random layouts to try before falling back to authored-only. */
const MAX_ATTEMPTS = 6;

export interface ArenaBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The nominal (un-shrunk) playable arena, matching initGame's board build. */
export function nominalArena(): ArenaBounds {
  const margin = Math.min(BOARD_WIDTH, BOARD_HEIGHT) * ARENA_MARGIN;
  return { left: margin, top: margin, right: BOARD_WIDTH - margin, bottom: BOARD_HEIGHT - margin };
}

// ── Value / candidate resolution ─────────────────────────────────────────────

/** Resolve a fixed number, or a random point inside a `[min, max]` range. */
function resolveValue(v: SlotValue | undefined, fallback: number, rng: Rng): number {
  if (v === undefined) return fallback;
  if (typeof v === "number") return v;
  const [min, max] = v;
  return min + (max - min) * rng();
}

/** Weighted pick among a slot's candidates; null when none are pickable. */
function weightedPick(candidates: SlotCandidate[], rng: Rng): SlotCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  const weightOf = (c: SlotCandidate) => Math.max(0, c.weight ?? 1);
  const total = candidates.reduce((s, c) => s + weightOf(c), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const c of candidates) {
    r -= weightOf(c);
    if (r < 0) return c;
  }
  return candidates[candidates.length - 1];
}

/** Only spread truthy wall flags so resolved entities stay clean. */
function wallFlags(c: SlotCandidate): Partial<LevelEntity> {
  const f: Record<string, unknown> = {};
  if (c.mirror) f.mirror = true;
  if (c.breakable) f.breakable = true;
  if (c.hitsToBreak !== undefined) f.hitsToBreak = c.hitsToBreak;
  if (c.objective) f.objective = true;
  if (c.fence) f.fence = true;
  return f as Partial<LevelEntity>;
}

/** Build one concrete entity from a candidate, resolving its ranged fields. */
function buildEntity(cand: SlotCandidate, id: string, rng: Rng): LevelEntity {
  const kind = cand.kind ?? "wall";
  if (cand.shape === "circle") {
    const cx = resolveValue(cand.cx, 0, rng);
    const cy = resolveValue(cand.cy, 0, rng);
    const radius = resolveValue(cand.radius, 40, rng);
    if (kind === "mover") {
      return {
        id, kind: "mover", shape: "circle", cx, cy, radius,
        axis: cand.axis ?? "horizontal",
        range: resolveValue(cand.range, 0, rng),
        speed: resolveValue(cand.speed, 100, rng),
        ...(cand.phase !== undefined ? { phase: resolveValue(cand.phase, 0, rng) } : {}),
      } as LevelEntity;
    }
    return { id, kind: "wall", shape: "circle", cx, cy, radius, ...wallFlags(cand) } as LevelEntity;
  }
  // rect
  const x = resolveValue(cand.x, 0, rng);
  const y = resolveValue(cand.y, 0, rng);
  const width = resolveValue(cand.width, 40, rng);
  const height = resolveValue(cand.height, 40, rng);
  if (kind === "mover") {
    return {
      id, kind: "mover", shape: "rect", x, y, width, height,
      axis: cand.axis ?? "horizontal",
      range: resolveValue(cand.range, 0, rng),
      speed: resolveValue(cand.speed, 100, rng),
      ...(cand.phase !== undefined ? { phase: resolveValue(cand.phase, 0, rng) } : {}),
    } as LevelEntity;
  }
  return { id, kind: "wall", shape: "rect", x, y, width, height, ...wallFlags(cand) } as LevelEntity;
}

/** Resolve every slot once, advancing the shared RNG stream. */
function resolveOnce(slots: EntitySlot[], rng: Rng): LevelEntity[] {
  const out: LevelEntity[] = [];
  for (const slot of slots) {
    const chance = slot.chance ?? 1;
    // Draw for chance only when it can fail, so fixed slots don't waste the
    // stream (keeps a Daily seed's draw positions predictable).
    if (chance < 1 && rng() >= chance) continue;
    const count = Math.max(0, Math.round(resolveValue(slot.count, 1, rng)));
    for (let i = 0; i < count; i++) {
      const cand = weightedPick(slot.candidates, rng);
      if (!cand) continue;
      const id = count === 1 ? slot.id : `${slot.id}-${i}`;
      out.push(buildEntity(cand, id, rng));
    }
  }
  return out;
}

// ── Viability ────────────────────────────────────────────────────────────────

function entityBounds(e: LevelEntity): { minX: number; minY: number; maxX: number; maxY: number } {
  if (e.shape === "circle") {
    return { minX: e.cx - e.radius, minY: e.cy - e.radius, maxX: e.cx + e.radius, maxY: e.cy + e.radius };
  }
  if (e.shape === "polygon") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of e.points) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }
  return { minX: e.x, minY: e.y, maxX: e.x + e.width, maxY: e.y + e.height };
}

function entityFootprint(e: LevelEntity): number {
  if (e.shape === "circle") return Math.PI * e.radius * e.radius;
  if (e.shape === "polygon") {
    let area = 0;
    const p = e.points;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[(i + 1) % p.length];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area) / 2;
  }
  return e.width * e.height;
}

/**
 * A coarse "is this board sane?" guard for resolved layouts. Rejects a layout
 * whose obstacles cover too much of the arena, sit largely out of bounds, or
 * where one obstacle swallows the arena centre (blocking the usual spawn zone).
 * Only mover/wall obstacles count; it is a gross-failure net, not a solver.
 */
export function isLayoutViable(entities: LevelEntity[], arena: ArenaBounds): boolean {
  const arenaArea = (arena.right - arena.left) * (arena.bottom - arena.top);
  if (arenaArea <= 0) return false;
  const cx = (arena.left + arena.right) / 2;
  const cy = (arena.top + arena.bottom) / 2;

  let covered = 0;
  for (const e of entities) {
    const b = entityBounds(e);
    // Mostly out of bounds → a placement went wrong.
    if (b.maxX < arena.left || b.minX > arena.right || b.maxY < arena.top || b.minY > arena.bottom) {
      return false;
    }
    const foot = entityFootprint(e);
    covered += foot;
    // No single obstacle straddling the centre unless it is small.
    if (cx > b.minX && cx < b.maxX && cy > b.minY && cy < b.maxY && foot > arenaArea * MAX_CENTRE_OBSTACLE) {
      return false;
    }
  }
  return covered <= arenaArea * MAX_COVERAGE;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Resolve a level's slots into concrete entities using `rng`. Retries a few
 * times until the layout passes `isLayoutViable` (viability accounts for the
 * level's fixed `entities` too), then falls back to an empty list (authored
 * layout only) so a map can never ship unplayable. Returns [] when the level
 * has no slots.
 */
export function resolveSlots(level: LevelConfig, rng: Rng): LevelEntity[] {
  const slots = level.slots;
  if (!slots || slots.length === 0) return [];
  const arena = nominalArena();
  const authored = level.entities ?? [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const resolved = resolveOnce(slots, rng);
    if (isLayoutViable([...authored, ...resolved], arena)) return resolved;
  }
  return [];
}
