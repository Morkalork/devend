/**
 * Pressing play has to look like it did something, for as long as it takes.
 *
 * Reported: "sometimes when the first level starts, after launching the game,
 * there is a brief pause before the game starts."
 *
 * There were two phases and only one of them was covered.
 *
 * AFTER the screen changes, GameScreen already shows a "Loading" sign over the
 * board while the renderer starts and the board assembles in, fading out the
 * instant the canvas presents. That half was fine.
 *
 * BEFORE it, a run start awaits ELEVEN catalogues in one Promise.all - levels,
 * upgrades, certificates, loadouts, balls, abilities, features, assignments,
 * capstones, mutators and objectives - and the menu's spinner was driven by
 * `isLoadingLevels || isLoadingUpgrades`: the FIRST TWO to resolve. So the
 * spinner stopped, the button went back to looking idle, and the navigation
 * carried on waiting for the other nine. That is the pause, and it is on the
 * menu, where a sign behind the board could never have reached it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import "@/i18n";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { WelcomeScreen } from "@/components/game/WelcomeScreen";

const PUBLIC = path.resolve(__dirname, "../../public");

/**
 * Levels and upgrades land immediately; everything else is held open.
 *
 * This is the exact shape of the bug, and holding ALL of them was why the first
 * version of this test passed with the fix reverted: while levels and upgrades
 * were still in flight their own loading flags were true, so `isLoading` was
 * true for the wrong reason and the mutation slipped through. The gap only
 * exists in the window where those two have RESOLVED and the other nine have
 * not, so the test has to build that window on purpose.
 */
const FIRST_PAIR = ["map.yml", "upgrades.yml"];
let release: Array<() => void> = [];
function stagedFetch() {
  return vi.fn(async (url: string) => {
    const file = String(url).split("?")[0].replace(/^\//, "");
    const full = path.join(PUBLIC, file);
    if (!FIRST_PAIR.includes(file)) {
      await new Promise<void>(r => release.push(r));
    }
    if (!fs.existsSync(full)) return { ok: false, status: 404, text: async () => "" } as Response;
    return { ok: true, status: 200, text: async () => fs.readFileSync(full, "utf8") } as Response;
  });
}

beforeEach(() => {
  localStorage.clear();
  release = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

describe("the menu says it is working for the whole boot", () => {
  it("stays loading until every catalogue has landed, not just the first two", () => {
    // The exact regression: levels and upgrades resolve first, and the flag
    // used to go false right there while nine fetches were still in flight.
    vi.stubGlobal("fetch", stagedFetch());
    const { result } = renderHook(() => useSession());

    expect(result.current.session.isLoading, "loading before anything started").toBe(false);

    act(() => { void result.current.session.handleStartGame(); });

    return waitFor(() => {
      expect(release.length, "the slow catalogues never started").toBeGreaterThanOrEqual(9);
    }).then(async () => {
      // Let levels and upgrades finish. This settle is the whole test: waitFor
      // succeeds on ANY passing snapshot, so asserting inside it passed on an
      // early moment when levels was still loading and `isLoading` was true for
      // the wrong reason - the mutation survived until this was pulled out.
      await act(async () => { await new Promise(r => setTimeout(r, 20)); });

      // The nine are still held, and only the boot flag can be keeping the
      // menu busy now. This IS the window the bug lived in.
      expect(release.length).toBeGreaterThanOrEqual(9);
      expect(
        result.current.session.isLoading,
        "the menu went idle while nine catalogues were still loading",
      ).toBe(true);

      await act(async () => {
        for (const r of release) r();
        await new Promise(r => setTimeout(r, 0));
      });
      await waitFor(() => expect(result.current.session.isLoading).toBe(false));
    });
  });

  it("clears the flag even when a catalogue fetch blows up", () => {
    // Without a finally, one rejected fetch leaves the menu spinning forever
    // with no way back into the game.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network gone"); }));
    const { result } = renderHook(() => useSession());

    return act(async () => {
      try { await result.current.session.handleStartGame(); } catch { /* expected */ }
    }).then(async () => {
      await waitFor(() =>
        expect(result.current.session.isLoading, "the menu is stuck loading").toBe(false),
      );
    });
  });
});

describe("the menu shows it", () => {
  it("puts the button in a loading state while the run boots", () => {
    render(
      <WelcomeScreen
        onStartGame={vi.fn()}
        onTutorial={vi.fn()}
        onOptions={vi.fn()}
        isLoading
      />,
    );
    // Whatever it says, the play control must not be pressable while booting:
    // a second press would start the whole load again.
    const disabled = screen.getAllByRole("button").filter(b => (b as HTMLButtonElement).disabled);
    expect(disabled.length, "nothing is disabled while loading").toBeGreaterThan(0);
  });

  it("leaves it pressable when nothing is loading", () => {
    render(
      <WelcomeScreen
        onStartGame={vi.fn()}
        onTutorial={vi.fn()}
        onOptions={vi.fn()}
        isLoading={false}
      />,
    );
    const disabled = screen.getAllByRole("button").filter(b => (b as HTMLButtonElement).disabled);
    expect(disabled.length, "the menu is disabled when it should be idle").toBe(0);
  });
});
