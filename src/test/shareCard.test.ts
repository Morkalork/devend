/**
 * Share card (HIGHSCORES.md Phase E): the pure line layout. Canvas drawing
 * itself is exercised in a real browser (jsdom has no 2D context; the
 * renderer returns null there, which the last test pins down).
 */
import { describe, it, expect } from "vitest";
import { buildShareLines, renderShareCard, ShareCardData, ShareCardLabels } from "@/lib/shareCard";

const data = (over: Partial<ShareCardData> = {}): ShareCardData => ({
  score: 612,
  levelNumber: 23,
  ascensionDepth: 0,
  buildLine: "Lock-Risk: Vault Keeper",
  capstoneName: "Golden Handshake",
  rank: 3,
  dailyKey: null,
  dailyStreak: 0,
  isWin: false,
  ...over,
});

const labels = (over: Partial<ShareCardLabels> = {}): ShareCardLabels => ({
  title: "Dev/End",
  bankedOvertime: "Banked Overtime",
  reachedLevel: "Level 23",
  rankLine: "Rank #3 all time",
  dailyLine: null,
  outcome: "Game Over",
  ...over,
});

describe("buildShareLines", () => {
  it("orders outcome, build, capstone, rank", () => {
    expect(buildShareLines(data(), labels())).toEqual([
      "Game Over",
      "Lock-Risk: Vault Keeper",
      "Golden Handshake",
      "Rank #3 all time",
    ]);
  });

  it("adds depth and the daily tag, omits absent pieces", () => {
    const lines = buildShareLines(
      data({ capstoneName: null, ascensionDepth: 2, rank: null, dailyKey: "2026-07-17" }),
      labels({ rankLine: null, dailyLine: "Daily Stand-up 2026-07-17", outcome: "You Win!" }),
    );
    expect(lines).toEqual(["You Win!", "Lock-Risk: Vault Keeper", "↑ 2", "Daily Stand-up 2026-07-17"]);
  });
});

describe("renderShareCard", () => {
  it("degrades to null without a 2D context (jsdom)", () => {
    expect(renderShareCard(data(), labels())).toBeNull();
  });
});
