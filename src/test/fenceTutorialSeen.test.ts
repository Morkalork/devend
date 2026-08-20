/**
 * The Draw-A-Fence tutorial must not come back once you have read it.
 *
 * It used to be marked seen ONLY by completing the guided cut
 * (onTutorialCutSuccess). Dismissing the explainer modal persisted nothing, so
 * anyone who read it and then failed to finish level 1 got it again on the next
 * run, and the next, forever. Dying on the first map is not a rare event, and
 * reloading a ?level= or ?ascension= debug jump hits it every single time.
 *
 * Two halves are checked separately, because they fail differently: that the
 * flag survives once written (a storage question), and that dismissing is one
 * of the things that writes it (a wiring question, checked at the source since
 * GameScreen is far too heavy to mount here).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useTutorialManager } from "@/hooks/useTutorialManager";

beforeEach(() => localStorage.clear());

describe("the fence tutorial flag", () => {
  it("is armed for a fresh install", () => {
    const { result } = renderHook(() => useTutorialManager());
    expect(result.current.shouldShowFence).toBe(true);
  });

  it("stays down once marked, across a reload", () => {
    const first = renderHook(() => useTutorialManager());
    act(() => { first.result.current.markFenceSeen(); });
    expect(first.result.current.shouldShowFence).toBe(false);

    const reloaded = renderHook(() => useTutorialManager());
    expect(reloaded.result.current.shouldShowFence).toBe(false);
  });

  it("survives being marked twice, since dismiss and cut-success both mark it", () => {
    const { result } = renderHook(() => useTutorialManager());
    act(() => { result.current.markFenceSeen(); });
    act(() => { result.current.markFenceSeen(); });
    expect(result.current.shouldShowFence).toBe(false);
  });

  it("comes back after Re-enable All Tutorials, which is the only way back", () => {
    const { result } = renderHook(() => useTutorialManager());
    act(() => { result.current.markFenceSeen(); });
    act(() => { result.current.resetAllTutorials(); });
    expect(result.current.shouldShowFence).toBe(true);
  });
});

/**
 * The wiring half. GameScreen mounts a canvas and a whole game loop, so this
 * reads the source instead: what matters is that the fence explainer's dismiss
 * handler reaches onFenceSeen at all, which is a one-line relationship that was
 * simply absent.
 */
describe("dismissing the explainer", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/game/GameScreen.tsx"), "utf8",
  );

  /** The fence explainer's entry in the queue, from its `show:` to its close. */
  const fenceEntry = (): string => {
    const start = SRC.indexOf("show: fenceIntroOpen");
    expect(start, "fence explainer queue entry not found: has it been renamed?")
      .toBeGreaterThan(-1);
    const end = SRC.indexOf("},", SRC.indexOf("onDismiss:", start));
    return SRC.slice(start, end);
  };

  it("marks the tutorial seen rather than only closing the modal", () => {
    expect(
      fenceEntry(),
      "dismissing the fence explainer must call onFenceSeen, or it re-arms every run",
    ).toContain("onFenceSeen");
  });

  it("still closes the modal, so the guided hint can start", () => {
    expect(fenceEntry()).toContain("setFenceIntroOpen(false)");
  });
});
