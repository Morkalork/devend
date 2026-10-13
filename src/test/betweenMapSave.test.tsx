/**
 * "Always make a save after a finished map, so that if you close the game in
 * the store view, that is where you continue next."
 *
 * The run save used to be written only when a map began (plus a page-hide
 * flush that wrote the FINISHED map's index with its hours already banked, so
 * a resume replayed a map it had just paid for). Now finishing a map writes a
 * save marked as between maps, again at each stage after it, and Continue goes
 * back to the stage it was saved on, with what that stage had dealt.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { abilityOffersFor, rollAbilityOffers } from "@/lib/abilityOffer";

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
const saved = () => JSON.parse(localStorage.getItem("jezzball_run_v1")!);

async function startAndFinishFirstMap() {
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(undefined, true); });
  await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("game"));
  const before = hook.result.current.session.totalScore;
  await act(async () => {
    hook.result.current.session.handleLevelComplete({
      levelId: hook.result.current.session.currentLevel!.id,
      levelScore: 30, cutCount: 4, expectedCuts: 5, remainingPercent: 20, lockedBallsCount: 2,
    } as never);
  });
  return { ...hook, before };
}

describe("a finished map is saved", () => {
  it("the moment it is won, as between maps, with its hours banked and its results kept", async () => {
    const { result, before } = await startAndFinishFirstMap();
    const s = saved();
    expect(s.currentLevelIndex).toBe(0);
    expect(s.betweenMaps.stage).toBe("debrief");
    expect(s.betweenMaps.levelScore.lockedBallsCount).toBe(2);
    expect(s.totalScore).toBe(result.current.session.totalScore);
    expect(s.totalScore).toBeGreaterThan(before);
  });

  it("again in the store, with the shelf it dealt", async () => {
    const { result } = await startAndFinishFirstMap();
    await act(async () => { result.current.session.handleContinueFromOverlay(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("upgradeShop"));
    expect(saved().betweenMaps.stage).toBe("store");
    await act(async () => { result.current.session.handleShopDealt({ offerIds: ["a", "b", "c"], abilityIds: ["x"] }); });
    expect(saved().betweenMaps.store.dealt).toEqual({ offerIds: ["a", "b", "c"], abilityIds: ["x"] });
    expect(saved().betweenMaps.store.closed).toBe(result.current.session.storeClosed);
  });

  it("and back to an ordinary map save once the store is left", async () => {
    const { result } = await startAndFinishFirstMap();
    await act(async () => { result.current.session.handleContinueFromOverlay(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("upgradeShop"));
    await act(async () => { result.current.session.handleContinueFromShop(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    expect(saved().currentLevelIndex).toBe(1);
    expect(saved().betweenMaps).toBeUndefined();
  });
});

describe("Continue after closing between maps", () => {
  it("closed in the store: reopens that store, same shelf, same wallet, same map index", async () => {
    const { result, unmount } = await startAndFinishFirstMap();
    await act(async () => { result.current.session.handleContinueFromOverlay(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("upgradeShop"));
    await act(async () => { result.current.session.handleShopDealt({ offerIds: ["a", "b", "c"], abilityIds: [] }); });
    const wallet = result.current.session.totalScore;
    const closed = result.current.session.storeClosed;
    unmount();

    const cold = renderHook(() => useSession());
    await act(async () => { await cold.result.current.session.handleContinueRun(); });
    await waitFor(() => expect(cold.result.current.nav.currentScreen).toBe("upgradeShop"));
    expect(cold.result.current.session.currentLevelIndex).toBe(0);
    expect(cold.result.current.session.totalScore).toBe(wallet);
    expect(cold.result.current.session.storeClosed).toBe(closed);
    expect(cold.result.current.session.storeDealt).toEqual({ offerIds: ["a", "b", "c"], abilityIds: [] });

    // And leaving it plays the NEXT map, not the one already banked.
    await act(async () => { cold.result.current.session.handleContinueFromShop(); });
    await waitFor(() => expect(cold.result.current.nav.currentScreen).toBe("game"));
    expect(cold.result.current.session.currentLevelIndex).toBe(1);
  });

  it("closed on the map's card: goes on past it, not back into the map", async () => {
    const { unmount } = await startAndFinishFirstMap();
    unmount();
    const cold = renderHook(() => useSession());
    await act(async () => { await cold.result.current.session.handleContinueRun(); });
    await waitFor(() => expect(cold.result.current.nav.currentScreen).not.toBe("welcome"));
    expect(["upgradeShop", "capstoneDraft"]).toContain(cold.result.current.nav.currentScreen);
    expect(cold.result.current.session.currentLevelIndex).toBe(0);
  });
});

describe("what a store visit dealt comes back as dealt", () => {
  it("rebuilds the ability cards from their ids, price and all", () => {
    let i = 0;
    const rng = () => [0.1, 0.7, 0.4, 0.9][i++ % 4];
    const rolled = rollAbilityOffers(12, 8, [], 2, rng, 3);
    expect(rolled.length).toBeGreaterThan(0);
    const back = abilityOffersFor(rolled.map(o => o.grantsAbility!), 12, 8);
    expect(back).toEqual(rolled);
  });

  it("the store takes the dealt shelf instead of rolling, and reports what it dealt", () => {
    const shop = read("src/ui/screens/UpgradeShop.tsx");
    expect(shop).toContain("return dealt.offerIds.flatMap(id => byId.get(id) ?? []);");
    expect(shop).toContain("? abilityOffersFor(dealt.abilityIds, completedLevel, mapsRemaining)");
    expect(shop).toContain("onDealt?.({");
    expect(read("src/pages/Index.tsx")).toContain("dealt={session.storeDealt}");
  });

  it("a resumed store never rolls a second free ability", () => {
    const src = read("src/hooks/useGameSession.ts");
    const route = src.slice(src.indexOf("if (between.stage === 'store' && between.store) {"));
    const storePath = route.slice(0, route.indexOf("return;"));
    expect(storePath).toContain("setFreeAbilityGrant(between.store.freeAbilityGrant);");
    expect(storePath).not.toContain("proceedToShop");
  });
});
