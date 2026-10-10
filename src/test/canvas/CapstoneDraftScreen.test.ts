/**
 * The canvas Promotion draft (CapstoneDraftScreen). There was no DOM test for
 * this screen beyond the shared-card guard (DraftCard.test.ts); these pin the
 * behaviours that matter: a pick is required, a hold opens the briefing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/screens/CapstoneDraftScreen.tsx"), "utf8");

describe("the Promotion draft", () => {
  it("cannot be confirmed (or skipped) without a pick", () => {
    expect(SRC).toMatch(/disabled=\{!selectedId\}/);
    expect(SRC).not.toMatch(/onSelect\(null|skipButton|SkipForward/);
  });

  it("hands back the picked capstone itself", () => {
    expect(SRC).toMatch(/const pick = offers\.find\(c => c\.id === selectedId\);\s*if \(pick\) onSelect\(pick\);/);
  });

  it("opens the fuller briefing on hold, with the scope note", () => {
    expect(SRC).toMatch(/onLongPress=\{\(\) => setDetailId\(cap\.id\)\}/);
    expect(SRC).toMatch(/capstoneDraft\.scopeNote/);
    expect(SRC).toMatch(/contentText\.capstoneClarify\(t, detailCap\)/);
  });
});
