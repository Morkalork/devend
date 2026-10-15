/**
 * The canvas pause overlay (src/ui/game/PauseOverlay.tsx), carrying over the
 * pause half of viewportZoomRecovery.test.ts: a pause nobody asked for must
 * say why, in every language.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the pause overlay (canvas)", () => {
  const src = read("src/ui/game/PauseOverlay.tsx");

  it("says why when the view is zoomed, and only then", () => {
    expect(src, "a pause nobody asked for with nothing to explain it").toContain("game.pausedZoom");
    expect(src).toMatch(/\{zoomStuck && \(/);
  });

  it("has words for it in every language", () => {
    for (const lang of ["en", "es", "sv", "bn"]) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      expect(locale.game.pausedZoom, `${lang} has no words for it`).toBeTruthy();
      expect(locale.game.paused).toBeTruthy();
      expect(locale.game.resume).toBeTruthy();
    }
  });

  it("resumes from its button", () => {
    expect(src).toMatch(/text=\{t\('game\.resume'\)\}[^>]*onTap=\{onResume\}/);
  });
});
