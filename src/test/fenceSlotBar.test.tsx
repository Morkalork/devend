/**
 * Step 2 of FENCE_TYPES_PLAN: the five slots beneath the board.
 *
 * A MODE selector, not a consumable bar. Everything below follows from that
 * distinction: there is no charge count, the selection persists until it is
 * changed, and slot 1 can never be emptied.
 *
 * The layout rules matter as much as the behaviour here. This sits directly
 * under a board whose bottom edge is where cuts are drawn, and the HUD budget
 * (hudBudget.test.tsx) exists because the bottom of the screen used to move
 * under the player's thumb. A bar that grew as types were acquired would do
 * exactly that, on the one screen where it costs a misdrawn fence.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FenceSlotBar } from "@/components/game/FenceSlotBar";
import { getAllFenceTypes, standardFenceType, FENCE_SLOTS } from "@/lib/fences";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * The slot buttons only.
 *
 * getAllByRole("button") also sweeps up the explainer's close button, because
 * the explainer AUTO-OPENS the first time a type is owned - which is correct
 * behaviour and would have made every count here one too high.
 */
const slots = () => [...document.querySelectorAll("[data-fence-slot]")];

const draw = (over: Partial<Parameters<typeof FenceSlotBar>[0]> = {}) => {
  const onSelect = vi.fn();
  render(
    <FenceSlotBar
      slotIds={[]}
      selectedId="standard"
      accentColor="#00ff88"
      onSelect={onSelect}
      {...over}
    />,
  );
  return { onSelect };
};

describe("the bar is always the same size", () => {
  it("draws five slots with nothing owned", () => {
    // Empties are DRAWN, not hidden. A bar that grew on acquisition would move
    // the board mid-run, and it would also leave a new player with a single
    // button that reads as decoration rather than as a system.
    draw();
    // The label runs through i18n, and the test t() echoes the key.
    const empties = screen.getAllByLabelText("fenceTypes.emptySlot");
    expect(slots().length + empties.length).toBe(FENCE_SLOTS);
    expect(slots()).toHaveLength(1);
  });

  it("draws five slots with everything owned", () => {
    const others = getAllFenceTypes().filter(f => f.id !== "standard").slice(0, 4).map(f => f.id);
    draw({ slotIds: others });
    expect(slots()).toHaveLength(FENCE_SLOTS);
    expect(screen.queryAllByLabelText("fenceTypes.emptySlot")).toHaveLength(0);
  });

  it("ignores a roster longer than the bar", () => {
    // A dev flag or a future store bug could hand over six. The bar must not
    // grow to fit them.
    const many = getAllFenceTypes().map(f => f.id);
    expect(many.length, "the catalogue got smaller than the bar").toBeGreaterThan(FENCE_SLOTS);
    draw({ slotIds: many });
    expect(slots()).toHaveLength(FENCE_SLOTS);
  });
});

describe("slot 1 is the ordinary fence, always", () => {
  it("shows standard even when the roster is empty", () => {
    draw();
    expect(screen.getByLabelText(standardFenceType().name)).toBeTruthy();
  });

  it("shows it first, whatever the roster says", () => {
    // The roster deliberately excludes standard, so a caller cannot displace
    // it, reorder it, or leave it out.
    draw({ slotIds: ["ice", "flare"] });
    expect(slots().map(b => b.getAttribute("aria-label"))[0]).toBe(standardFenceType().name);
  });

  it("cannot be pushed out by a roster that names it", () => {
    // Passing standard in the swappable list must not produce it twice.
    draw({ slotIds: ["standard", "ice"] });
    const names = slots().map(b => b.getAttribute("aria-label"));
    expect(names.filter(n => n === standardFenceType().name)).toHaveLength(1);
    expect(names, "the duplicate ate the slot ice should have had").toContain("Ice");
  });
});

describe("selecting is a mode, not a spend", () => {
  it("reports the tapped type", () => {
    const { onSelect } = draw({ slotIds: ["ice"] });
    fireEvent.pointerDown(screen.getByLabelText("Ice"));
    fireEvent.pointerUp(screen.getByLabelText("Ice"));
    expect(onSelect).toHaveBeenCalledWith("ice");
  });

  it("marks the selected slot, and only that one", () => {
    draw({ slotIds: ["ice", "flare"], selectedId: "ice" });
    expect(screen.getByLabelText("Ice").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Flare").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Standard").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows no charge count anywhere", () => {
    // The distinction from AbilityBar, which renders "x{count}". A number here
    // would say the type runs out, and the whole cost model is that it does
    // not: it is paid for in build speed, not in charges.
    const { container } = (() => { draw({ slotIds: ["ice", "flare"] }); return { container: document.body }; })();
    expect(container.textContent ?? "", "the slot bar grew a charge counter")
      .not.toMatch(/x\d/);
  });

  it("does not select on a long press", () => {
    // The press opens the explainer instead. Selecting as well would change
    // what the next cut draws every time the player asked what a slot does.
    vi.useFakeTimers();
    const { onSelect } = draw({ slotIds: ["ice"] });
    fireEvent.pointerDown(screen.getByLabelText("Ice"));
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.pointerUp(screen.getByLabelText("Ice"));
    expect(onSelect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("the explainer", () => {
  it("opens on a long press", () => {
    vi.useFakeTimers();
    draw({ slotIds: ["ice"] });
    fireEvent.pointerDown(screen.getByLabelText("Ice"));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.textContent).toContain("fenceTypes.staysSelected");
    vi.useRealTimers();
  });

  it("names what the type COSTS", () => {
    // Every special fence is paid for in build speed, and that is invisible on
    // the board until a ball is racing your cut - far too late to learn it.
    const src = read("src/components/game/FenceTypeInfoModal.tsx");
    expect(src).toContain("fenceTypes.buildsSlower");
    expect(src).toContain("fenceTypes.buildsFaster");
    expect(src, "the standard fence would claim to cost something")
      .toMatch(/buildSpeed === 1\) return null/);
  });

  it("has words in all three locales", () => {
    for (const lang of ["en", "es", "sv"]) {
      const node = JSON.parse(read(`src/i18n/locales/${lang}.json`)).fenceTypes as Record<string, string>;
      for (const key of ["buildsSlower", "buildsFaster", "staysSelected", "emptySlot"]) {
        expect(node?.[key], `${lang} is missing fenceTypes.${key}`).toBeTruthy();
      }
    }
  });
});

describe("the hold hint", () => {
  it("makes a holdable element look holdable", () => {
    // CLAUDE.md: press-and-hold is the house gesture, and an element that is
    // holdable has to read as holdable or nobody discovers it.
    const src = read("src/components/game/FenceSlotBar.tsx");
    expect(src, "the Info hint icon is gone").toMatch(/<Info /);
    expect(src).toMatch(/LONG_PRESS_MS = 450/);
  });
});
