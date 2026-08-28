/**
 * Tapping the map-rule banner opens Specs to the map rule.
 *
 * The banner exists because Technical Gravity was reported three times as a
 * malfunction: it bends every path on the board, and nothing on screen said so.
 * The banner names it and opens Specs for the detail. But the map rule sits
 * THIRD in that panel, inside ASSIGNMENT, behind the build and the objectives -
 * which is fine when you opened Specs to browse and useless when you tapped a
 * thing that said "Technical Gravity" precisely because you wanted to know what
 * Technical Gravity does. The player asked a question and got a table of
 * contents.
 *
 * So a panel opened FROM a question answers that question first, and the same
 * panel opened from the Specs button is unchanged.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@/i18n";
import { TopBarDetailsPanel } from "@/components/game/TopBarDetailsPanel";
import type { ActiveMapMutator } from "@/types/mapMutator";

afterEach(cleanup);

const MUTATOR = {
  id: "shifting-gravity",
  name: "Technical Gravity",
  description: "Everything is pulled one way.",
  clarify: "The pull turns as the map runs.",
  behavior: "gravity",
} as unknown as ActiveMapMutator;

function panel(over: Partial<React.ComponentProps<typeof TopBarDetailsPanel>> = {}) {
  return render(
    <TopBarDetailsPanel
      visible
      onClose={() => {}}
      levelNumber={12}
      cutsUsed={2}
      parCuts={6}
      lives={3}
      spaceRemaining={40}
      spaceRequired={20}
      lockedBalls={1}
      ownedUpgrades={[]}
      mapMutator={MUTATOR}
      {...over}
    />,
  );
}

/** Section headings, in the order the player scrolls through them. */
function headingOrder(): string[] {
  const scroll = document.querySelectorAll("section > p:first-child");
  return [...scroll].map(p => (p.textContent ?? "").trim()).filter(Boolean);
}

describe("opening Specs from the map-rule banner", () => {
  it("puts the map rule in the very first section", () => {
    // THE regression. Not "somewhere on the page" - first, because the whole
    // complaint is that the answer was below the fold behind two other topics.
    panel({ focus: "mapRule" });
    const headings = headingOrder();
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0], `sections were: ${headings.join(" | ")}`).toBe("Map rule");
  });

  it("shows the rule's name and what it does, not just its name", () => {
    // The banner already showed the name. Opening it has to add something.
    panel({ focus: "mapRule" });
    const first = document.querySelector("section")!;
    expect(within(first as HTMLElement).getByText("Technical Gravity")).toBeTruthy();
    expect(within(first as HTMLElement).getByText(/pulled one way/)).toBeTruthy();
    expect(within(first as HTMLElement).getByText(/turns as the map runs/)).toBeTruthy();
  });

  it("shows the rule exactly once", () => {
    // It is hoisted OUT of its usual home, not copied above it. Two identical
    // cards on one page reads as a bug, and is how the two copies drift.
    panel({ focus: "mapRule" });
    expect(screen.getAllByText("Technical Gravity")).toHaveLength(1);
    expect(screen.getAllByText(/pulled one way/)).toHaveLength(1);
  });
});

describe("opening Specs to browse", () => {
  it("leaves the map rule in its usual place, not first", () => {
    // The panel is still a table of contents when you opened it as one.
    panel({ focus: null });
    const headings = headingOrder();
    expect(headings[0]).not.toBe("Map rule");
    expect(headings).not.toContain("Map rule");
  });

  it("still shows the rule, once, further down", () => {
    panel({ focus: null });
    expect(screen.getAllByText("Technical Gravity")).toHaveLength(1);
  });

  it("is what an unfocused open defaults to", () => {
    // `focus` omitted entirely behaves as a browse rather than throwing or
    // hoisting something arbitrary.
    panel();
    expect(headingOrder()).not.toContain("Map rule");
  });
});

describe("a map with no rule", () => {
  it("shows no map-rule section even when one was asked for", () => {
    // The banner cannot be tapped on a map with no mutator, but the focus is a
    // prop and props outlive the thing that set them.
    panel({ focus: "mapRule", mapMutator: null });
    expect(headingOrder()).not.toContain("Map rule");
    expect(screen.queryByText("Technical Gravity")).toBeNull();
  });
});
