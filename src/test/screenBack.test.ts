/**
 * Back-gesture routing: every screen must map to a defined back action, only
 * welcome exits, and mid-run flow screens swallow the gesture (never exit).
 */
import { describe, it, expect } from "vitest";
import { backActionForScreen, BackAction } from "@/lib/screenBack";
import { GameScreen } from "@/types/game";

const ALL_SCREENS: GameScreen[] = [
  'welcome', 'tutorial', 'game', 'upgradeShop', 'doorDraft', 'capstoneDraft',
  'runDraft', 'ascensionDraft', 'result', 'certificateStore', 'loadouts',
  'options', 'achievements', 'hallOfFame', 'admin', 'mapBuilder', 'animationTest',
  'upgradeAtlas',
];

describe("backActionForScreen", () => {
  it("returns a valid action for every screen", () => {
    const valid: BackAction[] = ['exit', 'welcome', 'admin', 'hall', 'game', 'consume'];
    for (const s of ALL_SCREENS) {
      expect(valid).toContain(backActionForScreen(s));
    }
  });

  it("only the welcome (root) screen exits", () => {
    for (const s of ALL_SCREENS) {
      const exits = backActionForScreen(s) === 'exit';
      expect(exits).toBe(s === 'welcome');
    }
  });

  it("the game screen opens the in-game pause menu", () => {
    expect(backActionForScreen('game')).toBe('game');
  });

  it("mid-run flow screens swallow the back (never exit)", () => {
    // runDraft is deliberately NOT here: Sprint Planning is the one draft that
    // runs before the run begins, so there is no forced progression to skip
    // past and nothing has been committed yet.
    for (const s of ['upgradeShop', 'doorDraft', 'capstoneDraft', 'ascensionDraft'] as GameScreen[]) {
      expect(backActionForScreen(s)).toBe('consume');
    }
  });

  it("Sprint Planning returns to the menu instead of swallowing the back", () => {
    // It had no way out at all: no button, and the gesture consumed. The only
    // exit was to start a run you did not want.
    expect(backActionForScreen('runDraft')).toBe('welcome');
  });

  it("menu/info screens return to the main menu", () => {
    for (const s of ['tutorial', 'options', 'certificateStore', 'loadouts', 'achievements', 'result'] as GameScreen[]) {
      expect(backActionForScreen(s)).toBe('welcome');
    }
  });

  it("admin sub-screens return to the admin screen", () => {
    expect(backActionForScreen('mapBuilder')).toBe('admin');
    expect(backActionForScreen('animationTest')).toBe('admin');
    expect(backActionForScreen('upgradeAtlas')).toBe('admin');
  });
});
