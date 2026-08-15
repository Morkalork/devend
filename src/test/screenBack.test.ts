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
    for (const s of ['upgradeShop', 'doorDraft', 'capstoneDraft', 'runDraft', 'ascensionDraft'] as GameScreen[]) {
      expect(backActionForScreen(s)).toBe('consume');
    }
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
