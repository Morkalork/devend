/**
 * The ascension rules announce themselves on level 1, and not on every map.
 *
 * Reported as "it shows the ascension modal for every map right now". The gate
 * was a `useRef` holding which depth had been announced, written to fire once
 * per depth rather than once per map. The reasoning was right and the mechanism
 * could not deliver it: Index renders GameScreen only while
 * `currentScreen === 'game'` and the level-complete overlay is down, so the
 * component unmounts after EVERY map - through the overlay, the shop, every
 * draft - and the ref went back to null with it. A ref cannot remember
 * something across the remount it is supposed to survive.
 *
 * Level 1 replaces the memory rather than repairing it. An ascension always
 * restarts at level 1, so the level number IS the event, and it cannot be
 * forgotten because it is not remembered.
 *
 * These call the SAME function the effect calls. Re-stating the condition here
 * would be a second reading of one fact, and would stay green while GameScreen
 * drifted away from it - which is how the original survived.
 */
import { describe, it, expect } from "vitest";
import { shouldAnnounceAscension } from "@/lib/ascensionLadder";
import type { AscensionRung } from "@/types/loadout";

const LADDER: AscensionRung[] = [
  { depth: 1, name: "Hiring Freeze", description: "The store opens every other level." },
  { depth: 2, name: "Reduced Headcount", description: "Two contracts, not three." },
];

describe("the ascension rules modal opens once per depth", () => {
  it("opens on level 1 of an ascended run", () => {
    expect(shouldAnnounceAscension(1, 1, LADDER)).toBe(true);
    expect(shouldAnnounceAscension(2, 1, LADDER)).toBe(true);
  });

  it("stays shut on every other map of that run", () => {
    // The report, exactly: an ascended run reopened it on all 35 maps.
    for (const level of [2, 3, 12, 34, 35]) {
      expect(shouldAnnounceAscension(1, level, LADDER), `level ${level} reopened it`).toBe(false);
    }
  });

  it("stays shut at depth 0, where there are no rules to announce", () => {
    // A first run has no ladder in force, so a modal would interrupt to say
    // nothing at all.
    expect(shouldAnnounceAscension(0, 1, LADDER)).toBe(false);
    expect(shouldAnnounceAscension(0, 7, LADDER)).toBe(false);
  });

  it("opens past the ladder's end, where the rungs still all apply", () => {
    // No NEW rung lands, but every earlier one is still in force, and a player
    // returning to level 1 at depth 9 is owed the reminder.
    expect(shouldAnnounceAscension(9, 1, LADDER)).toBe(true);
    expect(shouldAnnounceAscension(9, 2, LADDER)).toBe(false);
  });

  it("stays shut when the ladder failed to load", () => {
    // loadouts.yml can fail; an empty ladder must not open an empty modal.
    expect(shouldAnnounceAscension(3, 1, [])).toBe(false);
  });

  it("does not depend on being remembered between maps", () => {
    // The heart of it. The old guard was per-mount state, and GameScreen is
    // remounted between maps, so the answer had to be derivable from the props
    // alone. Calling it repeatedly, as a series of fresh mounts would, must give
    // the same answer every time for the same map.
    const asFreshMounts = [1, 2, 3].map(() => shouldAnnounceAscension(1, 5, LADDER));
    expect(asFreshMounts).toEqual([false, false, false]);
  });
});
