/**
 * A budget for the in-map HUD.
 *
 * The HUD was reported as cluttered, unclear and impossible to navigate: "not
 * even I can figure where the buttons that I'm looking for are at." Measured at
 * iPhone 15 size the board was 46% of the screen, ten status readouts shared one
 * 393px row, five separately positioned bars stacked under the board, and the
 * controls lived in four different places.
 *
 * None of that was anyone's decision. Every readout was individually worth
 * adding and nothing ever removed one, which is the same way the upgrade copy
 * grew until it needed its own budget. So this is the same instrument: a ceiling
 * on the total, set just above where things sit now, that fails when the count
 * creeps rather than when someone notices.
 *
 * The touch-target floor is the part that was failing outright. The menu and
 * pause buttons were 32px against Apple's 44px minimum, and the ability buttons
 * came out near 24px - and those are the controls a player reaches for while a
 * ball is bouncing toward the gap they just opened.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { AbilityBar } from "@/components/game/AbilityBar";

afterEach(cleanup);

const GAME = resolve(process.cwd(), "src/components/game");
const read = (f: string) => readFileSync(resolve(GAME, f), "utf8");

/** Apple's Human Interface Guidelines minimum tappable target. */
const MIN_TOUCH = 44;

describe("every control a player has to hit mid-map", () => {
  it("declares at least a 44px target", () => {
    // The concrete failure behind the report. A 32px control is not merely
    // fiddly on a phone, it is a control you miss while something is moving.
    const src = read("GameScreen.tsx");
    // Buttons in the control row and the menu sheet. w-8 h-8 was the old size.
    expect(src, "a 32px control is back in the game screen").not.toMatch(/w-8 h-8/);
    const targets = src.match(/min-h-\[44px\]/g) ?? [];
    expect(targets.length, "the control row lost its 44px floor").toBeGreaterThan(4);
  });

  it("gives the ability buttons a real target too", () => {
    // These were px-2.5 py-1 around a 16px icon: about 24px tall, and they are
    // the most time-critical controls in the game.
    render(
      <AbilityBar
        charges={{ freezeAll: 2 }}
        accentColor="#00ff88"
        onUse={() => {}}
        armedAbilityId={null}
        onInfoOpenChange={() => {}}
      />,
    );
    const button = screen.getAllByRole("button")[0];
    expect(button.className, "ability buttons are back under the touch floor")
      .toMatch(/min-h-\[44px\]/);
  });
});

describe("where the controls live", () => {
  it("keeps them all in one place, in the thumb zone", () => {
    // THE fix for "I cannot find the button". Pause and the menu used to float
    // at top-left, Specs sat at the right end of the status row and how-to-win
    // was inside the menu sheet: four homes for one category of thing, so the
    // only way to find anything was to remember where it had been put.
    const src = read("GameScreen.tsx");
    expect(src, "the floating top-left control cluster is back")
      .not.toContain('className="fixed top-2 left-2');
  });

  it("opens the menu sheet upward, away from the screen edge", () => {
    // It lives at the bottom now. A sheet that still dropped downward would
    // open off the end of the screen.
    const src = read("GameScreen.tsx");
    expect(src).toContain("bottom-full");
    expect(src, "the sheet still drops downward from a bottom-anchored button")
      .not.toContain('absolute top-full left-0 mt-1');
  });

  it("puts how-to-win in the bar rather than only inside the sheet", () => {
    // It is the question players actually ask mid-map, and it was three taps
    // deep. Two references now: the bar button and the sheet row.
    const src = read("GameScreen.tsx");
    expect((src.match(/winConditions\.menuItem/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe("how much the HUD is allowed to say at once", () => {
  /** Surfaces that persist during play, as opposed to modals and overlays. */
  function bottomStackSurfaces(): string[] {
    const src = read("GameScreen.tsx");
    const start = src.indexOf("fixed bottom-0");
    const stack = src.slice(start, start + 6000);
    return [...stack.matchAll(/<([A-Z][A-Za-z]+)\b/g)]
      .map(m => m[1])
      .filter(n => /Bar$/.test(n));
  }

  it("keeps the bottom stack inside its budget", () => {
    // Five stacked bars was the reported state; each was positioned
    // independently, so the layout shifted under the thumb whenever one
    // appeared. The ceiling sits just above today's count so that adding a
    // sixth is a decision someone has to make on purpose.
    const bars = bottomStackSurfaces();
    expect(bars.length, `bottom stack: ${bars.join(", ")}`).toBeLessThanOrEqual(5);
  });

  it("still has the bars that carry real information", () => {
    // A budget is trivially satisfied by deleting things. These have to survive
    // it - the push exit especially, which was reported missing while it was on
    // screen and was made loud on purpose.
    const src = read("GameScreen.tsx");
    for (const bar of ["AbilityBar", "PushExitBar", "GameMessageBar"]) {
      expect(src, `${bar} was dropped rather than consolidated`).toContain(`<${bar}`);
    }
  });
});
