/**
 * The canvas goal chip says what the DOM one said (goalReadouts.test.tsx,
 * goalTracker.test.ts "the chip actually asks"), checked against its pure model.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { Goal } from "@/lib/goalTracker";
import { hex } from "@/ui/theme";
import { GOAL_AT_RISK, GOAL_OVER, goalChipAria, goalChipLabel, goalChipLook } from "@/ui/game/goalChipModel";

const t = i18n.t.bind(i18n);
const ACCENT = hex("#00ff88");
const CLEAR = t("topBar.clear");

const gate = (over: Partial<Goal> = {}): Goal => ({
  key: "superiorLocks", kind: "superiorLocks", tier: "requirement",
  labelKey: "winGate.superiorLocks", current: 0, target: 1,
  done: false, over: false, progress: null, ...over,
});

const look = (g: Goal, atRisk = false, winMet = false) => goalChipLook(g, ACCENT, atRisk, winMet, CLEAR);

describe("the requirement chip", () => {
  it("says how far along you are, not merely that a rule exists", () => {
    expect(look(gate({ current: 1, target: 3 })).shown).toBe("1/3");
  });

  it("names the requirement in words", () => {
    expect(goalChipLabel(t, gate())).toMatch(/Superior/i);
  });

  it("names the actual ball on a seal-this-type map", () => {
    // "Seal a ball" and "seal a LODESTONE" are different maps.
    const g = gate({ kind: "lockType", labelKey: "winGate.lockType", ballType: "Lodestone" });
    expect(goalChipLabel(t, g)).toMatch(/Lodestone/);
  });

  it("lights up the moment it is satisfied", () => {
    const l = look(gate({ current: 1, done: true }));
    expect(l.shown).toBe("1/1");
    expect(l.color).toBe(ACCENT);
    expect(l.glow, "a satisfied goal does not glow").toBe(ACCENT);
  });

  it("does not light up for a constraint that has merely not been blown yet", () => {
    // A limit clause reads as `met` from the first frame; it is not banked.
    const l = look(gate({ kind: "underPar", labelKey: "winGate.underPar", done: false }));
    expect(l.shown).toBe("0/1");
    expect(l.color).not.toBe(ACCENT);
    expect(l.glow).toBeNull();
  });

  it("shows a budget over par in amber, not in the red that means a lost map", () => {
    const l = look(gate({ kind: "par", tier: "budget", labelKey: "goal.par", current: 9, target: 8, over: true }));
    expect(l.shown).toBe("9/8");
    expect(l.color).toBe(GOAL_OVER);
    expect(l.color).not.toBe(GOAL_AT_RISK);
  });

  it("warns in red only when one lock would strand the map", () => {
    const l = look(gate(), true);
    expect(l.color).toBe(GOAL_AT_RISK);
    expect(goalChipAria(t, goalChipLabel(t, gate()), l.value, true)).toContain(t("winGate.atRisk", { label: goalChipLabel(t, gate()) }));
  });

  it("shows a tally as a bare number, never as a fraction over zero", () => {
    const l = look(gate({ kind: "locks", tier: "tally", labelKey: "winGate.locks", current: 2, target: null }));
    expect(l.shown).toBe("2");
    expect(l.shown).not.toBe("2/0");
  });

  it("says CLEAR rather than a fraction once the map is won", () => {
    const space = gate({ kind: "space", labelKey: "winGate.space", unit: "percent", current: 88, target: 85, done: true });
    expect(look(space, false, true).shown).toBe("CLEAR");
  });

  it("keeps the number on a cleared board whose map wants something else", () => {
    // Level 13: "clear to 14% AND smash one slab".
    const space = gate({ kind: "space", labelKey: "winGate.space", unit: "percent", current: 88, target: 85, done: true });
    const l = look(space, false, false);
    expect(l.shown, "the bar announced a win the map had not granted").not.toBe("CLEAR");
    expect(l.shown).toBe("88/85%");
  });

  it("only the space chip ever says CLEAR", () => {
    expect(look(gate({ current: 1, done: true }), false, true).shown).toBe("1/1");
  });

  it("marks a percent goal as a percentage", () => {
    expect(look(gate({ kind: "space", labelKey: "winGate.space", unit: "percent", current: 60, target: 85 })).shown).toBe("60/85%");
  });
});

describe("the chip actually asks", () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

  it("gates CLEAR on the whole map being won", () => {
    expect(read("src/ui/game/goalChipModel.ts")).toContain("goal.done && goal.kind === 'space' && winMet");
  });

  it("is told by the bar, which computes it once for the row", () => {
    const bar = read("src/ui/game/GameTopBar.tsx");
    expect(bar).toContain("everyRequirementMet(goals ?? [])");
    expect(bar, "the chip is left to guess").toContain("winMet={winMet}");
  });

  it("opens the how-to-win text when tapped", () => {
    // The chip is the short form; a tap hands over to the full wording.
    expect(read("src/ui/game/GoalChip.tsx")).toContain("usePress({ onTap: onExplain })");
  });
});
