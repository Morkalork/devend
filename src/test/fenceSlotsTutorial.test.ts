/**
 * Telling the player what the five slots under the board are.
 *
 * The bar is on screen from map one, and until this it had exactly ONE
 * explanation anywhere in the game: the modal that auto-opens the first time a
 * fence type is acquired. That fires at level 4 at the very earliest (Set A
 * Breakpoint's unlockLevel, and only if the shop rolls it and the player buys
 * it), and never at all for a player who never buys one. Before then the bar is
 * four empty boxes that nothing on any screen accounts for.
 *
 * Worse, that modal was unrepeatable: "Re-enable All Tutorials" never cleared
 * the key it writes, so a player who tapped through it could not get it back by
 * any means. The same hole the circuit explainer had, which useTutorialManager
 * documents at length and then reopened twice.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MANUAL_ENTRIES } from "@/lib/manual";
import { useTutorialManager } from "@/hooks/useTutorialManager";
import { FENCE_TYPES_SEEN_KEY, hasSeenFenceType, markFenceTypeSeen } from "@/lib/fenceSeen";
import { ABILITIES_SEEN_KEY, hasSeenAbility, markAbilitySeen } from "@/lib/abilitySeen";

const LOCALES = ["en", "es", "sv"] as const;
const locale = (loc: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${loc}.json`), "utf8"));
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const at = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], obj);

describe("Re-enable All Tutorials", () => {
  beforeEach(() => localStorage.clear());

  it("brings back the fence-type explainers", () => {
    markFenceTypeSeen("breakpoint");
    expect(hasSeenFenceType("breakpoint")).toBe(true);

    const { result } = renderHook(() => useTutorialManager());
    act(() => { result.current.resetAllTutorials(); });

    expect(hasSeenFenceType("breakpoint"), "the button that re-enables tutorials skipped this one")
      .toBe(false);
  });

  it("brings back the ability explainers, which had the identical hole", () => {
    markAbilitySeen("shockwave");
    const { result } = renderHook(() => useTutorialManager());
    act(() => { result.current.resetAllTutorials(); });
    expect(hasSeenAbility("shockwave")).toBe(false);
  });

  it("names both keys where the reset can see them", () => {
    // The keys were private to their own modules, which is the mechanism of the
    // bug: a reset cannot clear a key it has no name for.
    const src = read("src/hooks/useTutorialManager.ts");
    expect(src).toContain("FENCE_TYPES_SEEN_KEY");
    expect(src).toContain("ABILITIES_SEEN_KEY");
    expect(FENCE_TYPES_SEEN_KEY).not.toBe(ABILITIES_SEEN_KEY);
  });
});

describe("the manual entry", () => {
  const entry = MANUAL_ENTRIES.find(e => e.id === "fenceSlots");

  it("is listed", () => {
    expect(entry).toBeTruthy();
  });

  it("has copy in every locale", () => {
    for (const loc of LOCALES) {
      const d = locale(loc);
      expect(at(d, entry!.titleKey), `${loc} has no fence-slot title`).toBeTruthy();
      expect(at(d, entry!.bodyKey), `${loc} has no fence-slot body`).toBeTruthy();
    }
  });

  it("is filed a map BEFORE the first fence type can be bought", () => {
    // Set A Breakpoint is the open-shelf fence and unlocks at level 4. The
    // bottom-strip explainer fires at level 3, so the slots are accounted for
    // by the time the shop can offer something to put in one.
    const src = read("src/components/game/GameScreen.tsx");
    expect(src).toMatch(/showBottomBarOverlay = levelNumber === 3/);
    expect(src).toMatch(/fileManualEntry\('fenceSlots'\)/);

    const upgrades = read("public/upgrades.yml");
    const breakpoint = upgrades.slice(upgrades.indexOf("id: set_a_breakpoint"));
    const unlock = Number(/unlockLevel: (\d+)/.exec(breakpoint)?.[1]);
    expect(unlock, "the open-shelf fence moved earlier than the explanation")
      .toBeGreaterThan(3);
  });

  it("is also filed on acquiring one, for a run that started past level 3", () => {
    // A Head Start certificate begins a run above level 3, so the level-3
    // filing above never happens for that player.
    const src = read("src/components/game/FenceSlotBar.tsx");
    expect(src).toMatch(/fileManualEntry\('fenceSlots'\)/);
    expect(src, "filed for a bar holding nothing but the standard fence")
      .toMatch(/owned\.length > 1/);
  });
});

describe("the How to Play screen", () => {
  it("has a fence-types step", () => {
    const src = read("src/components/game/TutorialScreen.tsx");
    expect(src).toMatch(/key: 'fenceTypes'/);
  });

  it("has its copy in every locale", () => {
    for (const loc of LOCALES) {
      const d = locale(loc);
      expect(at(d, "tutorial.steps.fenceTypes.title"), `${loc} title`).toBeTruthy();
      expect(at(d, "tutorial.steps.fenceTypes.description"), `${loc} body`).toBeTruthy();
    }
  });

  it("explains the price, not just the existence", () => {
    // Build speed is the whole balance of the feature and it is invisible on the
    // board until a ball is racing your cut, which is far too late to learn it.
    const en = locale("en") as Record<string, unknown>;
    const body = String(at(en, "tutorial.steps.fenceTypes.description"));
    expect(body.toLowerCase()).toContain("slower");
  });

  it("uses no em-dash, in any locale", () => {
    // CLAUDE.md: never in user-facing strings.
    for (const loc of LOCALES) {
      const d = locale(loc);
      for (const key of [
        "tutorial.steps.fenceTypes.title", "tutorial.steps.fenceTypes.description",
        "game.fenceSlotsTutorialTitle", "game.fenceSlotsTutorialBody",
      ]) {
        expect(String(at(d, key)), `${loc} ${key}`).not.toContain("—");
      }
    }
  });
});
