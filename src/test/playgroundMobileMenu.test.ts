/**
 * The playground's dev controls: a row on a desktop, a sheet on a phone.
 *
 * Reported from a phone with a screenshot, twice. There are THREE dev bars in
 * this screen and the first fix only found one of them:
 *
 *   the floating strip, shown with NO level selected;
 *   the controls overlay, shown WITH one selected;
 *   the "Freeze on clear" toggle, pinned bottom-left over whichever is up.
 *
 * All three sat in the same 16px band, and so does the GAME's own control row
 * (menu, specs, objective), which is real player UI and stays. Hiding one strip
 * left the other two interleaved with it, which is what the second screenshot
 * showed: a sheet button had appeared and the pile was still there.
 *
 * Hence the counting below. The failure is never a crash, it is one bar or one
 * control quietly left behind, so what these check is that no dev bar renders
 * on a phone and that the sheet offers what all of them together offered.
 *
 * ── What these check, and why they are source checks ───────────────────────
 *
 * Two layouts of the same control set drift. The failure is not a crash: it is
 * a control that exists on one layout and quietly not on the other, so a phone
 * loses the ability to do something and nothing anywhere says so. Every test
 * below is really "do both layouts still offer the same things".
 *
 * jsdom cannot help. It does not evaluate media queries or Tailwind's `lg:`
 * prefix, so a render test would report both layouts present at every width -
 * fine in exactly the case where one has leaked into the other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "src/components/admin/PlaygroundScreen.tsx"), "utf8");

/** The sheet's markup: from the mobile trigger to the level-picker modal. */
function sheetSource(): string {
  const start = SRC.indexOf('aria-label="Playground controls"');
  expect(start, "the mobile trigger is gone").toBeGreaterThan(-1);
  const end = SRC.indexOf("{/* Level picker modal */}", start);
  expect(end, "cannot find the end of the sheet").toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("the phone gets a sheet instead of the strip", () => {
  it("hides the scrolling toolbar below lg", () => {
    // THE fix. Left visible, the sheet and the strip are both on screen and the
    // phone is worse off than before.
    expect(SRC, "the no-level toolbar is still shown on a phone")
      .toContain('hidden lg:block fixed bottom-4 left-2 right-2');
  });

  it("hides the SELECTED-LEVEL controls overlay too", () => {
    // The one the first fix missed. It is a separate element with a separate
    // condition, and it is the one on screen whenever you are actually looking
    // at a map - which is most of the time.
    expect(SRC, "the selected-level overlay is still shown on a phone")
      .toContain('scrollbar-hide hidden lg:block');
  });

  it("leaves no dev bar rendering on a phone", () => {
    // The sweeping version, so a FOURTH bar added later cannot slip through the
    // way the second one did.
    //
    // It has to find bars written BOTH ways. The first attempt matched only the
    // Tailwind class `bottom-4` and therefore could not see the selected-level
    // overlay at all, because that one positions with an inline
    // `style={{ bottom: 16 }}` - so the test passed while the exact bar this
    // whole change is about was still on screen. Same lesson as the rest of
    // this file: a check that cannot see the thing it is about is not a check.
    //
    // A window rather than a single regex, because className and style sit on
    // different lines of the same element.
    const anchors = [...SRC.matchAll(/(?:fixed|absolute) bottom-4|bottom: 16/g)];
    expect(anchors.length, "no bottom bars found: has the layout changed?")
      .toBeGreaterThanOrEqual(4);

    for (const m of anchors) {
      const at = m.index ?? 0;
      const window = SRC.slice(Math.max(0, at - 400), at + 200);
      expect(window, `a dev bar near offset ${at} renders at every width`)
        .toMatch(/hidden lg:(?:block|flex)|lg:hidden/);
    }
  });

  it("hides the freeze toggle that was overlapping it", () => {
    // The other half of the pile in the screenshot: this sat at bottom-left,
    // over the strip, in its own stacking context.
    expect(SRC, "the freeze toggle still overlaps on a phone")
      .toContain('hidden lg:flex absolute bottom-4 left-4');
  });

  it("shows the trigger only below lg", () => {
    // And not on a desktop, where it would be a second way to do what the
    // toolbar right beside it already does.
    expect(SRC).toMatch(/className="lg:hidden fixed bottom-4 left-4/);
  });

  it("keeps the trigger clear of the game's own control row", () => {
    // That row is centred in the same bottom band and is PLAYER ui, not dev
    // clutter, so it stays. The trigger sits hard left, where the freeze toggle
    // used to be, rather than in the middle of it.
    expect(SRC).toMatch(/lg:hidden fixed bottom-4 left-4/);
    expect(SRC, "the trigger is back over the game's buttons")
      .not.toMatch(/lg:hidden fixed bottom-4 right-4/);
  });

  it("keeps the sheet itself off the desktop", () => {
    expect(sheetSource()).toContain('lg:hidden fixed inset-0');
  });
});

describe("everything on the strip is in the sheet", () => {
  const sheet = sheetSource();

  // The six controls the desktop strip offers, by the handler each one calls.
  // Named by handler rather than by label because a label can be reworded and
  // this should keep working; losing the handler is the real regression.
  const CONTROLS: Array<[string, string]> = [
    ["the level picker", "setLevelPickerOpen(true)"],
    ["previous level", "goToPreviousLevel"],
    ["next level", "goToNextLevel"],
    ["the ball picker", "setBallPickerOpen(true)"],
    ["the modifiers panel", "openModal()"],
    ["hard reset", "hardReset()"],
  ];

  for (const [name, handler] of CONTROLS) {
    it(`offers ${name}`, () => {
      expect(sheet, `${name} is missing from the phone sheet`).toContain(handler);
    });
  }

  it("offers the freeze toggle", () => {
    expect(sheet).toContain("setFreezeOnClear");
  });

  it("offers the level editor, which only the selected-level bar had", () => {
    // The `md:hidden` pencil. It is the only way to open the edit drawer on a
    // phone, so hiding its bar without carrying it over would have removed the
    // ability outright.
    expect(sheet, "no way left to open the level editor on a phone")
      .toContain("setEditorOpen(true)");
  });

  /**
   * The text INSIDE `{!selectedLevel && ( ... )}`, which is the only part of
   * the sheet that disappears once a level is loaded.
   *
   * Membership, not position. The first version of this test asked whether a
   * control appeared before the guard STARTED, which quietly mislabels
   * everything rendered after the guard closes - the freeze toggle and the
   * reset button both live there and both are unguarded.
   */
  function guardedBlock(): string {
    const start = sheet.indexOf("{!selectedLevel && (");
    expect(start, "the !selectedLevel guard is gone").toBeGreaterThan(-1);
    const end = sheet.indexOf("\n              )}", start);
    expect(end, "cannot find the end of the guarded block").toBeGreaterThan(start);
    return sheet.slice(start, end);
  }

  it("does not hide the shared controls behind a level being selected", () => {
    // THE second-screenshot bug, as a structural check. The first sheet put
    // everything except the freeze toggle behind `!selectedLevel`, so picking a
    // level - the normal case - emptied the sheet to a single row while the
    // overlay it was meant to replace was still on screen.
    //
    // These four are on BOTH desktop bars, so none may sit inside the guard.
    const guarded = guardedBlock();
    for (const shared of [
      "setLevelPickerOpen(true)", "goToPreviousLevel",
      "setBallPickerOpen(true)", "setFreezeOnClear",
    ]) {
      expect(sheet, `${shared} is missing entirely`).toContain(shared);
      expect(guarded, `${shared} is hidden when a level is selected`)
        .not.toContain(shared);
    }
  });

  it("keeps Modifiers guarded, since the level bar never offered it", () => {
    // The other direction: un-guarding it would be a new feature wearing a bug
    // fix's clothes.
    expect(guardedBlock(), "Modifiers is now offered on a selected level too")
      .toContain("openModal()");
  });
});

describe("how the sheet behaves", () => {
  const sheet = sheetSource();

  it("keeps itself open while stepping through levels", () => {
    // Stepping is done several times in a row. Closing on each press would mean
    // reopening the menu for every level.
    const prev = sheet.indexOf("goToPreviousLevel");
    const line = sheet.slice(prev - 120, prev + 40);
    expect(line, "stepping a level closes the menu").not.toContain("setDevMenuOpen(false)");
  });

  it("closes itself when it hands over to another modal", () => {
    // The pickers and the modifiers panel are full-screen. Leaving the sheet
    // mounted under them stacks two backdrops and traps the taps.
    for (const opener of ["setLevelPickerOpen(true)", "setBallPickerOpen(true)", "openModal()"]) {
      const at = sheet.indexOf(opener);
      expect(sheet.slice(at - 80, at), `${opener} leaves the sheet open`)
        .toContain("setDevMenuOpen(false)");
    }
  });

  it("stays clear of the phone's gesture bar", () => {
    // A bottom sheet whose last row sits under the home indicator has a button
    // that cannot be tapped, and nothing about it looks wrong.
    expect(sheet).toContain("env(safe-area-inset-bottom)");
  });

  it("does not close when the sheet itself is tapped", () => {
    // The backdrop closes it; without stopPropagation every control inside
    // would close it on the way through.
    expect(sheet).toContain("e.stopPropagation()");
  });
});
