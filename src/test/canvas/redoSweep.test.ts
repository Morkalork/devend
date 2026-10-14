/**
 * The last screens brought onto the redo (UI_REDO_PLAN.md, "The sweep"):
 * Achievements, Certificates, the Debrief's certificate row, the run result's
 * facts, the Records heading and the pair lobby.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ledgerHasMarks } from "@/ui/kit/pipelineStyle";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the ledger's mark column", () => {
  it("is kept only when some row has a mark", () => {
    expect(ledgerHasMarks([{ label: "a", tone: "note" }, { label: "b" }])).toBe(false);
    expect(ledgerHasMarks([{ label: "a", tone: "note" }, { label: "b", tone: "pass" }])).toBe(true);
    expect(ledgerHasMarks([{ label: "t", tone: "total" }])).toBe(true);
  });

  it("puts the map's id under its row on the run result, not on a row of its own", () => {
    const src = read("src/ui/screens/ResultScreen.tsx");
    expect(src).toContain("detail: levelId");
    expect(src).not.toContain("{ label: levelId, tone: \"note\" }");
  });
});

describe("no screen left in the old look", () => {
  it("draws Achievements without the monospace body or the breathing button", () => {
    const src = read("src/ui/screens/AchievementsScreen.tsx");
    expect(src).not.toContain('font="mono"');
    expect(src).not.toContain("usePulse");
    expect(src).toContain("<ArcadeButton");
  });

  it("left-aligns Certificates and calls its way out Back", () => {
    const src = read("src/ui/screens/CertificateStore.tsx");
    expect(src).not.toContain('alignItems: "center", gap: 24');
    expect(src).toContain('text={t("common.back")}');
    expect(src).not.toContain("RADIUS.lg");
  });

  it("uses one certificate-unlocked row in the store and the Debrief", () => {
    expect(read("src/ui/screens/LevelCompleteOverlay.tsx")).toContain("<CertUnlockedRow key={cert.id} cert={cert} />");
  });

  it("sets no heading in extra-wide tracking", () => {
    for (const f of ["HallOfFameScreen", "OffersScreen", "CertificateStore"]) {
      expect(read(`src/ui/screens/${f}.tsx`), f).not.toContain("letterSpacing={1.2} maxWidth");
    }
  });

  it("starts the pair lobby under its header", () => {
    expect(read("src/ui/screens/PairLobby.tsx")).toContain('minHeight: bodyHeight, justifyContent: "flex-start"');
  });
});
