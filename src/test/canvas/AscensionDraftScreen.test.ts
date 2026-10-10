/**
 * The canvas finale (AscensionDraftScreen), carried over from
 * ascensionFinale.test.tsx: it leads with the win and says what ascending
 * would switch on BEFORE the choice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AscensionRung } from "@/types/loadout";
import { ascensionBriefing } from "@/ui/screens/draftModel";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/screens/AscensionDraftScreen.tsx"), "utf8");

const LADDER: AscensionRung[] = [
  { depth: 1, name: "Hiring Freeze", description: "The store opens every other level." },
  { depth: 2, name: "Reduced Headcount", description: "Assignments offer two contracts, not three." },
  { depth: 3, name: "Promotion Freeze", description: "No Promotion is awarded this run." },
];

describe("it congratulates the player for winning", () => {
  it("leads with the win, and says so again for a player who won at depth", () => {
    expect(SRC).toMatch(/title=\{t\("ascension\.youWin"\)\}/);
    expect(SRC).toMatch(/ascensionDepth > 0 \? t\("ascension\.congratsAscended", \{ depth: ascensionDepth \}\) : t\("ascension\.congrats"\)/);
  });
});

describe("it says what ascending would do, before the choice", () => {
  it("names the rung the next depth switches on", () => {
    const b = ascensionBriefing(0, LADDER);
    expect(b.nextDepth).toBe(1);
    expect(b.incoming?.name).toBe("Hiring Freeze");
    expect(SRC).toMatch(/contentText\.rungDesc\(t, incoming\)/);
  });

  it("moves on to the next rung at the next depth", () => {
    const b = ascensionBriefing(2, LADDER);
    expect(b.nextDepth).toBe(3);
    expect(b.incoming?.name).toBe("Promotion Freeze");
  });

  it("reminds the player what is already in force, named, not described", () => {
    expect(ascensionBriefing(2, LADDER).alreadyInForce.map(r => r.name)).toEqual(["Hiring Freeze", "Reduced Headcount"]);
    expect(SRC).toMatch(/alreadyInForce\.map\(r => contentText\.rungName\(t, r\)\)\.join\(", "\)/);
  });

  it("says nothing is added once the ladder is fully climbed, or with no ladder at all", () => {
    expect(ascensionBriefing(LADDER.length, LADDER).incoming).toBeNull();
    expect(ascensionBriefing(0, []).incoming).toBeNull();
    expect(SRC).toMatch(/t\("ascension\.noNewRung"\)/);
  });
});
