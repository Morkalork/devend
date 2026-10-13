/**
 * The store as a sprint board (UI_REDO_PLAN.md, the store follow-up): each
 * offer is a ticket in the backlog, the overtime is the sprint's capacity and
 * a pick is a ticket committed to the sprint. These are the board's rules as
 * data, so they can be tested without drawing a canvas.
 */
import type { UpgradeTier } from "@/types/upgrade";
import type { CardModel } from "./shopModel";

/** Where a ticket stands, in the order the checks run. */
export type TicketStatus = "inSprint" | "done" | "blocked" | "unfunded" | "todo";

export function ticketStatus(m: Pick<CardModel, "selected" | "owned" | "locked" | "cantAfford">): TicketStatus {
  if (m.selected) {
    return "inSprint";
  }
  if (m.owned) {
    return "done";
  }
  if (m.locked) {
    return "blocked";
  }
  if (m.cantAfford) {
    return "unfunded";
  }
  return "todo";
}

/** The locale key of each status's lozenge. */
export const STATUS_KEY: Record<TicketStatus, string> = {
  inSprint: "upgradeShop.statusInSprint",
  done: "upgradeShop.statusDone",
  blocked: "upgradeShop.statusBlocked",
  unfunded: "upgradeShop.statusUnfunded",
  todo: "upgradeShop.statusTodo",
};

/**
 * A ticket's key, "DEV-214": the project prefix and a three-digit number
 * hashed from the upgrade's id, so the same upgrade always carries the same
 * key, visit after visit and run after run, the way a real ticket would.
 */
export function ticketKey(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `DEV-${100 + ((h >>> 0) % 900)}`;
}

/**
 * The tier read as a priority, the way a board ranks tickets: one step per
 * tier, from a single chevron down (Junior) to a flame (Wizard). It is the
 * tier's own colour that carries it, so this is only the glyph's rank.
 */
const PRIORITY_RANK: Record<UpgradeTier, number> = { Junior: 0, Senior: 1, Principal: 2, Architect: 3, Wizard: 4 };

export function priorityRank(tier: UpgradeTier): number {
  return PRIORITY_RANK[tier] ?? 0;
}

/** Committed hours as a share of the sprint's capacity, clamped to 0..1. */
export function capacityShare(committed: number, capacity: number): number {
  if (capacity <= 0) {
    return committed > 0 ? 1 : 0;
  }
  return Math.max(0, Math.min(1, committed / capacity));
}

/**
 * The two reasons a ticket cannot be bought, which ask different things of the
 * player: a BLOCKED ticket needs another ticket first, an UNFUNDED one needs
 * hours. Anything else (to do, in the sprint, done) is available or settled.
 */
export function unavailable(status: TicketStatus): boolean {
  return status === "blocked" || status === "unfunded";
}

/** How many hours an unfunded ticket is short of, given what is left to spend. */
export function shortfall(price: number, remaining: number): number {
  return Math.max(0, price - Math.max(0, remaining));
}

/** How much of a ticket's price the hours left would cover, 0..1: the ticket's funding bar. */
export function fundedShare(price: number, remaining: number): number {
  if (price <= 0) {
    return 1;
  }
  return Math.max(0, Math.min(1, remaining / price));
}

/**
 * The sprint panel's "won't fit" line: how many backlog tickets the hours
 * left cannot pay for, and the smallest shortfall among them (the one the
 * player is closest to). Null when everything still fits.
 */
export function wontFit(tickets: { status: TicketStatus; price: number }[], remaining: number): { count: number; closest: number } | null {
  const short = tickets.filter(x => x.status === "unfunded").map(x => shortfall(x.price, remaining));
  if (short.length === 0) {
    return null;
  }
  return { count: short.length, closest: Math.min(...short) };
}
