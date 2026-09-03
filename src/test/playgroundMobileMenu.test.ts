/**
 * The playground's dev controls: a row on a desktop, a sheet on a phone.
 *
 * Reported from a phone with a screenshot: the floating toolbar was a
 * horizontally scrolling strip of six buttons with the "Freeze on clear" toggle
 * pinned at bottom-left ON TOP of it. The two overlapped into an unreadable
 * pile and most of the strip sat off-screen. A toolbar you cannot read is not a
 * toolbar.
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
    expect(SRC, "the toolbar is still shown on a phone")
      .toContain('hidden lg:block fixed bottom-4 left-2 right-2');
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
    expect(SRC).toMatch(/className="lg:hidden fixed bottom-4 right-4/);
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

  it("offers the freeze toggle, which is the only control on a picked level", () => {
    // It lives outside the `!selectedLevel` block on purpose: with a level
    // selected the rest of the strip is not rendered at all, and a sheet that
    // opened empty would be worse than no sheet.
    expect(sheet).toContain("setFreezeOnClear");
  });

  it("keeps the freeze toggle out of the level-only block", () => {
    // The structural version of the same point. If it drifted inside, picking a
    // level would leave the phone with a sheet containing nothing.
    const guarded = sheet.indexOf("{!selectedLevel && (");
    const closes = sheet.indexOf("</>", guarded);
    const freeze = sheet.indexOf("setFreezeOnClear");
    expect(guarded).toBeGreaterThan(-1);
    expect(freeze, "the freeze toggle is inside the !selectedLevel block")
      .toBeGreaterThan(closes);
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
