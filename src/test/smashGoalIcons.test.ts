/**
 * Shards and monoliths get different icons in the goal row.
 *
 * Reported from play: on a mixed map the two smash rows sat side by side under
 * one hammer, so the only way to tell them apart was to read their labels,
 * which is exactly what an icon row exists to save. The icon now follows the
 * clause's class, and a clause that counts either keeps the hammer.
 */
import { describe, it, expect } from "vitest";
import { Hammer } from "lucide-react";
import { mapGoals } from "@/lib/goalTracker";
import { goalIcon, SMASH_ICONS } from "@/components/game/goalIcons";
import { noSmashes, SMASH_CLASS_FILTERS } from "@/lib/destructibleClass";
import type { WinSnapshot, WinSpec } from "@/types/winSpec";

const snap: WinSnapshot = {
  remainingPercent: 100, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, lockPoints: [], mapRotation: 0, delivered: 0, smashed: noSmashes(),
  terminals: 0, harvested: 0, bossDefeated: false, allLocked: false, cuts: 0, par: 6,
  activeSeconds: 0,
};

const spec = (require: WinSpec["require"]): WinSpec => ({ require, alsoWinIf: [], authored: true });

describe("the goal row's smash icons", () => {
  it("gives every class filter an icon of its own", () => {
    const icons = SMASH_CLASS_FILTERS.map(f => SMASH_ICONS[f]);
    expect(new Set(icons).size).toBe(SMASH_CLASS_FILTERS.length);
  });

  it("draws two different icons for a shards row and a monoliths row", () => {
    const goals = mapGoals(spec([
      { kind: "smashed", count: 4, of: "shards" },
      { kind: "smashed", count: 1, of: "monoliths" },
    ]), snap).filter(g => g.kind === "smashed");
    expect(goals.map(g => g.smashClass)).toEqual(["shards", "monoliths"]);
    expect(goalIcon(goals[0])).not.toBe(goalIcon(goals[1]));
  });

  it("keeps the hammer for a clause that counts either class", () => {
    const [g] = mapGoals(spec([{ kind: "smashed", count: 2 }]), snap).filter(x => x.kind === "smashed");
    expect(g.smashClass).toBe("any");
    expect(goalIcon(g)).toBe(Hammer);
  });

  it("leaves every other kind's icon alone", () => {
    const [g] = mapGoals(spec([{ kind: "space", threshold: 20 }]), snap);
    expect(g.smashClass).toBeUndefined();
    expect(goalIcon(g)).not.toBe(Hammer);
  });
});
