/**
 * Sprint Planning through the real session hook (SPRINT_PLANNING_PLAN.md):
 * when the draft opens, what each kind of card does to the run once taken,
 * and the Admin switches that make a card reachable on purpose.
 *
 * The deal and the prizes are covered as pure functions in
 * sprintOffers.test.ts. What only a run can show is the step after the tap:
 * lives, banked hours, granted upgrades and modifiers actually reaching the
 * run, and the screen that follows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText } from "@/lib/runRng";
import { UNLOCK_STATE_STORAGE_KEY } from "@/types/metaProgression";
import { resetDevFlagCache, setForcedJackpot, setForcedSprintOffer, setSprintAlwaysOn } from "@/lib/devFlags";
import { SPRINT_PLANNING_ENABLED } from "@/lib/sprintPlanning";

const PUBLIC = path.resolve(__dirname, "../../public");

beforeEach(() => {
  localStorage.clear();
  resetDevFlagCache();
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
  resetDevFlagCache();
});

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

/** A player who has unlocked Sprint Planning, at the draft of a fresh run. */
async function atTheDraft(force?: string) {
  localStorage.setItem(UNLOCK_STATE_STORAGE_KEY, JSON.stringify({ unlockedFeatureIds: ["sprintPlanning"] }));
  if (force) setForcedSprintOffer(force);
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(); });
  await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("runDraft"));
  return hook;
}

type Hook = Awaited<ReturnType<typeof atTheDraft>>;
const cardIndex = (hook: Hook, id: string) => hook.result.current.session.pendingSprint!.cards.findIndex(c => c.offer.id === id);

describe("when the draft opens", () => {
  it("is switched on", () => {
    expect(SPRINT_PLANNING_ENABLED).toBe(true);
  });

  it("deals three cards, one per pool, to a player who has unlocked it", async () => {
    const hook = await atTheDraft();
    expect(hook.result.current.session.pendingSprint!.cards.map(c => c.offer.pool)).toEqual(["boon", "specialisation", "gamble"]);
  });

  it("does not open on the very first run, before it is unlocked", async () => {
    const hook = renderHook(() => useSession());
    await act(async () => { await hook.result.current.session.handleStartGame(); });
    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("game"));
    expect(hook.result.current.session.pendingSprint).toBeNull();
  });

  it("does open before it is unlocked when Admin forces it on", async () => {
    setSprintAlwaysOn(true);
    const hook = renderHook(() => useSession());
    await act(async () => { await hook.result.current.session.handleStartGame(); });
    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("runDraft"));
  });

  it("skips the draft on the debug level jump", async () => {
    localStorage.setItem(UNLOCK_STATE_STORAGE_KEY, JSON.stringify({ unlockedFeatureIds: ["sprintPlanning"] }));
    const hook = renderHook(() => useSession());
    await act(async () => { await hook.result.current.session.handleStartGame(5, true); });
    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("game"));
  });

  it("deals the Daily from its seed: the same cards for everyone, and no Tenure", async () => {
    const deal = async () => {
      localStorage.clear();
      localStorage.setItem(UNLOCK_STATE_STORAGE_KEY, JSON.stringify({ unlockedFeatureIds: ["sprintPlanning"] }));
      localStorage.setItem("jezzball_meta_stats", JSON.stringify({ lastRunDepth: 25 }));
      const hook = renderHook(() => useSession());
      await act(async () => { await hook.result.current.session.handleStartDaily(); });
      await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("runDraft"));
      const cards = hook.result.current.session.pendingSprint!.cards;
      hook.unmount();
      return cards;
    };
    const a = await deal();
    const b = await deal();
    expect(a.some(c => c.tenure)).toBe(false);
    expect(a.map(c => [c.offer.id, c.grants.map(u => u.id)])).toEqual(b.map(c => [c.offer.id, c.grants.map(u => u.id)]));
  });
});

describe("taking a card", () => {
  it("a Specialisation leans the store and puts its signature rule in the run's modifiers", async () => {
    const hook = await atTheDraft("reliability");
    act(() => { hook.result.current.session.handleSprintPick(cardIndex(hook, "reliability")); });

    expect(hook.result.current.nav.currentScreen).toBe("game");
    expect(hook.result.current.session.runOffer?.id).toBe("reliability");
    expect(hook.result.current.session.shopLean).toMatchObject({ tag: "safety", guaranteedSlot: true });
    expect(hook.result.current.session.activeModifiers.openingSlowSeconds).toBe(8);
    expect(hook.result.current.session.modifierSources.some(s => s.kind === "offer" && s.id === "reliability")).toBe(true);
  });

  it("a gamble charges its price and hands over its prize", async () => {
    const hook = await atTheDraft("death_march");
    const livesBefore = hook.result.current.session.currentLives;
    const card = hook.result.current.session.pendingSprint!.cards[cardIndex(hook, "death_march")];
    const lifeFromGrants = card.grants.reduce((n, u) => n + (typeof u.modifiers?.extraLives === "number" ? u.modifiers.extraLives : 0), 0);

    act(() => { hook.result.current.session.handleSprintPick(cardIndex(hook, "death_march")); });

    expect(hook.result.current.session.currentLives).toBe(Math.max(1, livesBefore - 1 + lifeFromGrants));
    for (const u of card.grants) expect(hook.result.current.session.ownedUpgradeIds).toContain(u.id);
    expect(card.grants).toHaveLength(2);
  });

  it("a boon that banks hours banks them", async () => {
    const hook = await atTheDraft("salary_advance");
    const before = hook.result.current.session.totalScore;
    act(() => { hook.result.current.session.handleSprintPick(cardIndex(hook, "salary_advance")); });
    expect(hook.result.current.session.totalScore).toBe(before + 30);
  });

  it("a choose prize goes to the chain pick, and the picked chain is granted", async () => {
    const hook = await atTheDraft("pick_a_junior");
    act(() => { hook.result.current.session.handleSprintPick(cardIndex(hook, "pick_a_junior")); });

    expect(hook.result.current.nav.currentScreen).toBe("chainPick");
    const choices = hook.result.current.session.pendingChainPick!.choices;
    expect(choices.length).toBeGreaterThan(1);
    expect(hook.result.current.session.ownedUpgradeIds).toEqual([]);

    act(() => { hook.result.current.session.handleChainPick(choices[1].headId); });

    expect(hook.result.current.nav.currentScreen).toBe("game");
    expect(hook.result.current.session.ownedUpgradeIds).toEqual(choices[1].upgrades.map(u => u.id));
    expect(hook.result.current.session.pendingChainPick).toBeNull();
  });

  it("skipping takes nothing", async () => {
    const hook = await atTheDraft();
    const lives = hook.result.current.session.currentLives;
    act(() => { hook.result.current.session.handleSprintPick(null); });
    expect(hook.result.current.nav.currentScreen).toBe("game");
    expect(hook.result.current.session.runOffer).toBeNull();
    expect(hook.result.current.session.ownedUpgradeIds).toEqual([]);
    expect(hook.result.current.session.currentLives).toBe(lives);
  });

  it("keeps the taken offer across a resume", async () => {
    const hook = await atTheDraft("platform");
    act(() => { hook.result.current.session.handleSprintPick(cardIndex(hook, "platform")); });
    await waitFor(() => expect(localStorage.getItem("jezzball_run_v1")).toContain("\"takenOfferId\":\"platform\""));
  });
});

describe("Admin", () => {
  it("can force the jackpot, and a forced draw never files on the ledger", async () => {
    setForcedJackpot(true);
    const hook = await atTheDraft();
    expect(hook.result.current.session.pendingSprint!.cards[2].offer.jackpot).toBe(true);
  });

  it("can force a locked Specialisation onto the table", async () => {
    const hook = await atTheDraft("containment");
    expect(hook.result.current.session.pendingSprint!.cards[1].offer.id).toBe("containment");
  });
});

describe("meeting an archetype", () => {
  it("unlocks that tag's Specialisation for later runs", async () => {
    const hook = await atTheDraft("containment");
    act(() => { hook.result.current.session.handleSprintPick(cardIndex(hook, "containment")); });
    // Containment counts as one lock toward the set: two lock purchases light it.
    const locks = hook.result.current.session.upgrades
      .filter(u => u.tags?.includes("lock") && !(u.prerequisites?.length))
      .slice(0, 2);
    for (const u of locks) act(() => { hook.result.current.session.handlePurchaseUpgrade(u.id, 0); });
    await waitFor(() => expect(hook.result.current.session.metArchetypes).toContain("lock"));
    expect(hook.result.current.session.lastRunOfferUnlocks).toContain("Containment");
  });
});
