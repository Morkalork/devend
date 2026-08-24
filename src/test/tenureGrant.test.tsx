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
import { conditionMet } from "@/lib/upgradeConditions";

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
   *
   * Split by CONDITION, because a conditional upgrade that changes nothing is
   * the feature working rather than failing. Free Fall's Principal option only
   * bends gravity on maps that have a well, and a Tenure run opens on level 1,
   * which has none: asserting it moved the number would be asserting that the
   * condition is ignored.
   *
   * Both halves are checked, so nothing is merely excused. A live upgrade must
   * land, and a dormant one must land NOTHING - not a reduced amount, the
   * default. Without the second half this test would pass just as happily if
   * conditions silently disabled upgrades that should have been live.
   *
   * The offer is rolled with an unseeded Math.random, so which chain arrives
   * here differs run to run. That is why this holds for whatever is picked
   * instead of for one sampled chain: the old version asserted a property of
   * all offers against a single random one, and passed locally and failed in CI
   * on the same commit.
   */
  it("puts the chain's effects into the modifiers the run is played with", async () => {
    // EVERY offer in the roll, each on its own fresh run, rather than the one
    // that happened to land first. Three chains a run instead of one, and the
    // check no longer depends on which of them Math.random put in slot zero.
    const probe = await atTheDraft(TENURE_THRESHOLDS[2]);
    const offerCount = probe.result.current.session.pendingTenure!.offers.length;
    expect(offerCount).toBeGreaterThan(1);

    let checkedLive = 0, checkedDormant = 0;

    for (let index = 0; index < offerCount; index++) {
      localStorage.clear();
      const hook = await atTheDraft(TENURE_THRESHOLDS[2]);
      const picked = hook.result.current.session.pendingTenure!.offers[index];
      const touched = [...new Set(picked.upgrades.flatMap(u => Object.keys(u.modifiers ?? {})))];
      expect(touched.length, `${picked.name}: a chain that changes nothing would be vacuous`)
        .toBeGreaterThan(0);

      act(() => { hook.result.current.session.handleTenurePicked(picked.headId); });

      const ctx = hook.result.current.session.runContext;
      const keysOf = (ups: typeof picked.upgrades) =>
        new Set(ups.flatMap(u => Object.keys(u.modifiers ?? {})));
      const liveKeys = keysOf(picked.upgrades.filter(u => conditionMet(u.condition, ctx)));
      const dormantKeys = keysOf(picked.upgrades.filter(u => !conditionMet(u.condition, ctx)));

      const active = hook.result.current.session.activeModifiers;

      // Everything a live upgrade touches has to reach the run.
      for (const key of liveKeys) {
        const k = key as keyof GameModifiers;
        expect(active[k], `${picked.name} -> ${key} (live)`).not.toBe(DEFAULT_MODIFIERS[k]);
        checkedLive++;
      }

      // And everything ONLY a dormant upgrade touches must be untouched. Keys a
      // live upgrade also writes are excluded: the live one is why they moved.
      for (const key of dormantKeys) {
        if (liveKeys.has(key)) continue;
        const k = key as keyof GameModifiers;
        expect(active[k], `${picked.name} -> ${key} (condition unmet)`).toBe(DEFAULT_MODIFIERS[k]);
        checkedDormant++;
      }

      // Every touched key falls into one branch or the other, so a chain
      // cannot slip through by being counted as neither.
      expect(new Set([...liveKeys, ...dormantKeys]), picked.name).toEqual(new Set(touched));
    }

    // The live half must actually have run. The dormant half is not required:
    // most rolls contain no conditional upgrade at all, and demanding one would
    // reintroduce exactly the dependence on the roll this test just removed.
    expect(checkedLive, "no live modifier was ever checked").toBeGreaterThan(0);
    void checkedDormant;
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
