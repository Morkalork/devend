/**
 * The main menu says which ascension depth is waiting behind Continue.
 *
 * At depth the run plays by rules the menu never mentioned: the store opens
 * every other level, there is no Promotion, fences wear out. Resuming into that
 * blind is a genuine surprise, and the menu already knew, since the depth is
 * part of the save it is offering to resume.
 *
 * The summary is derived from the save rather than tracked beside it, so the
 * tests here are mostly about it staying in step: written on save, gone on
 * clear, and read back from storage on a fresh boot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, renderHook, act } from "@testing-library/react";
import { useRunSave } from "@/hooks/useRunSave";
import { WelcomeScreen } from "@/components/game/WelcomeScreen";
import type { RunSaveInput } from "@/hooks/useRunSave";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
  }),
}));

/** A save the loader will accept: it validates the level sequence and index. */
const baseSave = (over: Partial<RunSaveInput> = {}): RunSaveInput => ({
  levelSequenceIds: ["l1", "l2", "l3"],
  currentLevelIndex: 2,
  totalScore: 120,
  ownedUpgradeIds: [],
  lives: 3,
  continuesRemaining: 0,
  activeDoorId: null,
  capstoneId: null,
  ascensionDepth: 0,
  draftedLoadoutIds: [],
  ...over,
} as unknown as RunSaveInput);

beforeEach(() => localStorage.clear());
afterEach(() => vi.clearAllMocks());

describe("the saved run summary", () => {
  it("is absent with no save", () => {
    const { result } = renderHook(() => useRunSave());
    expect(result.current.hasSavedRun).toBe(false);
    expect(result.current.savedRun).toBeNull();
  });

  it("carries the depth the run was saved at", () => {
    const { result } = renderHook(() => useRunSave());
    act(() => { result.current.saveRun(baseSave({ ascensionDepth: 4 })); });
    expect(result.current.savedRun?.ascensionDepth).toBe(4);
  });

  it("reports depth 0 for an unascended run rather than hiding the save", () => {
    const { result } = renderHook(() => useRunSave());
    act(() => { result.current.saveRun(baseSave({ ascensionDepth: 0 })); });
    expect(result.current.hasSavedRun).toBe(true);
    expect(result.current.savedRun?.ascensionDepth).toBe(0);
  });

  it("goes away when the run is cleared", () => {
    const { result } = renderHook(() => useRunSave());
    act(() => { result.current.saveRun(baseSave({ ascensionDepth: 2 })); });
    act(() => { result.current.clearRun(); });
    expect(result.current.savedRun).toBeNull();
    expect(result.current.hasSavedRun).toBe(false);
  });

  /** A save written last session must still be described on the next boot. */
  it("is read back from storage on a fresh mount", () => {
    const first = renderHook(() => useRunSave());
    act(() => { first.result.current.saveRun(baseSave({ ascensionDepth: 6 })); });

    const second = renderHook(() => useRunSave());
    expect(second.result.current.savedRun?.ascensionDepth).toBe(6);
  });

  /**
   * The summary is read back through the loader, not summarised from what was
   * just written, so it can only ever describe a save that would actually
   * resume. A write the loader would refuse leaves Continue hidden rather than
   * offering a run that is not there.
   */
  it("stays silent about a save the loader would refuse", () => {
    const { result } = renderHook(() => useRunSave());
    act(() => {
      result.current.saveRun(baseSave({ levelSequenceIds: [] } as Partial<RunSaveInput>));
    });
    expect(result.current.savedRun).toBeNull();
    expect(result.current.hasSavedRun).toBe(false);
  });

  /** Saves written before the field existed must not read as NaN on the menu. */
  it("treats a save with no depth as depth 0", () => {
    const { result } = renderHook(() => useRunSave());
    const legacy = baseSave();
    delete (legacy as Record<string, unknown>).ascensionDepth;
    act(() => { result.current.saveRun(legacy); });
    expect(result.current.savedRun?.ascensionDepth).toBe(0);
  });
});

describe("what the menu shows", () => {
  const menu = (props: Record<string, unknown> = {}) =>
    render(
      <WelcomeScreen
        onStartGame={() => {}}
        onTutorial={() => {}}
        onOptions={() => {}}
        {...props}
      />,
    );

  it("says nothing about ascension on an unascended save", () => {
    menu({ onContinue: () => {}, savedRunAscension: 0 });
    expect(screen.queryByText(/ascension\.ladderTitle/)).toBeNull();
  });

  it("names the depth waiting behind Continue", () => {
    menu({ onContinue: () => {}, savedRunAscension: 4 });
    expect(screen.getByText("ascension.ladderTitle:4")).toBeTruthy();
  });

  it("says nothing when there is no save to continue", () => {
    menu({ savedRunAscension: 4 });
    expect(screen.queryByText(/ascension\.ladderTitle/)).toBeNull();
  });
});
