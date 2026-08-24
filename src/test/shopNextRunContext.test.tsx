/**
 * The shop describes the map you are about to play, not the one you just left.
 *
 * The shop sits BETWEEN maps, and the session's own `runContext` still points
 * at the map that was completed. Handing that to the shop would produce a chip
 * that says "live" about a map already behind the player: they buy on the
 * strength of it and the number never appears. That is the exact failure the
 * condition chip exists to prevent, reintroduced by an off-by-one.
 *
 * Guards which level `nextRunContext` reads, so an edit to the index cannot
 * silently flip the shop's promise back one map.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText } from "@/lib/runRng";
import { mapContextOf } from "@/lib/upgradeConditions";

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
  window.history.replaceState(null, "", "/");
});

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

async function startRun() {
  window.history.replaceState(null, "", "/");
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(undefined, true); });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
  return hook;
}

describe("the shop's run context", () => {
  it("describes the NEXT level, one ahead of the one just completed", async () => {
    const hook = await startRun();
    const s = () => hook.result.current.session;

    // Fresh run: currentLevelIndex is 0, so the shop is selling into level 2.
    expect(s().currentLevelIndex).toBe(0);
    const next = s().nextRunContext;
    expect(next).not.toBeNull();
    expect(next!.level).toBe(2);

    // And the features it reports are level 2's, read the same way the
    // evaluator reads them: not the level just played.
    expect(next!.map).toEqual(mapContextOf(s().nextLevel));
    // The two must genuinely be different objects to compare, or this test
    // proves nothing: level 1 and level 2 differ in ball count by design.
    expect(next!.map).not.toEqual(mapContextOf(s().currentLevel));
  });

  it("carries the run state the player actually holds right now", async () => {
    const hook = await startRun();
    const s = () => hook.result.current.session;
    expect(s().nextRunContext!.banked).toBe(s().totalScore);
    expect(s().nextRunContext!.depth).toBe(s().ascensionDepth);

    // Lives as they stand, not as they stood at the START of the map just
    // played. Asserting this on a fresh run would prove nothing, because the
    // two are equal until a life is actually lost, so lose one first.
    const before = s().currentLives;
    expect(before).toBeGreaterThan(1);
    await act(async () => { s().handleLivesChange(before - 1); });
    await waitFor(() => expect(s().currentLives).toBe(before - 1));

    // The stale reading would still be `before`; the shop must report the
    // life the player actually has as they stand at the counter.
    expect(s().nextRunContext!.lives).toBe(before - 1);
  });
});
