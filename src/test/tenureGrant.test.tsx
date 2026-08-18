/**
 * Taking a Tenure offer actually hands over the upgrades (issue #75).
 *
 * The roll, the chain walk and the depth thresholds are covered as pure
 * functions elsewhere. What was never exercised is the step after the tap: that
 * the picked chain lands in ownedUpgradeIds and shows up in the modifiers the
 * run is actually played with. A head start that draws a beautiful card and
 * grants nothing would pass every existing test.
 *
 * So this drives the real session hook through the real catalogues, the whole
 * way: a run ended at depth N, Play Again, the draft appears, pick, and then
 * look at what the run is holding.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText } from "@/lib/runRng";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { TENURE_THRESHOLDS } from "@/lib/tenure";
import { META_STATS_STORAGE_KEY } from "@/types/metaProgression";

const PUBLIC = path.resolve(__dirname, "../../public");

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const file = String(url).split("?")[0].replace(/^\//, "");
    const full = path.join(PUBLIC, file);
    if (!fs.existsSync(full)) return { ok: false, status: 404, text: async () => "" } as Response;
    return { ok: true, status: 200, text: async () => fs.readFileSync(full, "utf8") } as Response;
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setRunSeedText(null);
});

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

/** A run that reached `depth` has ended, and Play Again has opened the draft. */
async function atTheDraft(depth: number) {
  localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify({ lastRunDepth: depth }));
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(1, true); });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));

  act(() => { hook.result.current.session.handlePlayAgain(); });
  await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("tenureDraft"));
  return hook;
}

describe("taking a Tenure offer", () => {
  it("grants every upgrade in the picked chain, and nothing from the others", async () => {
    const hook = await atTheDraft(TENURE_THRESHOLDS[2]);
    const offers = hook.result.current.session.pendingTenure!.offers;
    const picked = offers[0];
    const others = offers.slice(1).flatMap(o => o.upgrades.map(u => u.id));

    act(() => { hook.result.current.session.handleTenurePicked(picked.headId); });

    const owned = hook.result.current.session.ownedUpgradeIds;
    for (const u of picked.upgrades) expect(owned, u.id).toContain(u.id);
    for (const id of others) {
      if (picked.upgrades.some(u => u.id === id)) continue; // chains can overlap
      expect(owned, id).not.toContain(id);
    }
  });

  /**
   * The point of the whole feature. Granting the ids means nothing if the run
   * is not then played with their effects, so check the modifiers the game
   * loop will actually see.
   */
  it("puts the chain's effects into the modifiers the run is played with", async () => {
    const hook = await atTheDraft(TENURE_THRESHOLDS[2]);
    const picked = hook.result.current.session.pendingTenure!.offers[0];
    const touched = [...new Set(picked.upgrades.flatMap(u => Object.keys(u.modifiers ?? {})))];
    expect(touched.length, "a granted chain that changes nothing would make this test vacuous")
      .toBeGreaterThan(0);

    act(() => { hook.result.current.session.handleTenurePicked(picked.headId); });

    const active = hook.result.current.session.activeModifiers;
    for (const key of touched) {
      const k = key as keyof GameModifiers;
      expect(active[k], `${picked.name} -> ${key}`).not.toBe(DEFAULT_MODIFIERS[k]);
    }
  });

  it("grants one upgrade at depth 10 and two at depth 20", async () => {
    for (const [depth, expected] of [[TENURE_THRESHOLDS[0], 1], [TENURE_THRESHOLDS[1], 2]] as const) {
      localStorage.clear();
      const hook = await atTheDraft(depth);
      const picked = hook.result.current.session.pendingTenure!.offers[0];
      expect(picked.upgrades, `depth ${depth}`).toHaveLength(expected);

      act(() => { hook.result.current.session.handleTenurePicked(picked.headId); });
      expect(hook.result.current.session.ownedUpgradeIds, `depth ${depth}`).toHaveLength(expected);
    }
  });

  it("leaves the draft screen and starts the run", async () => {
    const hook = await atTheDraft(TENURE_THRESHOLDS[0]);
    const picked = hook.result.current.session.pendingTenure!.offers[0];

    act(() => { hook.result.current.session.handleTenurePicked(picked.headId); });

    expect(hook.result.current.session.pendingTenure).toBeNull();
    expect(hook.result.current.nav.currentScreen).not.toBe("tenureDraft");
  });

  /**
   * The draft is mandatory, so there is no decline button, but a stale id must
   * never strand the player on a screen with nothing left to pick.
   */
  it("still starts the run if the pick does not match an offer", async () => {
    const hook = await atTheDraft(TENURE_THRESHOLDS[0]);

    act(() => { hook.result.current.session.handleTenurePicked("no-such-chain"); });

    expect(hook.result.current.session.pendingTenure).toBeNull();
    expect(hook.result.current.nav.currentScreen).not.toBe("tenureDraft");
    expect(hook.result.current.session.ownedUpgradeIds).toEqual([]);
  });
});
