/**
 * What the canvas How to Play screen lists (src/ui/screens/tutorialScreenModel.ts),
 * carried over from bugCodex.test.tsx (the tutorial's bug roster) and
 * fenceSlotsTutorial.test.ts (the fence-types step).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllBugs } from "@/lib/bugs";
import { getImplementedBallTypes } from "@/lib/ballTypes";
import {
  ballRoster, bugRoster, controlRows, isBallRevealed, lifeCycleSteps, tutorialSteps,
} from "@/ui/screens/tutorialScreenModel";

const locale = (loc: string) => JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${loc}.json`), "utf8"));

describe("the board steps", () => {
  it("has a fence-types step, last of the board steps", () => {
    expect(tutorialSteps.map(s => s.key)).toContain("fenceTypes");
    expect(tutorialSteps[tutorialSteps.length - 1].key).toBe("fenceTypes");
  });

  it("has copy for every step in every locale", () => {
    for (const loc of ["en", "es", "sv"]) {
      const steps = locale(loc).tutorial.steps;
      for (const s of [...tutorialSteps, ...lifeCycleSteps]) {
        expect(steps[s.key]?.title, `${loc} ${s.key} title`).toBeTruthy();
        expect(steps[s.key]?.description, `${loc} ${s.key} body`).toBeTruthy();
      }
    }
  });
});

describe("the tutorial's bug roster", () => {
  it("lists every bug in the catalogue, with its description and cost", () => {
    const roster = bugRoster(getAllBugs());
    expect(roster.length).toBe(getAllBugs().length);
    for (const bug of getAllBugs()) {
      const entry = roster.find(b => b.id === bug.id);
      expect(entry, `${bug.id} is missing from the roster`).toBeTruthy();
      expect(entry!.description, `${bug.id} has no description`).toBe(bug.description);
      expect(entry!.cost, `${bug.id}'s cost is not on the page`).toBe(bug.cost);
    }
  });

  it("shows them ALL without having met them, unlike the ball roster", () => {
    // Nothing about the bug roster depends on encounters; the ball roster's
    // gating is untouched.
    expect(bugRoster(getAllBugs()).length).toBe(getAllBugs().length);
    expect(ballRoster(getImplementedBallTypes(), []).some(e => !e.revealed)).toBe(true);
  });

  it("teaches the tap, which is the only thing a player can DO to a bug", () => {
    expect(String(locale("en").tutorial.bugs.intro).toLowerCase()).toMatch(/tap/);
    // ...and the screen shows that intro over the roster.
    expect(readFileSync(resolve(process.cwd(), "src/ui/screens/TutorialScreen.tsx"), "utf8"))
      .toContain('t("tutorial.bugs.intro")');
  });
});

describe("the ball roster", () => {
  it("always reveals red and green, and others once encountered", () => {
    expect(isBallRevealed("red", [])).toBe(true);
    expect(isBallRevealed("green", [])).toBe(true);
    expect(isBallRevealed("purple", [])).toBe(false);
    expect(isBallRevealed("purple", ["purple"])).toBe(true);
  });

  it("lists every implemented ball type", () => {
    expect(ballRoster(getImplementedBallTypes(), []).map(e => e.ball.id))
      .toEqual(getImplementedBallTypes().map(b => b.id));
  });
});

describe("the controls box", () => {
  it("adds click-and-drag only where there is no touch screen", () => {
    expect(controlRows(true).map(r => r.textKey)).toEqual(["tutorial.controlSwipeToCut", "tutorial.controlSecondFinger"]);
    expect(controlRows(false).map(r => r.textKey)).toContain("tutorial.controlClickAndDrag");
  });
});
