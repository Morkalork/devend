/**
 * "What is that thing?" — hit-testing the board so any object can be held for an
 * explanation.
 *
 * The game teaches its objects with one-time modals that interrupt play, fire
 * once, and are gone forever. A player meeting a mirror for the third time, or
 * returning after a week, has no way back to the explanation. Press-and-hold is
 * already the project's standard gesture for "explain this" - it is on upgrade
 * cards, draft cards, score rows and superior-lock stars - but it was never on
 * the board itself, which is where the unfamiliar objects actually are.
 *
 * Ordered smallest-first: a pickup sitting on top of an obstacle inside a colored
 * area has to resolve to the pickup, because that is the thing the finger is on.
 * Areas come last for the same reason - they are the size of a room.
 */

import type { CanvasGameState } from "@/types/gameState";
import { pointInPolygon } from "@/lib/polygon";
import { coloredAreaAt } from "@/lib/coloredAreas";

export type BoardEntityKind =
  | "pickup"
  | "chestLoot"
  | "dormantBall"
  | "terminal"
  | "ball"
  | "chest"
  | "objective"
  | "breakable"
  | "mirror"
  | "mover"
  | "phasing"
  | "obstacle"
  | "area";

export interface BoardEntityHit {
  kind: BoardEntityKind;
  /** Extra detail for kinds whose copy is parameterised (e.g. the area's type). */
  detail?: string;
}

/** Generous enough to hit on a phone, in world units. */
const TOUCH_SLOP = 22;

function near(x: number, y: number, px: number, py: number, r: number): boolean {
  const dx = x - px, dy = y - py;
  return dx * dx + dy * dy <= r * r;
}

export function boardEntityAt(game: CanvasGameState, x: number, y: number): BoardEntityHit | null {
  // ── Small, transient things first: they sit ON TOP of everything else ──────
  for (const p of game.pickups ?? []) {
    if (near(x, y, p.position.x, p.position.y, TOUCH_SLOP)) return { kind: "pickup", detail: p.effect };
  }
  for (const g of game.chestLoot ?? []) {
    if (near(x, y, g.x, g.y, TOUCH_SLOP)) return { kind: "chestLoot" };
  }

  for (const b of game.balls) {
    if (b.state === "won") continue;
    if (!near(x, y, b.position.x, b.position.y, Math.max(b.radius, TOUCH_SLOP))) continue;
    // A dormant ball is the one players ask about: it sits inert in a cage until
    // its terminal is wired, and looks like a bug until you know that.
    return { kind: b.state === "dormant" ? "dormantBall" : "ball", detail: b.typeId };
  }

  for (const t of game.circuit?.terminals ?? []) {
    if (near(x, y, t.x, t.y, TOUCH_SLOP)) return { kind: "terminal" };
  }

  // ── Solid furniture. Destructibles carry state, so they answer before the
  // plain polygon lists, which would otherwise swallow them. ────────────────
  for (const d of game.destructibles) {
    if (d.destroyed) continue;
    const poly = d.obstaclePolygon ?? d.mirrorPolygon;
    if (!poly || !pointInPolygon({ x, y }, poly)) continue;
    if (d.chest) return { kind: "chest" };
    if (d.objective) return { kind: "objective" };
    return { kind: d.kind === "mirror" ? "mirror" : "breakable" };
  }

  for (const p of game.phasingObjects ?? []) {
    if (pointInPolygon({ x, y }, p.polygon)) return { kind: "phasing" };
  }
  for (const m of game.movers ?? []) {
    if (m.polygon && pointInPolygon({ x, y }, m.polygon)) return { kind: "mover" };
  }
  for (const poly of game.mirrorPolygons) {
    if (pointInPolygon({ x, y }, poly)) return { kind: "mirror" };
  }
  for (const poly of game.obstaclePolygons) {
    if (pointInPolygon({ x, y }, poly)) return { kind: "obstacle" };
  }

  // ── Last: a zone is the size of a room, so anything standing in one wins. ──
  const area = coloredAreaAt(x, y, game.coloredAreas ?? []);
  if (area) return { kind: "area", detail: area.kind };

  return null;
}
