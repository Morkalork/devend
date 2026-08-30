/**
 * Tenure may only offer upgrades the finished run could actually have bought.
 *
 * The reward is "here is the chain you were working toward, already started".
 * That only reads as a reward if the card is one the run had seen on a shelf.
 * Handing over an upgrade that never appeared in a single shop reads as the
 * game inventing something new at the moment it pays out.
 *
 * The subtlety is that the depth reached does NOT answer the question. Dying on
 * level 10 and retiring after clearing level 10 both end a run "at 10", but the
 * first never saw level 10's shop and the second did. So the run records the
 * deepest shop it reached as its own fact, and the availability gate reads that
 * rather than the depth.
 *
 * The thresholds still key off depth: dying on level 10 has always earned a
 * head start, and that is not what changes here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { eligibleTenureChains, TENURE_THRESHOLDS } from "@/lib/tenure";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { useMetaProgression } from "@/hooks/useMetaProgression";
import { setRunSeedText } from "@/lib/runRng";
import { META_STATS_STORAGE_KEY } from "@/types/metaProgression";
import type { UpgradeConfig } from "@/types/upgrade";
import type { GameResult } from "@/types/game";

const PUBLIC = path.resolve(__dirname, "../../public");
const UPGRADES = (yaml.load(
  readFileSync(path.resolve(PUBLIC, "upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;

const unlockLevelOf = (id: string) =>
  UPGRADES.find(u => u.id === id)?.unlockLevel ?? 1;

/** Every upgrade any offer would grant at this depth / shop level. */
const grantedAt = (reached: number, shoppedThrough: number) =>
  eligibleTenureChains(UPGRADES, reached, () => 0.5, shoppedThrough)
    .flatMap(o => o.upgrades);

describe("what a run's depth makes available", () => {
  it("never offers a card that unlocks deeper than the last shop reached", () => {
    for (const shopped of [9, 11, 15, 19, 21, 24, 29, 30]) {
      const reached = Math.max(shopped, TENURE_THRESHOLDS[0]);
      for (const u of grantedAt(reached, shopped)) {
        expect(u.unlockLevel ?? 1, `${u.id} offered after shopping through ${shopped}`)
          .toBeLessThanOrEqual(shopped);
      }
    }
  });

  /**
   * The concrete case this was reported for: an upgrade unlocking at exactly
   * the level you died on had never been on sale that run, and Tenure offered
   * it anyway.
   *
   * Written against the RULE rather than one id. It used to name
   * deadline_extension_junior, which was the only level-10 upgrade with no
   * prerequisite - and then Deadline Extension was gated behind Padded Estimate
   * and the fixture evaporated. The rule did not change; only the example did,
   * so the example is now found rather than hardcoded.
   */
  it("never offers an upgrade from a shop the run never reached", () => {
    for (const reached of [8, 10, 12, 14]) {
      const died = grantedAt(reached, reached - 1);
      const tooNew = died.filter(u => (u.unlockLevel ?? 1) >= reached);
      expect(tooNew.map(u => u.id), `offered after dying on level ${reached}`).toEqual([]);
    }
  });

  it("does offer it once that shop was actually visited", () => {
    // The other half: the guard above is trivially satisfied by offering
    // nothing at all, so something reaching the level must still come through.
    const cleared = grantedAt(14, 14);
    expect(cleared.length, "nothing offered at all").toBeGreaterThan(0);
  });

  it("still pays the full chain at depth 30, since the gate is not a tier limit", () => {
    const offers = eligibleTenureChains(UPGRADES, TENURE_THRESHOLDS[2], () => 0.5, 29);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) expect(o.upgrades, o.name).toHaveLength(3);
  });

  it("leaves every depth with something to choose between", () => {
    for (const shopped of [9, 19, 29]) {
      const offers = eligibleTenureChains(UPGRADES, Math.max(shopped, 10), () => 0.5, shopped);
      expect(offers.length, `shopped through ${shopped}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── What the run records ─────────────────────────────────────────────────────

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

const storedStats = () => JSON.parse(localStorage.getItem(META_STATS_STORAGE_KEY) || "{}");

/** End a run on `level`, won or lost, and return what it recorded. */
async function endRunOn(level: number, isWin: boolean) {
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(level, true); });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));

  const result: GameResult = {
    isWin, remainingPercent: isWin ? 30 : 80, levelId: `l${level}`, levelNumber: level,
  };
  act(() => { hook.result.current.session.handleGameEnd(result); });
  await waitFor(() => expect(storedStats().lastRunDepth).toBe(level));
  return storedStats();
}

describe("the shop level a run records", () => {
  it("stops one short of the level it died on", async () => {
    const stats = await endRunOn(12, false);
    expect(stats.lastRunDepth).toBe(12);
    expect(stats.lastRunShopLevel).toBe(11);
  });

  it("includes the level it cleared before retiring", async () => {
    const stats = await endRunOn(12, true);
    expect(stats.lastRunDepth).toBe(12);
    expect(stats.lastRunShopLevel).toBe(12);
  });

  it("never goes negative when the very first level is lost", async () => {
    const stats = await endRunOn(1, false);
    expect(stats.lastRunShopLevel).toBe(0);
  });
});

/**
 * Saves written before this field existed still remember a depth and are still
 * owed a head start for it. Assume the common ending, a death, so the reward
 * errs one level low rather than handing over a card that run never saw.
 */
describe("a save from before the shop level was recorded", () => {
  it("assumes the run died rather than retired", async () => {
    localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify({ lastRunDepth: 20 }));
    const meta = renderHook(() => useMetaProgression());
    await waitFor(() => expect(meta.result.current.stats.lastRunDepth).toBe(20));
    expect(meta.result.current.stats.lastRunShopLevel).toBe(19);
  });

  it("leaves a save that never reached a run end alone", async () => {
    localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify({ highestLevelReached: 4 }));
    const meta = renderHook(() => useMetaProgression());
    await waitFor(() => expect(meta.result.current.stats.highestLevelReached).toBe(4));
    expect(meta.result.current.stats.lastRunShopLevel).toBe(0);
  });
});

/**
 * The gate is wired to the recorded shop level, not to the depth.
 *
 * Checking the offers on screen cannot show this on its own: only three of the
 * eligible chains are drawn, so a card that should have been excluded can be
 * absent by luck. A run recorded as deep but never past level 1's shop has NO
 * chain it could be paid in, which is a difference the whole screen shows.
 */
describe("the gate the draft actually uses", () => {
  it("skips the draft when nothing the run saw can pay the reward", async () => {
    localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify({
      lastRunDepth: TENURE_THRESHOLDS[2], lastRunShopLevel: 1,
    }));
    const hook = renderHook(() => useSession());
    await act(async () => { await hook.result.current.session.handleStartGame(1, true); });
    await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));

    act(() => { hook.result.current.session.handlePlayAgain(); });

    await waitFor(() => expect(hook.result.current.nav.currentScreen).not.toBe("result"));
    expect(hook.result.current.nav.currentScreen).not.toBe("tenureDraft");
    expect(hook.result.current.session.pendingTenure).toBeNull();
  });
});
