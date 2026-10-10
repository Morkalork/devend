/**
 * The canvas AbilityBar (src/ui/game/AbilityBar.tsx), carried over from
 * hudBudget.test.tsx (the touch floor) plus the DOM bar's own rules.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllAbilities, getAbility } from "@/lib/abilities";
import {
  ownedAbilities, gainedAbilityIds, abilityBarShape, abilityButtonLook, abilityPress, TOUCH_TARGET,
} from "@/ui/game/bottomModel";
import { HUD } from "@/ui/game/hudMetrics";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/game/AbilityBar.tsx"), "utf8");

describe("what the bar shows", () => {
  it("one button per ability with a charge, in catalogue order", () => {
    const all = getAllAbilities();
    const [a, b] = [all[0], all[2]];
    const owned = ownedAbilities({ [b.id]: 1, [a.id]: 3, [all[1].id]: 0 });
    expect(owned.map(x => x.id)).toEqual([a.id, b.id]);
  });

  it("nothing at all until the first charge, so the row takes no space", () => {
    expect(abilityBarShape(0, false)).toBe("none");
    expect(abilityBarShape(2, false)).toBe("row");
  });

  it("keeps an open explainer up even once its last charge is spent", () => {
    expect(abilityBarShape(0, true)).toBe("infoOnly");
  });
});

describe("blinking on a gain", () => {
  it("names the abilities whose count rose, and only those", () => {
    expect(gainedAbilityIds({ freezeAll: 1 }, { freezeAll: 2, slowAll: 1 }).sort()).toEqual(["freezeAll", "slowAll"]);
    expect(gainedAbilityIds({ freezeAll: 2 }, { freezeAll: 1 })).toEqual([]);
    expect(gainedAbilityIds({ freezeAll: 1 }, { freezeAll: 1 })).toEqual([]);
  });

  it("starts from the first charges, so a level start never blinks", () => {
    expect(SRC).toMatch(/useRef<Record<string, number>>\(charges\)/);
  });
});

describe("pressing", () => {
  it("a tap uses the ability, a hold explains it instead", () => {
    const a = getAbility("freezeAll")!;
    const onUse = vi.fn();
    const openInfo = vi.fn();
    abilityPress(a, onUse, openInfo).onTap();
    expect(onUse).toHaveBeenCalledWith("freezeAll");
    expect(openInfo).not.toHaveBeenCalled();
    abilityPress(a, onUse, openInfo).onHold();
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(openInfo).toHaveBeenCalledWith(a);
  });

  it("rings and fills the armed button", () => {
    expect(abilityButtonLook(true).ring).toBe(true);
    expect(abilityButtonLook(false).ring).toBe(false);
    expect(abilityButtonLook(true).fillAlpha).toBeGreaterThan(abilityButtonLook(false).fillAlpha);
  });
});

describe("every control a player has to hit mid-map", () => {
  it("gives the ability buttons a real target", () => {
    // They were once about 24px tall: the most time-critical controls in the game.
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(44);
    expect(SRC).toMatch(/height: TOUCH_TARGET/);
  });
});

describe("one row, always the same height", () => {
  it("scrolls sideways rather than wrapping", () => {
    expect(SRC).toMatch(/<ScrollView direction="horizontal"/);
    expect(SRC).not.toMatch(/flexWrap/);
    expect(SRC).toMatch(/height: HUD\.abilityRow/);
    expect(HUD.abilityRow).toBe(TOUCH_TARGET + 8);
  });
});
