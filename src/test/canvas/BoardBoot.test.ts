/**
 * How every map opens (BoardBoot): one sequence instead of the three things
 * that never lined up - a translucent "Loading" outline, a shard assemble cut
 * from a flat 2D snapshot of a 3D board, and the board popping in between.
 *
 * Earlier reports this keeps: "the outline should have the exact same size as
 * the board that then replaces it" (boardPlaceholder.test.tsx has the board's
 * size), and a stand-in so the wait reads as busy rather than broken.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";
import type { BoardFrameCss } from "@/ui/game/overlayModel";
import {
  BOOT_GRID_CELLS, BOOT_LONG, BOOT_REDUCED, BOOT_SHORT, SPARK_LIFE,
  bootCells, bootFrame, bootGeometry, bootSparks, bootTimeline, span,
} from "@/ui/game/boardBootModel";

const read = (p: string) => readFileSync(p, "utf8");
const FRAME: BoardFrameCss = { left: 6, top: 40, width: 388, height: 388, frame: 6 };
const H = FRAME.height;

describe("the stand-in", () => {
  it("sits exactly on the frame the canvas hands it", () => {
    expect(read("src/ui/game/BoardBoot.tsx"))
      .toContain("left: origin.x + frame.left, top: origin.y + frame.top, width: frame.width, height: frame.height");
    const g = bootGeometry(FRAME);
    expect(g.inner).toEqual({ x: 6, y: 6, width: 376, height: 376 });
    expect(g.cell).toBeCloseTo(376 / BOOT_GRID_CELLS);
  });

  it("covers the whole board, opaquely, until the reveal starts", () => {
    // Opaque is the point: whatever a warming renderer draws is never seen.
    const f = bootFrame(0, BOOT_SHORT, H);
    expect(f.coverTop).toBe(0);
    expect(f.coverAlpha).toBe(1);
    expect(f.scanAlpha).toBe(0);
    expect(f.textAlpha).toBe(1);
    expect(f.done).toBe(false);
  });

  it("names the level it is compiling, in every locale", () => {
    for (const [lang, l] of [["en", en], ["es", es], ["sv", sv]] as const) {
      const boot = (l as { game: { boot?: Record<string, string> } }).game.boot;
      expect(boot?.level, `${lang} game.boot.level`).toContain("{{n}}");
      expect(boot?.compiling, `${lang} game.boot.compiling`).toBeTruthy();
      expect(boot?.newRun, `${lang} game.boot.newRun`).toBeTruthy();
      for (const v of Object.values(boot ?? {})) expect(v, "an em-dash in UI text").not.toContain("—");
    }
  });
});

describe("the reveal", () => {
  it("sweeps the cover off from the top down, behind a scan line", () => {
    const mid = (BOOT_SHORT.sweep[0] + BOOT_SHORT.sweep[1]) / 2;
    const f = bootFrame(mid, BOOT_SHORT, H);
    expect(f.coverTop).toBeGreaterThan(0);
    expect(f.coverTop).toBeLessThan(H);
    expect(f.scanY).toBe(f.coverTop);
    expect(f.scanAlpha).toBe(1);
    // Monotonic: the board never re-covers.
    let last = -1;
    for (let t = 0; t <= BOOT_SHORT.total; t += 0.01) {
      const top = bootFrame(t, BOOT_SHORT, H).coverTop;
      expect(top).toBeGreaterThanOrEqual(last);
      last = top;
    }
  });

  it("leaves nothing covered when the line has passed, and then ends", () => {
    const after = bootFrame(BOOT_SHORT.sweep[1], BOOT_SHORT, H);
    expect(after.coverTop).toBe(H);
    expect(after.scanAlpha).toBe(0);
    expect(bootFrame(BOOT_SHORT.total, BOOT_SHORT, H).done).toBe(true);
    expect(bootFrame(BOOT_SHORT.total - 0.01, BOOT_SHORT, H).done).toBe(false);
  });

  it("clears the caption before the line reaches the middle, where it sits", () => {
    for (const tl of [BOOT_SHORT, BOOT_LONG]) {
      const atMiddle = tl.sweep[0] + (tl.sweep[1] - tl.sweep[0]) / 2;
      expect(bootFrame(atMiddle, tl, H).textAlpha).toBe(0);
    }
  });

  it("flashes the frame as the map goes live, and only then", () => {
    expect(bootFrame(BOOT_SHORT.flash[0] - 0.01, BOOT_SHORT, H).flash).toBe(0);
    const peak = BOOT_SHORT.flash[0] + (BOOT_SHORT.flash[1] - BOOT_SHORT.flash[0]) * 0.25;
    expect(bootFrame(peak, BOOT_SHORT, H).flash).toBeCloseTo(1, 5);
    expect(bootFrame(BOOT_SHORT.flash[1], BOOT_SHORT, H).flash).toBe(0);
  });

  it("traces the whole frame before it is done", () => {
    expect(bootFrame(BOOT_SHORT.trace[1], BOOT_SHORT, H).trace).toBeCloseTo(1, 5);
    expect(bootFrame(0, BOOT_SHORT, H).trace).toBe(0);
  });

  it("throws sparks only while it sweeps, each behind the line that threw it", () => {
    expect(bootSparks(BOOT_SHORT.sweep[0] - 0.01, BOOT_SHORT, 388, H)).toEqual([]);
    expect(bootSparks(BOOT_SHORT.sweep[1] + SPARK_LIFE + 0.01, BOOT_SHORT, 388, H)).toEqual([]);
    const t = (BOOT_SHORT.sweep[0] + BOOT_SHORT.sweep[1]) / 2;
    const sparks = bootSparks(t, BOOT_SHORT, 388, H);
    expect(sparks.length).toBeGreaterThan(0);
    const line = bootFrame(t, BOOT_SHORT, H).scanY;
    for (const s of sparks) {
      expect(s.y).toBeLessThanOrEqual(line + 0.001);
      expect(s.alpha).toBeGreaterThan(0);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe("the two cuts", () => {
  it("gives the first map of a run the longer one, with the grid compiling first", () => {
    expect(bootTimeline(true, false)).toBe(BOOT_LONG);
    expect(bootTimeline(false, false)).toBe(BOOT_SHORT);
    expect(BOOT_LONG.total).toBeGreaterThan(BOOT_SHORT.total);
    expect(bootFrame(0.3, BOOT_LONG, H).cells).toBeGreaterThan(0);
    expect(bootFrame(0.3, BOOT_SHORT, H).cells).toBe(0);
    expect(bootCells(0.3, 1, 12, 12).length).toBeGreaterThan(0);
    expect(bootCells(0.3, 0, 12, 12)).toEqual([]);
  });

  it("keeps an ordinary map's opening short", () => {
    // Every map pays it: anything long here makes the next map feel slow.
    expect(BOOT_SHORT.total).toBeLessThanOrEqual(1);
  });

  it("only fades, briefly, when the player asked for less motion", () => {
    expect(bootTimeline(false, true)).toBe(BOOT_REDUCED);
    expect(bootTimeline(true, true)).toBe(BOOT_REDUCED);
    const mid = bootFrame(BOOT_REDUCED.total / 2, BOOT_REDUCED, H);
    expect(mid.scanAlpha).toBe(0);
    expect(mid.coverTop).toBe(0);
    expect(mid.coverAlpha).toBeGreaterThan(0);
    expect(mid.coverAlpha).toBeLessThan(1);
    expect(bootSparks(0.1, BOOT_REDUCED, 388, H)).toEqual([]);
    expect(BOOT_REDUCED.total).toBeLessThanOrEqual(0.3);
  });

  it("measures a span the way it reads", () => {
    expect(span(0, [1, 2])).toBe(0);
    expect(span(1.5, [1, 2])).toBe(0.5);
    expect(span(3, [1, 2])).toBe(1);
    expect(span(1, [1, 1])).toBe(1);
  });
});

describe("the map waits for it", () => {
  const canvas = read("src/components/game/GameCanvas.tsx");
  const loop = read("src/hooks/useGameLoop.ts");

  it("holds the map still until the reveal has finished", () => {
    expect(canvas).toContain("game.paused = paused || !!pendingLaunch || !revealed || stinger;");
    expect(canvas).toContain("onRevealed={handleRevealed}");
  });

  it("keeps drawing under the hold, so the reveal uncovers a drawn board", () => {
    // The Full Gravity stinger holds the board the same way, after the reveal.
    expect(canvas).toContain("game.bootHold = !revealed || stinger;");
    // The boot hold draws every frame; a loaded launcher, whose board is
    // still, at the hold rate.
    expect(loop).toMatch(/if \(launchPending\(game\) \|\| game\.bootHold\) \{\s*if \(game\.bootHold \|\| holdGate\.due\(timestamp\)\) callbacks\.render\(\);/);
  });

  it("does not reveal behind an explainer card", () => {
    const screen = read("src/components/game/GameScreen.tsx");
    expect(screen).toContain("revealReady={boardShown}");
    expect(screen).toMatch(/if \(canvasReady && !anyExplainerModal\) \{\s*setBoardShown\(true\);/);
  });

  it("no longer cuts a run's first map from a different renderer's snapshot", () => {
    // The old assemble flew in shards of the flat 2D scene and then snapped to
    // the 3D board: the incoherence this replaced.
    expect(canvas).not.toContain("captureSceneCanvas");
    expect(canvas).not.toContain("startAssemble");
  });
});
