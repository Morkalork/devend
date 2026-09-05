/**
 * The results screen reports WHICH win condition finished the map.
 *
 * Four different wins funnel through triggerLevelComplete, and only a space
 * clear opens the Push Your Luck prompt. Without the label the prompt's coming
 * and going reads as random, which is exactly how it was reported.
 *
 * These tests pin the two things the label has to get right: every win path
 * states its own reason, and `wonByAllLocked` follows the reason instead of
 * being asserted unconditionally (it was hardcoded true here, so boss, area and
 * push-disabled space wins all hid a Remaining row that mattered).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WinReason } from "@/types/game";
import type { WinCondition, WinConditionKind, WinSnapshot } from "@/types/winSpec";
import { WIN_CONDITION_KINDS } from "@/types/winSpec";
import { winReasonFor } from "@/lib/winSpec";

const applyCutSrc = readFileSync(resolve(process.cwd(), "src/lib/physics/applyCut.ts"), "utf8");
const canvasSrc = readFileSync(resolve(process.cwd(), "src/components/game/GameCanvas.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(process.cwd(), "src/i18n/locales/en.json"), "utf8"));

const ALL_REASONS: WinReason[] = [
  "space", "allLocked", "boss", "area", "smashed", "delivered",
];

describe("win reason reaches the results screen", () => {
  /**
   * The four literal call sites this used to count are gone: the win is now
   * read from a WinSpec and one mapping function decides the reason. That is a
   * better thing to pin, because it can be checked EXHAUSTIVELY - a new
   * condition kind that nobody decided how to report is now a failure here
   * rather than a silent "space".
   */
  it("maps every win condition kind to a reason", () => {
    const snap: WinSnapshot = {
      remainingPercent: 0, lockedBalls: 9, superiorLocks: 9, areaTargets: 9,
      lockedByType: { black: 9 }, delivered: 0, smashed: 9, bossDefeated: true, allLocked: true,
      cuts: 0, par: 9, activeSeconds: 0,
    };
    const sample: Record<WinConditionKind, WinCondition> = {
      space: { kind: "space", threshold: 50 },
      locks: { kind: "locks", count: 1 },
      superiorLocks: { kind: "superiorLocks", count: 1 },
      area: { kind: "area", count: 1 },
      lockType: { kind: "lockType", ballType: "black", count: 1 },
      boss: { kind: "boss" },
      allLocked: { kind: "allLocked" },
    delivered: { kind: "delivered", count: 1 },
      smashed: { kind: "smashed", count: 1 },
      underPar: { kind: "underPar", delta: 0 },
      speedClear: { kind: "speedClear", seconds: 60 },
    };
    for (const kind of WIN_CONDITION_KINDS) {
      const reason = winReasonFor(
        { require: [sample[kind]], alsoWinIf: [], authored: true }, snap);
      expect(ALL_REASONS, `${kind} reported an unknown reason`).toContain(reason);
    }
  });

  it("uses every reason somewhere", () => {
    const snap: WinSnapshot = {
      remainingPercent: 0, lockedBalls: 9, superiorLocks: 9, areaTargets: 9,
      lockedByType: {}, delivered: 9, smashed: 9, bossDefeated: true, allLocked: true,
      cuts: 0, par: 9, activeSeconds: 0,
    };
    const reasonOf = (c: WinCondition) =>
      winReasonFor({ require: [c], alsoWinIf: [], authored: true }, snap);
    expect(reasonOf({ kind: "boss" })).toBe("boss");
    expect(reasonOf({ kind: "area", count: 1 })).toBe("area");
    expect(reasonOf({ kind: "allLocked" })).toBe("allLocked");
    expect(reasonOf({ kind: "space", threshold: 50 })).toBe("space");
    // Both of these returned undefined before they had a case here, and
    // undefined is what the results screen and the highscore ledger stored.
    expect(reasonOf({ kind: "smashed", count: 1 })).toBe("smashed");
    expect(reasonOf({ kind: "delivered", count: 1 })).toBe("delivered");
  });

  // The bug this change surfaced: the flag was a literal `true`, on a comment
  // claiming only one win reached that code.
  it("derives wonByAllLocked from the reason, never asserts it", () => {
    expect(applyCutSrc).toContain("wonByAllLocked: reason === 'allLocked'");
    expect(applyCutSrc).not.toContain("wonByAllLocked: true");
  });

  it("labels every reason in en.json, so none renders as a raw key", () => {
    for (const r of ALL_REASONS) {
      expect(en.levelComplete?.winReason?.[r], `missing label for ${r}`).toBeTruthy();
    }
    expect(en.levelComplete?.winReason?.label).toBeTruthy();
  });

  it("translates every reason in every locale", () => {
    for (const lang of ["es", "sv"]) {
      const loc = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), "utf8"));
      for (const r of [...ALL_REASONS, "label"]) {
        expect(loc.levelComplete?.winReason?.[r], `${lang} missing ${r}`).toBeTruthy();
      }
    }
  });
});
