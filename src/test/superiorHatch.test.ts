/**
 * Telling a superior lock apart from an ordinary one, after the moment has
 * passed.
 *
 * Reported twice as "still doesn't differ enough", and both earlier attempts
 * had gone into the FLASH: a gold throb and gold rings that are over in half a
 * second. What the board KEPT was identical either way. `lockCaptured` records
 * how many balls a pocket took, so the persistent tint answered how much this
 * paid and never how well it was played, and a tight seal and a sloppy one left
 * the same mark for the rest of the map.
 *
 * So the fix had to be persistent and it had to use a different axis. The tint
 * already spends brightness on intensity; a second brightness cue would fight
 * it. Texture is free, and a striped pocket reads apart from a plain one at any
 * tint level and from across the board.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSpaceGrid } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import { PALETTE } from "@/lib/rendering/sleek/palette";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const CUT = read("../lib/physics/applyCut.ts");
const BOARD = read("../lib/rendering/sleek/boardLayer.ts");

describe("the board remembers a tight seal", () => {
  it("carries a superior mask alongside the intensity one", () => {
    const grid = createSpaceGrid(createRectPolygon(45, 45, 855, 855), [], 15);
    expect(grid.lockCaptured, "intensity mask").toBeTruthy();
    expect(grid.superiorCaptured, "superior mask").toBeTruthy();
    expect(grid.superiorCaptured!.length).toBe(grid.cells.length);
  });

  it("starts blank, so nothing is superior before anything is locked", () => {
    const grid = createSpaceGrid(createRectPolygon(45, 45, 855, 855), [], 15);
    expect([...grid.superiorCaptured!].some(v => v !== 0)).toBe(false);
  });
});

describe("marking it", () => {
  /**
   * The grade is decided inside checkBallWonState and nothing carries it back
   * out to the tint pass, so applyCut has to compare the tally across the call.
   * Marking unconditionally would stripe every lock, which is the same failure
   * as striping none.
   */
  it("only marks when the tally actually rose", () => {
    expect(CUT).toMatch(/const superiorBefore = game\.superiorLockCount;/);
    expect(CUT).toMatch(/const wasSuperior = game\.superiorLockCount > superiorBefore;/);
    expect(CUT).toMatch(/if \(wasSuperior\) grid\.superiorCaptured\[idx\] = 1;/);
  });

  it("snapshots BEFORE the grade is decided, not after", () => {
    const before = CUT.indexOf("const superiorBefore");
    const call = CUT.indexOf("checkAndUpdateBallWonStates(game");
    const after = CUT.indexOf("const wasSuperior");
    expect(before).toBeLessThan(call);
    expect(call).toBeLessThan(after);
  });

  it("marks the same cells the tint covers", () => {
    // Sharing the flood means the stripes fill the pocket exactly as the tint
    // does; computing a second region would let the two disagree at the edges.
    // lastIndexOf: wasteCapturedPickups appears as an IMPORT near the top of
    // the file, and slicing to that gave an empty string that matched nothing.
    const loop = CUT.slice(
      CUT.indexOf("for (const idx of bounded)"),
      CUT.lastIndexOf("wasteCapturedPickups(game)"),
    );
    expect(loop.length, "the slice must actually contain the loop").toBeGreaterThan(50);
    expect(loop).toMatch(/grid\.lockCaptured\[idx\]/);
    expect(loop).toMatch(/grid\.superiorCaptured\[idx\] = 1/);
  });

  it("never downgrades a pocket that was once superior", () => {
    // Same rule lockCaptured follows for intensity: a later ordinary lock in
    // the same chamber must not erase the mark.
    expect(CUT).not.toMatch(/superiorCaptured\[idx\] = wasSuperior/);
    expect(CUT).not.toMatch(/superiorCaptured\[idx\] = 0/);
  });
});

describe("drawing it", () => {
  it("draws a hatch, not just another colour", () => {
    expect(BOARD).toMatch(/drawSuperiorHatch/);
    // Lines, not a fill: texture is the axis the tint is not already using.
    const fn = BOARD.slice(BOARD.indexOf("private drawSuperiorHatch"));
    expect(fn).toMatch(/moveTo\([^)]*\)\.lineTo\(/);
    expect(fn).toMatch(/\.stroke\(\{/);
  });

  it("uses the same gold as the lock flash", () => {
    expect(PALETTE.superior).toBe(0xffd54a);
    expect(BOARD).toMatch(/PALETTE\.superior/);
  });

  it("spaces the stripes out instead of packing them at cell resolution", () => {
    // Every anti-diagonal at a 15-unit cell is a near-solid wash, which reads as
    // a brighter tint: exactly the cue this is trying not to duplicate.
    expect(BOARD).toMatch(/\(\(col \+ row\) & 1\) !== 0\) continue;/);
  });

  it("is drawn on the board surface, not as a transient flash", () => {
    // The whole point: it has to still be there a minute later.
    expect(BOARD).toMatch(/this\.drawSuperiorHatch\(game, w2s\);/);
    expect(BOARD).toMatch(/private hatch = new Graphics\(\)/);
    expect(BOARD).toMatch(/this\.surface\.addChild\([^)]*this\.hatch/);
  });

  /**
   * On its OWN Graphics rather than sharing `locked`. A Pixi Graphics carries
   * one accumulating path, so stroking the hatch on the object that had just
   * filled every locked-pocket contour risks stroking those contours too. The
   * separation makes that impossible rather than relying on fill() having
   * consumed the path.
   */
  it("cannot contaminate, or be contaminated by, the pocket fills", () => {
    expect(BOARD).not.toMatch(/this\.locked\.stroke\(/);
    const fn = BOARD.slice(BOARD.indexOf("private drawSuperiorHatch"));
    expect(fn).toMatch(/this\.hatch\.moveTo/);
    expect(fn).toMatch(/this\.hatch\.stroke/);
    expect(BOARD).toMatch(/this\.hatch\.clear\(\);/);
  });
});

/**
 * Sprint Planning runs BEFORE a run starts, so unlike the mid-run drafts there
 * is no forced progression to skip past. It had no way out at all: no button,
 * and the back gesture was deliberately swallowed, so the only exit was to
 * start a run you did not want.
 */
describe("Sprint Planning can be left", () => {
  const SCREEN = read("../components/game/RunDraftScreen.tsx");
  const BACK = read("../lib/screenBack.ts");
  const INDEX = read("../pages/Index.tsx");
  const LOCALES = ["en", "es", "sv"] as const;

  it("offers a back button", () => {
    expect(SCREEN).toMatch(/onBack\?: \(\) => void;/);
    expect(SCREEN).toMatch(/onClick=\{onBack\}/);
  });

  it("routes the back GESTURE to the menu too", () => {
    // A button the gesture disagrees with is worse than neither: Android users
    // would swipe back, see nothing happen, and conclude they are stuck.
    const runDraft = BACK.slice(BACK.indexOf("case 'runDraft':"));
    expect(runDraft.slice(0, 80)).toMatch(/return 'welcome'/);
  });

  it("no longer swallows that gesture as a mid-run screen", () => {
    const consume = BACK.slice(BACK.indexOf("case 'upgradeShop':"), BACK.indexOf("case 'runDraft':"));
    expect(consume).not.toMatch(/runDraft/);
  });

  it("is wired to the same handler the pause menu uses", () => {
    expect(INDEX).toMatch(/onBack=\{session\.handleBackToWelcome\}/);
  });

  it("has its label in every language", () => {
    for (const loc of LOCALES) {
      const d = JSON.parse(read(`../i18n/locales/${loc}.json`));
      expect(typeof d.runDraft?.back, `${loc} runDraft.back`).toBe("string");
      expect(d.runDraft.back.length).toBeGreaterThan(0);
      expect(d.runDraft.back).not.toContain("—");
    }
  });
});
