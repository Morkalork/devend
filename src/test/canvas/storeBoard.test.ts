/**
 * The store as a sprint board (src/ui/screens/storeBoardModel.ts): offers are
 * tickets in a backlog, the overtime is the sprint's capacity, and a pick is
 * a ticket committed to the sprint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { STATUS_KEY, capacityShare, priorityRank, ticketKey, type TicketStatus } from "@/ui/screens/storeBoardModel";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("ticketKey", () => {
  it("is a DEV- key with three digits", () => {
    for (const id of ["fast_compile_junior", "memory_footprint_principal", "a", ""]) {
      expect(ticketKey(id)).toMatch(/^DEV-[1-9]\d{2}$/);
    }
  });

  // A ticket that changed its number between visits would read as a new ticket.
  it("is the same for the same upgrade, every time", () => {
    expect(ticketKey("fast_compile_junior")).toBe(ticketKey("fast_compile_junior"));
  });

  it("tells the tiers of one family apart", () => {
    expect(ticketKey("fast_compile_junior")).not.toBe(ticketKey("fast_compile_senior"));
  });
});

describe("priority", () => {
  it("rises one step per tier", () => {
    const ranks = (["Junior", "Senior", "Principal", "Architect", "Wizard"] as const).map(priorityRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("capacity", () => {
  it("is the committed share of the hours, clamped", () => {
    expect(capacityShare(30, 120)).toBe(0.25);
    expect(capacityShare(200, 120)).toBe(1);
    expect(capacityShare(0, 0)).toBe(0);
  });
});

describe("the board's words", () => {
  it("has every status and the sprint's labels in every locale", () => {
    for (const lng of ["en", "es", "sv"]) {
      const t = i18n.getFixedT(lng);
      for (const status of Object.keys(STATUS_KEY) as TicketStatus[]) {
        expect(t(STATUS_KEY[status]), `${lng} ${status}`).not.toBe(STATUS_KEY[status]);
      }
      for (const key of ["sprintTitle", "sprintCapacity", "sprintEmpty", "backlog"]) {
        expect(t(`upgradeShop.${key}`), `${lng} ${key}`).not.toBe(`upgradeShop.${key}`);
      }
    }
  });
});

describe("the store draws the board", () => {
  const shop = read("src/ui/screens/UpgradeShop.tsx");

  it("puts the sprint above the backlog and lets a committed line come back out", () => {
    expect(shop).toContain("<SprintPanel");
    expect(shop).toContain("onRemove={removeFromSprint}");
    expect(shop).toContain("handleItemClick(u, true);");
  });

  // The strip stays: testers asked for one card at a time (contentCopyBudget.test.ts).
  it("keeps the backlog as the one-at-a-time strip", () => {
    expect(shop).toContain("<Carousel");
    expect(shop).toContain("<TicketCard");
  });
});
