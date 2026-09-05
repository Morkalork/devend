/**
 * Meeting a circuit stops the game and explains it.
 *
 * Terminals were FILED rather than shown: the "just met" effect called
 * fileManualEntry('circuit'), cleared the flag in the same breath, and badged
 * the Specs button. That is the right call for most mechanics - manual.ts
 * argues it well, and an interruption per mechanic is how the game ended up
 * with too many of them - but it draws one explicit line: anything that can
 * LOSE you the map if you meet it unwarned keeps its modal (Scope Creep, the
 * time limit, a boss).
 *
 * The `terminals` win clause moves circuits across that line. A wiring map can
 * now require terminals lit, and lighting one is a fence routed THROUGH a teal
 * dot - not something a player infers from the board. Seal your last ball
 * without doing it and the map is stranded: a life gone, to a rule nobody
 * stated. So it is a modal now, and still files the manual entry on dismiss so
 * it stays readable afterwards.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MANUAL_ENTRIES } from "@/lib/manual";

const SRC = readFileSync(
  resolve(process.cwd(), "src/components/game/GameScreen.tsx"), "utf8",
);

const queueBody = () => {
  const start = SRC.indexOf("const queue: Explainer[] = [");
  const end = SRC.indexOf("const active = queue.find", start);
  expect(start, "explainer queue not found").toBeGreaterThan(-1);
  return SRC.slice(start, end);
};

describe("the circuit explainer interrupts rather than filing quietly", () => {
  it("is in the modal queue", () => {
    expect(queueBody(), "circuits are still explained only in the Manual")
      .toContain("show: showCircuitOverlay");
  });

  it("is no longer filed-and-cleared behind the player's back", () => {
    // The exact shape of the old behaviour: an effect that files the entry and
    // clears the flag in the same statement, so the modal never renders.
    expect(SRC, "the file-and-clear effect is back, so the modal cannot show")
      .not.toMatch(/if \(showCircuitOverlay\) \{ fileManualEntry\('circuit'\)/);
  });

  it("still files the Manual entry, on dismiss", () => {
    // The modal is the interruption; the Manual is what makes it re-readable a
    // week later. Losing the filing would trade one problem for the other.
    expect(queueBody()).toContain("fileManualEntry('circuit')");
    expect(MANUAL_ENTRIES.map(e => e.id)).toContain("circuit");
  });

  it("uses the copy that already existed rather than new words", () => {
    expect(queueBody()).toContain("game.circuitTutorialTitle");
    expect(queueBody()).toContain("game.circuitTutorialBody");
  });

  it("remembers per map, so 16 and 31 still explain themselves", () => {
    // The key is per level id on purpose: level 15 introduces the circuit, 16
    // is the map whose whole point is lighting BOTH terminals, and 31 is
    // sixteen maps later crossed with a one-way. A once-ever flag left the
    // last two silent.
    expect(queueBody()).toContain("circuitSeenKey(level.id)");
  });

  it("has words in every language", () => {
    for (const lang of ["en", "es", "sv"]) {
      const game = JSON.parse(
        readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), "utf8"),
      ).game as Record<string, string>;
      expect(game.circuitTutorialTitle, `${lang} title`).toBeTruthy();
      expect(game.circuitTutorialBody, `${lang} body`).toBeTruthy();
      expect(game.circuitTutorialBody.includes("—"), `${lang} em-dash`).toBe(false);
    }
  });
});
