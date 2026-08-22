/**
 * The gravity-well manual entry.
 *
 * Filed rather than shown as a modal, which follows manual.ts's own rule: an
 * interruption is reserved for things that can lose you the map if you meet
 * them unwarned. A well is visible, quiet and never instantly fatal.
 *
 * The reason it needs an entry at all is one line of its copy. FROZEN BALLS ARE
 * EXEMPT from well steering - an exemption written so a held ball would not
 * drift out of its pocket mid-freeze, which quietly means freeze COUNTERS a
 * well. That is a real interaction, it costs nothing, and there is no way any
 * player discovers it except by accident.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MANUAL_ENTRIES } from "@/lib/manual";

const LOCALES = ["en", "es", "sv"] as const;
const load = (loc: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${loc}.json`), "utf8"));

const entry = MANUAL_ENTRIES.find(e => e.id === "gravityWell");

describe("the entry exists and is reachable", () => {
  it("is listed in the manual", () => {
    expect(entry).toBeTruthy();
  });

  /**
   * The failure that would be invisible: an entry with no filing call is never
   * met, so it never appears, and the manual silently has a hole in it.
   */
  it("is filed when a map actually has a well", () => {
    const SRC = readFileSync(
      resolve(__dirname, "../components/game/GameCanvas.tsx"), "utf8",
    );
    expect(SRC).toMatch(/fileManualEntry\('gravityWell'\)/);
    // Guarded on the map having one, not filed unconditionally at map init.
    expect(SRC).toMatch(/gravityWells\.length > 0.*fileManualEntry\('gravityWell'\)/);
  });
});

describe("the copy is complete in every language", () => {
  /**
   * i18n keys fail SILENTLY: a missing key renders as the key itself, so a
   * Spanish player would see "game.gravityWellTutorialBody" and nothing would
   * throw. That makes parity worth asserting rather than trusting.
   */
  it("has a title and body in all three locales", () => {
    for (const loc of LOCALES) {
      const game = load(loc).game;
      expect(game[entry!.titleKey.replace("game.", "")], `${loc} title`).toBeTruthy();
      expect(game[entry!.bodyKey.replace("game.", "")], `${loc} body`).toBeTruthy();
    }
  });

  it("actually explains the freeze interaction, which is the point of it", () => {
    const bodies = LOCALES.map(loc => load(loc).game.gravityWellTutorialBody as string);
    const FREEZE = [/frozen ball/i, /bola congelada/i, /frusen boll/i];
    bodies.forEach((body, i) => {
      expect(body, `${LOCALES[i]} must mention the frozen-ball exemption`).toMatch(FREEZE[i]);
    });
  });

  it("mentions dormancy, so a dormant well does not read as a broken one", () => {
    const WAKES = [/dormant/i, /inactivos/i, /vilande/i];
    LOCALES.forEach((loc, i) => {
      expect(load(loc).game.gravityWellTutorialBody, `${loc}`).toMatch(WAKES[i]);
    });
  });

  /** House rule: no em-dashes in user-facing text. */
  it("uses no em-dashes", () => {
    for (const loc of LOCALES) {
      const g = load(loc).game;
      expect(g.gravityWellTutorialTitle, loc).not.toContain("—");
      expect(g.gravityWellTutorialBody, loc).not.toContain("—");
    }
  });
});

/**
 * The claim the copy makes, checked against the code that makes it true. Copy
 * and behaviour drifting apart is worse than no copy: a player who has been
 * told freezing holds a ball in a well, and finds it does not, has been lied to
 * by the manual.
 */
describe("the freeze exemption the copy promises is real", () => {
  it("updateBall skips well steering for the frozen ball", () => {
    const SRC = readFileSync(
      resolve(__dirname, "../lib/physics/updateBall.ts"), "utf8",
    );
    const wellBlock = SRC.slice(
      SRC.indexOf("// Gravity wells"),
      SRC.indexOf("// Update rotation based on speed"),
    );
    expect(wellBlock).toContain("frozenBallId");
    expect(wellBlock).toMatch(/if \(!\(game\.frozenBallId && ball\.id === game\.frozenBallId\)\)/);
  });
});
