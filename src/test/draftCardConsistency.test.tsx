/**
 * Every between-map card is the same card.
 *
 * The upgrade shop's cards were enlarged first (p-5, rounded-xl, a text-xl name
 * and a big leading glyph) because testers said there was too much to read and
 * the answer was fewer, bigger cards rather than smaller text. The draft screens
 * did not follow. A Promotion - a once-per-run, run-defining reward - was
 * presented in a smaller card than a 40-hour Junior upgrade, and Sprint
 * Planning and Ascension were smaller still: rounded-lg, p-4, a text-base name
 * and text-xs body.
 *
 * They all share DraftCard now. The reason to guard that rather than just fix
 * it is that this is the SECOND time these screens have drifted apart: each was
 * written by copying the previous one's markup, so a card style landed in six
 * places and only some of them got updated. A screen that hand-rolls a card
 * cannot inherit the next change either, which is how it went wrong in the
 * first place.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import "@/i18n";
import { DraftCard } from "@/components/game/DraftCard";

afterEach(cleanup);

const GAME = resolve(process.cwd(), "src/components/game");

/** The screens the player meets between maps, each offering a choice of cards. */
function draftScreens(): { name: string; text: string }[] {
  return readdirSync(GAME)
    .filter(f => /DraftScreen\.tsx$/.test(f))
    .map(f => ({ name: f, text: readFileSync(join(GAME, f), "utf8") }));
}

describe("the between-map draft screens", () => {
  it("are all present, or this guard is looking at nothing", () => {
    const names = draftScreens().map(s => s.name);
    expect(names.length, `found: ${names.join(", ")}`).toBeGreaterThanOrEqual(6);
  });

  it("all offer their choices through the shared card", () => {
    const missing = draftScreens()
      .filter(s => !/<DraftCard/.test(s.text))
      .map(s => s.name);
    expect(missing, "draft screens not using DraftCard").toEqual([]);
  });

  it("none of them hand-rolls a card of its own", () => {
    // The tell: a clickable styled as a card, with the selected/unselected
    // treatment written out inline. That is a copy of DraftCard that will not
    // follow it when it changes.
    const bespoke = draftScreens()
      .filter(s => /className="text-left rounded-(lg|xl) p-\d transition-colors"/.test(s.text))
      .map(s => s.name);
    expect(bespoke, "screens with their own card markup").toEqual([]);
  });

  it("does not leave a small-card size behind in any of them", () => {
    // rounded-lg + p-4 was the old draft card. Catching the sizes rather than
    // only the component keeps a "quick tweak" from shrinking one screen back.
    const small = draftScreens()
      .filter(s => /rounded-lg p-4 transition/.test(s.text))
      .map(s => s.name);
    expect(small, "screens still using the old small card size").toEqual([]);
  });
});

describe("the card everything shares", () => {
  const card = (over: Partial<React.ComponentProps<typeof DraftCard>> = {}) =>
    render(
      <DraftCard
        index={0}
        accentColor="#00ff88"
        selected={false}
        onClick={() => {}}
        name="Technical Debt"
        {...over}
      >
        <p>Body copy</p>
      </DraftCard>,
    );

  it("is as big as an upgrade card", () => {
    // The upgrade shop's card is p-5 rounded-xl with a text-xl name. These are
    // the numbers the whole change is about, so they are asserted rather than
    // left to look right.
    card();
    const button = screen.getByRole("button");
    expect(button.className).toMatch(/\bp-5\b/);
    expect(button.className).toMatch(/\brounded-xl\b/);
    expect(screen.getByText("Technical Debt").className).toMatch(/\btext-xl\b/);
  });

  it("has room for the big leading glyph the shop's cards lead with", () => {
    // That block is most of why the shop's cards read as cards rather than as
    // list rows; a draft card without one just looks like the smaller thing it
    // used to be.
    card({ icon: <svg data-testid="glyph" /> });
    expect(screen.getByTestId("glyph")).toBeTruthy();
  });

  it("still selects on a plain click", () => {
    let clicks = 0;
    card({ onClick: () => { clicks++; } });
    fireEvent.click(screen.getByRole("button"));
    expect(clicks).toBe(1);
  });

  it("shows an Info hint only where holding actually does something", () => {
    // The codebase's rule is that press-and-hold reveals an explainer and the
    // element has to read as holdable. A hint on a card that ignores the hold
    // is a promise the card does not keep.
    const withHold = card({ onLongPress: () => {} });
    expect(withHold.container.querySelector("svg"), "no hold hint").toBeTruthy();
    cleanup();
    const without = card();
    expect(without.container.querySelector("svg"), "hint on a card that cannot be held")
      .toBeNull();
  });
});
