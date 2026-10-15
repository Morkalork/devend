/**
 * The canvas PairGuestGate (src/ui/game/PairGuestGate.tsx). Its point is that
 * the guest's taps never reach the screen underneath, or it makes decisions
 * about a run it does not own; a render needs a canvas, so the wiring is
 * checked at the source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the pair guest gate (canvas)", () => {
  const src = read("src/ui/game/PairGuestGate.tsx");

  it("swallows every touch over the whole screen", () => {
    expect(src).toMatch(/<TouchBlocker\s+screen=\{screen\}/);
    expect(src).toContain("useUiScreen()");
  });

  it("says which decision is being made and who is making it", () => {
    expect(src).toContain("t(`pair.host.${what}`, { name: remoteName })");
    expect(src).toContain('t("pair.waitingFor", { name: remoteName })');
    for (const lang of ["en", "es", "sv", "bn"]) {
      const pair = JSON.parse(read(`src/i18n/locales/${lang}.json`)).pair;
      for (const what of ["shopping", "deciding", "pushing", "continuing"]) {
        expect(pair.host[what], `${lang} pair.host.${what}`).toBeTruthy();
      }
      expect(pair.waitingFor).toBeTruthy();
    }
  });
});
