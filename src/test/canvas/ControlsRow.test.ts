/**
 * The canvas ControlsRow (src/ui/game/ControlsRow.tsx), carried over from
 * hudBudget.test.tsx's control-row checks, plus the click behaviour of the
 * inline DOM row in GameScreen.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import {
  controlButtons, menuItems, specsBadgeLabel, ASCENSION_COLOR, CONTROL_TARGET, type ControlsRowProps,
} from "@/ui/game/ControlsRowModel";
import { HUD } from "@/ui/game/hudMetrics";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/game/ControlsRow.tsx"), "utf8");

function props(over: Partial<ControlsRowProps> = {}): ControlsRowProps {
  const calls: string[] = [];
  const fn = (name: string) => vi.fn(() => { calls.push(name); });
  const p: ControlsRowProps & { calls: string[] } = {
    accentColor: "#00ff88", menuOpen: false, canPause: true, isPaused: false, manualUnread: 0,
    soundMuted: false, hasAscensionAnnouncement: false, adminMode: false,
    onToggleMenu: fn("toggleMenu"), onCloseMenu: fn("closeMenu"), onTogglePause: fn("togglePause"),
    onOpenSpecs: fn("specs"), onOpenWin: fn("win"), onToggleSound: fn("sound"), onOpenAscension: fn("ascension"),
    onOpenTuning: fn("tuning"), onRestart: fn("restart"), onMainMenu: fn("mainMenu"),
    calls, ...over,
  };
  return p;
}
const callsOf = (p: ControlsRowProps) => (p as ControlsRowProps & { calls: string[] }).calls;

describe("the row", () => {
  it("is Menu, Pause, Specs, Win, in that order", () => {
    expect(controlButtons(props()).map(b => b.id)).toEqual(["menu", "pause", "specs", "win"]);
  });

  it("has no Pause when the map cannot pause", () => {
    expect(controlButtons(props({ canPause: false })).map(b => b.id)).toEqual(["menu", "specs", "win"]);
  });

  it("pausing also closes the menu", () => {
    const p = props({ menuOpen: true });
    controlButtons(p).find(b => b.id === "pause")!.onTap();
    expect(callsOf(p)).toEqual(["closeMenu", "togglePause"]);
  });

  it("swaps Pause for Play while paused, lit", () => {
    const paused = controlButtons(props({ isPaused: true })).find(b => b.id === "pause")!;
    expect(paused.icon).toBe(Play);
    expect(paused.label).toEqual({ key: "game.resume" });
    expect(paused.active).toBe(true);
    const running = controlButtons(props()).find(b => b.id === "pause")!;
    expect(running.icon).toBe(Pause);
    expect(running.label).toEqual({ key: "game.pause" });
  });

  it("lights the menu button while the menu is open, and toggles it", () => {
    const p = props({ menuOpen: true });
    const menu = controlButtons(p)[0];
    expect(menu.active).toBe(true);
    menu.onTap();
    expect(callsOf(p)).toEqual(["toggleMenu"]);
  });

  it("puts Specs in the row, with the unread badge", () => {
    expect(controlButtons(props()).find(b => b.id === "specs")!.badge).toBeNull();
    const p = props({ manualUnread: 3 });
    const specs = controlButtons(p).find(b => b.id === "specs")!;
    expect(specs.label).toEqual({ key: "topBar.specs" });
    expect(specs.badge).toBe(3);
    expect(specsBadgeLabel(3)).toEqual({ key: "topBar.specsNew", values: { count: 3 } });
    specs.onTap();
    expect(callsOf(p)).toEqual(["specs"]);
  });

  it("puts how-to-win in the bar rather than only inside the sheet", () => {
    const p = props();
    const win = controlButtons(p).find(b => b.id === "win")!;
    expect(win.label).toEqual({ key: "winConditions.menuItem" });
    win.onTap();
    expect(callsOf(p)).toEqual(["win"]);
    expect(menuItems(props()).some(i => "key" in i.text && i.text.key === "winConditions.menuItem")).toBe(true);
  });

  it("declares at least a 44px target everywhere, inside its fixed height", () => {
    expect(CONTROL_TARGET).toBeGreaterThanOrEqual(44);
    expect(HUD.controlsRow).toBe(CONTROL_TARGET + 4 + 8);
    expect((SRC.match(/minHeight: CONTROL_TARGET/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the menu", () => {
  const order = (over: Partial<ControlsRowProps> = {}) => menuItems(props(over)).map(i => i.id);

  it("lists sound, win, restart and main menu for a player", () => {
    expect(order()).toEqual(["sound", "win", "restart", "mainMenu"]);
  });

  it("adds ascension only with an announcement, in amber", () => {
    expect(order({ hasAscensionAnnouncement: true })).toEqual(["sound", "win", "ascension", "restart", "mainMenu"]);
    const asc = menuItems(props({ hasAscensionAnnouncement: true })).find(i => i.id === "ascension")!;
    expect(asc.color).toBe(ASCENSION_COLOR);
    expect(ASCENSION_COLOR).toBe(0xffb347);
  });

  it("adds Tune map for admin only, after ascension", () => {
    expect(order({ adminMode: true, hasAscensionAnnouncement: true }))
      .toEqual(["sound", "win", "ascension", "tuning", "restart", "mainMenu"]);
    expect(menuItems(props({ adminMode: true })).find(i => i.id === "tuning")!.text).toEqual({ literal: "Tune map" });
  });

  it("toggles sound without closing", () => {
    const p = props({ menuOpen: true });
    menuItems(p).find(i => i.id === "sound")!.onTap();
    expect(callsOf(p)).toEqual(["sound"]);
  });

  it("says and shows the current sound state", () => {
    const on = menuItems(props({ soundMuted: false }))[0];
    expect(on.text).toEqual({ key: "game.soundOn" });
    expect(on.icon).toBe(Volume2);
    const off = menuItems(props({ soundMuted: true }))[0];
    expect(off.text).toEqual({ key: "game.soundOff" });
    expect(off.icon).toBe(VolumeX);
  });

  it.each([
    ["win", "win"], ["ascension", "ascension"], ["tuning", "tuning"], ["restart", "restart"], ["mainMenu", "mainMenu"],
  ] as const)("%s closes the menu first", (id, action) => {
    const p = props({ menuOpen: true, adminMode: true, hasAscensionAnnouncement: true });
    menuItems(p).find(i => i.id === id)!.onTap();
    expect(callsOf(p)).toEqual(["closeMenu", action]);
  });

  it("opens upward, away from the screen edge", () => {
    expect(SRC).toMatch(/bottom: HUD\.controlsRow \+ MENU_GAP/);
    expect(SRC).not.toMatch(/top: HUD\.controlsRow/);
  });

  it("closes on a tap anywhere outside, behind the row", () => {
    expect(SRC).toMatch(/onTap=\{p\.onCloseMenu\}/);
    // The catcher is drawn before the buttons, so they still take their taps.
    expect(SRC.indexOf("onTap={p.onCloseMenu}")).toBeLessThan(SRC.indexOf("controlButtons(p).map"));
  });
});
