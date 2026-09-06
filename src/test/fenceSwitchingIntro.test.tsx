/**
 * "You now have more than one kind of fence" is its own lesson.
 *
 * Acquiring a special auto-opened that TYPE's card, which says what that fence
 * does. Nothing said the BAR is a chooser: that a cut now comes in kinds, that
 * the choice is a mode which holds until it is changed, and that standard is
 * still sitting in slot 1. The card mentions selection in a footer line, which
 * is where a reader who already knows looks and a reader who does not never
 * does.
 *
 * So a one-time overlay goes FIRST, spotlighting the bar, and the type's card
 * follows it. Three things have to hold and each fails differently: the copy is
 * shared with the Manual entry rather than written twice, the card is queued
 * behind the overlay rather than dropped, and the one-shot is clearable by the
 * button whose job is clearing one-shots.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import { MANUAL_ENTRIES } from "@/lib/manual";
import { useTutorialManager } from "@/hooks/useTutorialManager";
import {
  hasSeenFenceSwitching, markFenceSwitchingSeen, FENCE_SWITCHING_SEEN_KEY,
  FENCE_TYPES_SEEN_KEY,
} from "@/lib/fenceSeen";

const LOCALES = ["en", "es", "sv"] as const;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const locale = (loc: string) =>
  JSON.parse(read(`src/i18n/locales/${loc}.json`)) as Record<string, Record<string, string>>;

describe("the one-shot", () => {
  beforeEach(() => localStorage.clear());

  it("is armed for a fresh install and stays down once marked", () => {
    expect(hasSeenFenceSwitching()).toBe(false);
    markFenceSwitchingSeen();
    expect(hasSeenFenceSwitching()).toBe(true);
  });

  it("comes back with Re-enable All Tutorials", () => {
    // Added WITH the mechanic. The circuit explainer sat outside that sweep for
    // months, and the fence and ability explainers did too until last week.
    markFenceSwitchingSeen();
    const { result } = renderHook(() => useTutorialManager());
    act(() => { result.current.resetAllTutorials(); });
    expect(hasSeenFenceSwitching(), "the reset button skipped this one").toBe(false);
  });

  it("is its own key, not the per-type one", () => {
    // Sharing would mean seeing one fence's card suppressed the bar's
    // explanation, or the reverse.
    expect(FENCE_SWITCHING_SEEN_KEY).not.toBe(FENCE_TYPES_SEEN_KEY);
  });

  it("is marked on ARMING, so a death on that map does not replay it", () => {
    const src = read("src/components/game/GameScreen.tsx");
    expect(src).toMatch(/markFenceSwitchingSeen\(\);\s*\n\s*setFenceSwitchIntro\(true\);/);
  });
});

describe("the copy", () => {
  it("is the Manual entry's own, said once", () => {
    // The overlay and the Manual answer the same question, and two copies of an
    // explanation are two things free to disagree after the next balance pass.
    const entry = MANUAL_ENTRIES.find(e => e.id === "fenceSlots");
    expect(entry).toBeTruthy();
    const src = read("src/components/game/GameScreen.tsx");
    expect(src).toContain(`t('${entry!.titleKey}')`);
    expect(src).toContain(`t('${entry!.bodyKey}')`);
  });

  it("says the choice is a MODE, which is the part that was missing", () => {
    const body = locale("en").game.fenceSlotsTutorialBody;
    expect(body).toMatch(/until you pick another/i);
    expect(body, "does not say standard is still there").toMatch(/slot 1/i);
  });

  it("has words in every language", () => {
    for (const loc of LOCALES) {
      const g = locale(loc).game;
      expect(g.fenceSlotsTutorialTitle, `${loc} title`).toBeTruthy();
      expect(g.fenceSlotsTutorialBody, `${loc} body`).toBeTruthy();
      expect(g.fenceSlotsTutorialBody, `${loc} em-dash`).not.toContain("—");
    }
  });
});

describe("the order", () => {
  const gameScreen = read("src/components/game/GameScreen.tsx");
  const slotBar = read("src/components/game/FenceSlotBar.tsx");

  it("holds the type's card behind the overlay", () => {
    // The card is z-[80] and the overlay z-[60], so without this the card lands
    // on top of the thing explaining the bar the card belongs to.
    expect(gameScreen).toMatch(/deferAutoInfo=\{fenceSwitchIntro\}/);
  });

  it("QUEUES that card rather than dropping it", () => {
    // Deferring by simply not opening would lose the card for good: the type is
    // marked seen on the same pass, so nothing would ever offer it again.
    expect(slotBar).toMatch(/setPendingInfoId\(fresh\.id\)/);
    expect(slotBar).toMatch(/if \(!pendingInfoId \|\| deferAutoInfo\) return;/);
  });

  it("marks the type seen when it is FOUND, not when its card opens", () => {
    // A card held back and not yet marked would be re-armed by any remount in
    // between, and shown twice.
    expect(slotBar).toMatch(/markFenceTypeSeen\(fresh\.id\); setPendingInfoId\(fresh\.id\)/);
  });

  it("spotlights the bar it is talking about, at the measured height", () => {
    expect(gameScreen).toMatch(/spotlightArea: 'bottom' as const, spotlightHeightPx: bottomBarsPx/);
  });
});

describe("the fence copy says fence", () => {
  const fences = loadYaml(read("public/fences.yml")) as {
    fences: { id: string; description: string; howTo: string }[];
  };

  it("never leaves a bare 'one' standing in for the fence", () => {
    // "the first ball to bounce off a finished one" - one what? The ball is the
    // other noun in that sentence, and it is the wrong reading.
    for (const f of fences.fences) {
      for (const [field, text] of [["description", f.description], ["howTo", f.howTo]]) {
        expect(text, `${f.id}.${field}`).not.toMatch(/\bfinished one\b/);
        expect(text, `${f.id}.${field}`).not.toMatch(/\ba finished one\b/);
      }
    }
  });

  it("still says what Breakpoint and Redeploy do", () => {
    const byId = new Map(fences.fences.map(f => [f.id, f]));
    expect(byId.get("breakpoint")!.description).toMatch(/finished fence/);
    expect(byId.get("redeploy")!.description).toMatch(/finished fence/);
  });
});
