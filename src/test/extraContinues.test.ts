/**
 * Mid-run Continue grants credit against a high-water mark and re-baseline on
 * a restore (src/lib/extraContinues.ts). The bug: resuming a saved run
 * restored its upgrades, the extraContinues modifier rose from 0 back to N,
 * and that read as a fresh grant, so every resume refilled the Continues.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { creditExtraContinues, type ExtraContinuesMark } from "@/lib/extraContinues";

/** Feed a sequence of modifier values through, as the session's effect does. */
function credited(values: (number | "rebaseline")[]): number {
  let mark: ExtraContinuesMark = null;
  let total = 0;
  for (const v of values) {
    if (v === "rebaseline") {
      mark = null;
      continue;
    }
    const r = creditExtraContinues(mark, v);
    mark = r.mark;
    total += r.credit;
  }
  return total;
}

describe("creditExtraContinues", () => {
  it("credits a grant bought mid-run", () => {
    expect(credited([0, 1])).toBe(1);
    expect(credited([0, 1, 2])).toBe(2);
  });

  it("does not credit the value a run starts on", () => {
    expect(credited([1])).toBe(0);
  });

  // The reported bug: menu (0) -> resume restores the upgrades (2). The save
  // already holds those Continues, so nothing may be added.
  it("credits nothing when a save is resumed, however many times", () => {
    expect(credited([0, "rebaseline", 2])).toBe(0);
    expect(credited([0, "rebaseline", 2, 0, "rebaseline", 2, 0, "rebaseline", 2])).toBe(0);
  });

  it("never pays the same Continue twice when the modifier dips and recovers", () => {
    expect(credited([0, 1, 0, 1, 0, 1])).toBe(1);
  });

  it("still pays a real grant after a resume", () => {
    expect(credited(["rebaseline", 1, 2])).toBe(1);
  });
});

describe("the session re-baselines on every reset and restore", () => {
  const src = readFileSync(resolve(process.cwd(), "src/hooks/useGameSession.ts"), "utf8");

  it("restoring a save re-baselines", () => {
    const at = src.indexOf("setContinuesRemaining(save.continuesRemaining);");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 400)).toContain("extraContinuesSeen.current = null;");
  });

  it("every fresh run re-baselines", () => {
    const resets = src.split("setContinuesRemaining(BASE_CONTINUES + ").length - 1;
    const rebaselines = src.split("extraContinuesSeen.current = null;").length - 1;
    expect(resets).toBeGreaterThan(0);
    expect(rebaselines).toBe(resets + 1);
  });
});
