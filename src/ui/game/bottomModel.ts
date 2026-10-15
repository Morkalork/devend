/**
 * The decisions behind the play screen's bottom stack (fence slots, ability
 * buttons, the shared context lane), pulled out of the canvas components so
 * they can be tested without a renderer. Each function is the rule its DOM
 * original applied inline; the reasoning is kept next to it.
 */
import {
  Snowflake, Snail, Shield, Eraser, Magnet, Hourglass, Scissors, Spline, Sparkles,
} from "lucide-react";
import {
  getFenceType, standardFenceType, FENCE_SLOTS, STANDARD_FENCE_ID, type FenceTypeDef,
} from "@/lib/fences";
import { getAllAbilities, type AbilityDef, type AbilityKind } from "@/lib/abilities";
import { getShipEarlyThresholds, getShipEarlyPercent, getShipEarlyMaxPercent, getAxisCeilings } from "@/lib/scoring";
import { tempoRatio } from "@/lib/scoreAxes";
import { deadlineColor } from "@/lib/deadlineDisplay";
import type { AbilityTimer } from "@/components/game/GameCanvas";
import type { GameMessage } from "@/lib/gameMessages";
import type { IconSource } from "../kit/ui";
import { hsl } from "../theme";
import { contentText } from "@/i18n/content";
import type { TFunction } from "i18next";

// ── Colour ─────────────────────────────────────────────────────────────────

/**
 * A CSS colour string as a number: the catalogues carry "#rrggbb" (or "#rgb"),
 * and the deadline colour arrives as "hsl(h, s%, l%)". Anything else falls back.
 */
export function cssColor(s: string | undefined | null, fallback = 0xffffff): number {
  if (!s) return fallback;
  const str = s.trim();
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(str);
  if (h) {
    const v = h[1];
    if (v.length === 3) return Number.parseInt(v.split("").map(c => c + c).join(""), 16);
    return Number.parseInt(v.slice(0, 6), 16);
  }
  const m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(str);
  if (m) return hsl(Number(m[1]), Number(m[2]), Number(m[3]));
  return fallback;
}

// ── Touch targets ──────────────────────────────────────────────────────────

/**
 * Apple's 44px minimum tappable target. The ability buttons were once about
 * 24px tall, and they are the most time-critical controls in the game.
 */
export const TOUCH_TARGET = 44;

// ── Fence slots ────────────────────────────────────────────────────────────

/**
 * What the slot bar draws: standard first, then the player's roster, padded
 * with empties to FENCE_SLOTS so the bar's size never changes.
 *
 * Standard is filtered OUT of the roster rather than trusted to be absent: a
 * caller that passed it anyway (a stale save, a dev flag) would otherwise draw
 * two Standard slots and give the player a duplicate they cannot remove.
 *
 * Five is a FLOOR, not a ceiling. A run can only ever fill four, but the admin
 * Playground hands the bar the whole catalogue, and truncating there would hide
 * a fence type from the one screen whose job is trying them all.
 */
export function fenceSlotRoster(slotIds: readonly string[]): { owned: FenceTypeDef[]; empties: number } {
  const roster = slotIds.filter(id => id !== STANDARD_FENCE_ID);
  const owned = [standardFenceType(), ...roster.map(getFenceType)];
  return { owned, empties: Math.max(0, FENCE_SLOTS - owned.length) };
}

export type FenceShield = "ready" | "spent" | null;

export interface FenceSlotView {
  fence: FenceTypeDef;
  /** The slot's colour: the fence's own, so the bar and the cut agree. */
  color: number;
  selected: boolean;
  /** A lit shield until the map's Guardrail shield is gone, struck out after; null on a type without one. */
  shield: FenceShield;
}

export function fenceSlotViews(
  owned: readonly FenceTypeDef[], selectedId: string, accentColor: string, shieldSpent: boolean,
): FenceSlotView[] {
  return owned.map(f => ({
    fence: f,
    color: cssColor(f.color || accentColor),
    selected: selectedId === f.id,
    shield: f.shieldsPerMap > 0 ? (shieldSpent ? "spent" : "ready") : null,
  }));
}

/**
 * The selected slot is filled and lit, the rest are dimmed outlines: a ring
 * alone was not enough at a glance on a dark board with five buttons in a row.
 */
export function fenceSlotLook(selected: boolean): { fillAlpha: number; alpha: number; ring: boolean } {
  return selected
    ? { fillAlpha: 0x44 / 255, alpha: 1, ring: true }
    : { fillAlpha: 0x14 / 255, alpha: 0.75, ring: false };
}

/** Tap selects (a mode, held until changed); hold explains and does NOT select. */
export function fenceSlotPress(
  fence: FenceTypeDef, onSelect: (id: string) => void, openInfo: (f: FenceTypeDef) => void,
): { onTap: () => void; onHold: () => void } {
  return { onTap: () => onSelect(fence.id), onHold: () => openInfo(fence) };
}

/** The first owned special the player has not been shown yet (standard needs no card). */
export function firstUnseenFence(owned: readonly FenceTypeDef[], seen: (id: string) => boolean): FenceTypeDef | undefined {
  return owned.find(f => f.id !== STANDARD_FENCE_ID && !seen(f.id));
}

/**
 * Owning a special is meeting the slot system, so it is filed in the Manual
 * then: a Head Start certificate can start a run past level 3, where it is
 * otherwise filed. A bar holding only the standard fence teaches nothing.
 */
export function shouldFileFenceManual(ownedCount: number): boolean {
  return ownedCount > 1;
}

/**
 * The one line that says what a type COSTS. Every special fence is paid for in
 * build speed, and that is invisible on the board until a ball is racing your
 * cut, which is far too late to learn it. The standard fence costs nothing.
 */
export function fenceSpeedLine(buildSpeed: number): { key: "fenceTypes.buildsSlower" | "fenceTypes.buildsFaster"; percent: number } | null {
  if (buildSpeed === 1) return null;
  const percent = Math.round(Math.abs(1 - buildSpeed) * 100);
  return { key: buildSpeed < 1 ? "fenceTypes.buildsSlower" : "fenceTypes.buildsFaster", percent };
}

/** The fence card's footer: the choice is a mode that stays selected. */
export const FENCE_INFO_FOOTER_KEY = "fenceTypes.staysSelected";

/** The heading over a card's "how to use" line, shared by fence and ability cards. */
export const HOW_TO_USE_KEY = "abilityInfo.howToUse";

// ── Abilities ──────────────────────────────────────────────────────────────

/** One button per ability the player has a charge of, in catalogue order. */
export function ownedAbilities(charges: Record<string, number>): AbilityDef[] {
  return getAllAbilities().filter(a => (charges[a.id] ?? 0) > 0);
}

/** Abilities whose charge count ROSE: a fresh grant or a count-up blinks its button. */
export function gainedAbilityIds(prev: Record<string, number>, next: Record<string, number>): string[] {
  return getAllAbilities().map(a => a.id).filter(id => (next[id] ?? 0) > (prev[id] ?? 0));
}

/**
 * What the ability bar draws: nothing at all until the first charge (the row
 * takes no space then), the explainer alone if its ability just ran out while
 * it was open, else the row.
 */
export function abilityBarShape(ownedCount: number, infoOpen: boolean): "none" | "infoOnly" | "row" {
  if (ownedCount > 0) return "row";
  return infoOpen ? "infoOnly" : "none";
}

/** The armed button (a targeted ability awaiting a board tap) is filled and ringed. */
export function abilityButtonLook(armed: boolean): { fillAlpha: number; ring: boolean } {
  return armed ? { fillAlpha: 0x44 / 255, ring: true } : { fillAlpha: 0x1f / 255, ring: false };
}

/** Tap fires (or arms) the ability; hold opens its explainer instead. */
export function abilityPress(
  ability: AbilityDef, onUse: (id: string) => void, openInfo: (a: AbilityDef) => void,
): { onTap: () => void; onHold: () => void } {
  return { onTap: () => onUse(ability.id), onHold: () => openInfo(ability) };
}

/** The blink on a gained charge: framer-motion's opacity keyframes, kept. */
export const ABILITY_BLINK = { duration: 0.85, keyframes: [0, 1, 0.3, 1, 0], times: [0, 0.15, 0.4, 0.65, 1] } as const;

/** What the ability card shows. No acquisition footer: it opens off an ability already held. */
export function abilityInfoLines(ability: AbilityDef, t?: TFunction): { description?: string; howTo?: string } {
  // Through the content locales when a `t` is given (the English YAML is the fallback).
  const description = t ? contentText.abilityDesc(t, ability) : ability.description;
  const howTo = t ? contentText.abilityHowTo(t, ability) : ability.howTo;
  return { description: description || undefined, howTo: howTo || undefined };
}

// ── Ability glyphs ─────────────────────────────────────────────────────────

/** An 8-spike starburst = explosion (Shockwave), in lucide's stroke style. */
const EXPLOSION: IconSource = [
  ["path", { d: "M12 2 L13.5 8.3 L19.1 4.9 L15.7 10.5 L22 12 L15.7 13.5 L19.1 19.1 L13.5 15.7 L12 22 L10.5 15.7 L4.9 19.1 L8.3 13.5 L2 12 L8.3 10.5 L4.9 4.9 L10.5 8.3 Z" }],
];

/** A clock shifted right with three speed lines to its left (Fence Overclock). */
const RUSH_CLOCK: IconSource = [
  ["circle", { cx: 15, cy: 12, r: 6.5 }],
  ["path", { d: "M15 8.5 L15 12 L17.5 13.5" }],
  ["line", { x1: 2, y1: 8, x2: 6, y2: 8 }],
  ["line", { x1: 1, y1: 12, x2: 6, y2: 12 }],
  ["line", { x1: 2, y1: 16, x2: 6, y2: 16 }],
];

/**
 * Every effect kind's glyph. Exhaustive by type: a new kind will not compile
 * until it is given one (there were once two maps, and one fell four kinds
 * behind without anybody noticing).
 */
const GLYPH_BY_KIND: Record<AbilityKind, IconSource> = {
  freeze: Snowflake,
  slow: Snail,
  slowArea: Hourglass,
  descope: Scissors,
  clearFences: Eraser,
  magnet: Magnet,
  shockwave: EXPLOSION,
  rubberBand: Spline,
  fenceRush: RUSH_CLOCK,
  fenceShield: Shield,
};

/**
 * The glyph for an effect kind. Falls back to a sparkle rather than nothing: a
 * kind this does not know is a data problem, and an empty space says less
 * about it than a placeholder does.
 */
export function abilityGlyph(kind: string): IconSource {
  return GLYPH_BY_KIND[kind as AbilityKind] ?? Sparkles;
}

// ── The context lane ───────────────────────────────────────────────────────

export interface LiveTimer {
  kind: string;
  name: string;
  color: number;
  /** Share of the duration left, 0..1. */
  frac: number;
  secsLeft: number;
}

/**
 * The running time-based abilities at `now`. A row is dropped the moment its
 * remaining time hits zero, so the bar never lingers a second past the effect.
 */
export function liveTimers(timers: readonly AbilityTimer[], now: number): LiveTimer[] {
  return timers.filter(tmr => tmr.endMs - now > 0).map(tmr => {
    const remainingMs = tmr.endMs - now;
    return {
      kind: tmr.kind,
      name: tmr.name,
      color: cssColor(tmr.color),
      frac: Math.max(0, Math.min(1, remainingMs / tmr.durationMs)),
      secsLeft: Math.max(0, Math.ceil(remainingMs / 1000)),
    };
  });
}

/**
 * How the timers share the one fixed-height lane. One timer is the DOM's line
 * (name, bar, seconds). Several used to stack as extra rows, which the lane no
 * longer has room for, so they sit side by side instead, each a small cell.
 */
export function countdownLayout(count: number): "line" | "cells" {
  return count > 1 ? "cells" : "line";
}

export interface ShipEarlyView {
  /** Share of the time limit left, 0..1: the bar's fill. */
  remaining: number;
  secondsLeft: number;
  /** Hours of tempo bonus still on the table; 0 once every window has passed. */
  payoutHours: number;
  /** Green -> red as it drains, so it doubles as the deadline warning. */
  color: number;
  /** Where each Ship Early payout rung expires, as a share of the bar from the left. Only rungs inside the limit. */
  ticks: { key: number; at: number }[];
}

/**
 * The map countdown. Null (nothing drawn) without a time limit, which is the
 * tutorial band. The Ship Early windows scale with the map's workload:
 * (withinSecondsPerBall + Deadline Extension) x ball count.
 */
export function shipEarlyView(p: {
  seconds: number; ballCount: number; timeLimit: number; extraSecondsPerBall?: number; bonusMultiplier?: number;
}): ShipEarlyView | null {
  const { seconds, timeLimit } = p;
  if (!(timeLimit > 0)) return null;
  const balls = p.ballCount > 0 ? p.ballCount : 1;
  const extra = (p.extraSecondsPerBall ?? 0) > 0 ? p.extraSecondsPerBall! : 0;
  const mult = p.bonusMultiplier ?? 1;
  const windowFor = (perBall: number) => (perBall + extra) * balls;
  const remaining = Math.max(0, 1 - seconds / timeLimit);
  // Ship Early is the TEMPO axis, so the chip advertises hours still on the
  // table: the same window is worth the same to every run.
  const tempoCeiling = getAxisCeilings().tempo * (mult > 0 ? mult : 1);
  const payoutHours = Math.round(
    tempoCeiling * tempoRatio(getShipEarlyPercent(seconds, balls, extra), getShipEarlyMaxPercent()),
  );
  return {
    remaining,
    secondsLeft: Math.max(0, Math.ceil(timeLimit - seconds)),
    payoutHours,
    color: cssColor(deadlineColor(remaining)),
    ticks: getShipEarlyThresholds()
      .filter(s => windowFor(s.withinSecondsPerBall) < timeLimit)
      .map(s => ({ key: s.withinSecondsPerBall, at: 1 - windowFor(s.withinSecondsPerBall) / timeLimit })),
  };
}

/** The chip: the bonus still attainable early on, then a plain seconds-left countdown. */
export function shipEarlyChip(v: ShipEarlyView): { key: "shipEarlyBar.bonus"; values: { hours: number } } | { key: "shipEarlyBar.seconds"; values: { s: number } } {
  return v.payoutHours > 0
    ? { key: "shipEarlyBar.bonus", values: { hours: v.payoutHours } }
    : { key: "shipEarlyBar.seconds", values: { s: v.secondsLeft } };
}

/** The message's words. */
export function gameMessageKey(m: GameMessage): string {
  return `gameMessages.${m.id}`;
}
