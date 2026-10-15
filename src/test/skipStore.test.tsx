/**
 * The store is optional: the map's card offers a way straight on to the next
 * map, under "Open the store".
 *
 * A skipped store is an arrival with nothing bought. The run goes to the next
 * map without the shop screen ever opening, the bank is untouched by any
 * purchase, and the card only offers the skip when the store really is next
 * (a due Promotion is still picked first, and the last map has no next map).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { nextStage, type BetweenMapPlan } from "@/ui/screens/pipelineModel";

const PUBLIC = path.resolve(__dirname, "../../public");
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const file = String(url).split("?")[0].replace(/^\//, "");
    const full = path.join(PUBLIC, file);
    if (!fs.existsSync(full)) return { ok: false, status: 404, text: async () => "" } as Response;
    return { ok: true, status: 200, text: async () => fs.readFileSync(full, "utf8") } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

describe("skipping the store from the map's card", () => {
  it("goes straight to the next map, and the shop never opens", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    const firstMap = result.current.session.currentLevelIndex;

    await act(async () => {
      result.current.session.handleLevelComplete({
        levelId: result.current.session.currentLevel!.id,
        levelScore: 30, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
        lockedBallsCount: 2,
      } as never);
    });
    expect(result.current.session.showLevelComplete).toBe(true);
    expect(result.current.session.betweenMapPlan.store).toBe(true);
    const bank = result.current.session.totalScore;

    const screens: string[] = [];
    await act(async () => {
      result.current.session.handleSkipStoreFromOverlay();
    });
    screens.push(result.current.nav.currentScreen);
    await waitFor(() => expect(result.current.session.currentLevelIndex).toBe(firstMap + 1));

    expect(screens).not.toContain("upgradeShop");
    expect(result.current.nav.currentScreen).toBe("game");
    expect(result.current.session.showLevelComplete).toBe(false);
    expect(result.current.session.pendingLevelScore).toBeNull();
    // Nothing bought: the bank is what the map paid (plus any interest, never less).
    expect(result.current.session.totalScore).toBeGreaterThanOrEqual(bank);
  });

  it("keeps a free-item voucher, since its free offer was never on screen", () => {
    const src = read("src/hooks/useGameSession.ts");
    expect(src).toContain("if (sawShelf && !storeClosed && carryFreeShopItems > 0) {");
    expect(src).toContain("leaveStore(false, interest);");
    expect(src).toContain("leaveStore(true);");
  });
});

describe("the card offers the skip only when the store is next", () => {
  const plan = (p: Partial<BetweenMapPlan>): BetweenMapPlan => ({ clearedLevel: 4, promotion: false, store: true, last: false, ...p });

  it("follows the pipeline: the store next, not a Promotion or the finish", () => {
    expect(nextStage(plan({}), "debrief")).toBe("store");
    expect(nextStage(plan({ promotion: true }), "debrief")).toBe("promotion");
    expect(nextStage(plan({ last: true }), "debrief")).toBe("next");
  });

  it("is wired that way, and disabled with the button above it", () => {
    const overlay = read("src/ui/screens/LevelCompleteOverlay.tsx");
    expect(overlay).toContain('const canSkipStore = !!onSkipStore && nextStage(plan, "debrief") === "store";');
    expect(overlay).toContain('t("pipeline.skipStore", { level: plan.clearedLevel + 1 })');
    // Both buttons share the same gate, so the skip cannot fire before the card is filled in.
    expect(overlay.match(/disabled=\{chosen \|\| !buttonReady \|\| waiting\}/g)).toHaveLength(2);
    expect(read("src/pages/Index.tsx")).toContain("onSkipStore={session.handleSkipStoreFromOverlay}");
  });

  it("is labelled in every language, without an em-dash", () => {
    for (const lang of ["en", "es", "sv"]) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`)) as { pipeline: Record<string, string> };
      expect(locale.pipeline.skipStore, lang).toContain("{{level}}");
      expect(locale.pipeline.skipStore, lang).not.toContain("—");
    }
  });
});
