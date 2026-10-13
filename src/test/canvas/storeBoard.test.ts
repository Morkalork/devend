/**
 * The store as a sprint board (src/ui/screens/storeBoardModel.ts): offers are
 * tickets in a backlog, the overtime is the sprint's capacity, and a pick is
 * a ticket committed to the sprint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import {
  STATUS_KEY, capacityShare, fundedShare, priorityRank, shortfall, ticketKey, unavailable, wontFit, type TicketStatus,
} from "@/ui/screens/storeBoardModel";
import { pipsFor } from "@/ui/screens/carouselModel";
import { missingPrereqs } from "@/ui/screens/shopModel";
import type { UpgradeConfig } from "@/types/upgrade";

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
      for (const key of ["sprintTitle", "sprintCapacity", "sprintEmpty", "backlog", "blockedBy", "shortBy", "sprintWontFit_one", "sprintWontFit_other"]) {
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

describe("what cannot be bought (blocked or unfunded)", () => {
  it("counts exactly the two reasons as out of reach", () => {
    const all: TicketStatus[] = ["inSprint", "done", "blocked", "unfunded", "todo"];
    expect(all.filter(unavailable)).toEqual(["blocked", "unfunded"]);
  });

  it("says how many hours an unfunded ticket is short", () => {
    expect(shortfall(56, 50)).toBe(6);
    expect(shortfall(30, 50)).toBe(0);
    // Over-committed (a negative remainder) is short of the whole price, not more.
    expect(shortfall(30, -10)).toBe(30);
  });

  it("fills the funding bar with the share the hours left would cover", () => {
    expect(fundedShare(56, 42)).toBe(0.75);
    expect(fundedShare(56, 100)).toBe(1);
    expect(fundedShare(0, 0)).toBe(1);
  });

  it("tells the sprint how many won't fit and the closest shortfall", () => {
    const tickets = [
      { status: "unfunded" as const, price: 80 },
      { status: "unfunded" as const, price: 56 },
      { status: "blocked" as const, price: 200 },
      { status: "todo" as const, price: 20 },
    ];
    expect(wontFit(tickets, 50)).toEqual({ count: 2, closest: 6 });
    expect(wontFit([{ status: "todo", price: 20 }], 50)).toBeNull();
  });

  it("hollows the dots of what is out of reach, never of what is picked", () => {
    const pips = pipsFor(3, 0, [true, false, false], [true, true, false]);
    expect(pips.map(p => p.unavailable)).toEqual([false, true, false]);
  });

  it("links a blocked ticket to each missing prerequisite", () => {
    const jr = { id: "jr", name: "Jr" } as UpgradeConfig;
    const sr = { id: "sr", name: "Sr", prerequisites: ["jr"] } as UpgradeConfig;
    expect(missingPrereqs(sr, [jr, sr], []).map(u => u.id)).toEqual(["jr"]);
    expect(missingPrereqs(sr, [jr, sr], ["jr"])).toEqual([]);
  });

  it("is wired through the store: the link jumps the strip, the dots and the sprint line are fed", () => {
    const shop = read("src/ui/screens/UpgradeShop.tsx");
    expect(shop).toContain("unavailable={outOfReach}");
    expect(shop).toContain("focus={jump}");
    expect(shop).toContain("wontFit={notFitting}");
    expect(read("src/ui/screens/shopParts.tsx")).toContain("onTap={() => onJump(shelfIndex)}");
  });

  it("has a gallery shelf that shows all three side by side", () => {
    expect(read("src/ui/dev/gallery/between.tsx")).toContain('id: "UpgradeShop-reach"');
  });
});
