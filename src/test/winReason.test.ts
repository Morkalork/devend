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

const applyCutSrc = readFileSync(resolve(process.cwd(), "src/lib/physics/applyCut.ts"), "utf8");
const canvasSrc = readFileSync(resolve(process.cwd(), "src/components/game/GameCanvas.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(process.cwd(), "src/i18n/locales/en.json"), "utf8"));

const ALL_REASONS: WinReason[] = ["space", "allLocked", "boss", "area"];

describe("win reason reaches the results screen", () => {
  // Guards the wiring rather than the physics: reproducing a boss kill and a
  // gate-area lock end to end costs far more than it proves, and the thing that
  // actually breaks is a call site forgetting to say which win it is.
  it("tags every triggerLevelComplete call with a reason", () => {
    const calls = applyCutSrc.match(/triggerLevelComplete\(game[^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    const untagged = calls.filter(c => !ALL_REASONS.some(r => c.includes(`'${r}'`)));
    expect(untagged).toEqual([]);
  });

  it("uses each of the four reasons somewhere", () => {
    const used = ALL_REASONS.filter(r =>
      applyCutSrc.includes(`callbacks, '${r}')`) || canvasSrc.includes(`winReason: '${r}'`));
    expect(used.sort()).toEqual([...ALL_REASONS].sort());
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
