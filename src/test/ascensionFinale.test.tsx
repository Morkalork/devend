/**
 * The screen you get for beating the game.
 *
 * Two things were wrong with it, and they are the same thing twice: the finale
 * did not behave like one.
 *
 *   - It was not the FIRST thing after the last map. Level 35 is a multiple of
 *     the assignment cadence, so beating the game opened a contract report card
 *     and then a 1-of-3 upgrade pick, and only then said anything about having
 *     won. Two admin screens between the last ball and the win.
 *
 *   - It asked the player to ascend without saying what ascending DOES. The
 *     ladder rung a depth imposes was announced on the far side of the choice,
 *     when they landed on level 1 of the new loop, so "Ascend to Depth 4" was
 *     agreed to blind and explained afterwards.
 *
 * The rung text itself lives in loadouts.yml and is already covered by
 * ascensionLadder.test.ts. What is asserted here is that the finale SHOWS it,
 * beside the button, before the decision.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AscensionDraftScreen } from "@/components/game/AscensionDraftScreen";
import type { AscensionRung } from "@/types/loadout";
import type { LoadoutConfig } from "@/types/loadout";

/**
 * A stand-in `t` that honours `defaultValue`, because the content accessors
 * depend on it: contentText.rungName asks for `content.ascensionRungs.<depth>.
 * name` and falls back to the YAML name, so a mock that returns the key for
 * everything renders the key and the test proves nothing about the rung.
 * Chrome keys (no defaultValue) still come back as `key:vars`, which keeps the
 * assertions above readable and independent of the English wording.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars && "defaultValue" in vars) return vars.defaultValue as string;
      return vars ? `${key}:${Object.values(vars).join(",")}` : key;
    },
  }),
}));

const LADDER: AscensionRung[] = [
  { depth: 1, name: "Hiring Freeze", description: "The store opens every other level." },
  { depth: 2, name: "Reduced Headcount", description: "Assignments offer two contracts, not three." },
  { depth: 3, name: "Promotion Freeze", description: "No Promotion is awarded this run." },
];

const LOADOUTS: LoadoutConfig[] = [];

const finale = (over: Record<string, unknown> = {}) =>
  render(
    <AscensionDraftScreen
      loadouts={LOADOUTS}
      draftedLoadoutIds={[]}
      ascensionDepth={0}
      ladder={LADDER}
      totalScore={420}
      onAscend={() => {}}
      onRetire={() => {}}
      {...over}
    />,
  );

describe("it congratulates the player for winning", () => {
  it("leads with the win, not with an inventory of what is left to do", () => {
    finale();
    expect(screen.getByText("ascension.youWin")).toBeTruthy();
    expect(screen.getByText("ascension.congrats")).toBeTruthy();
  });

  it("says so again for a player who won at depth", () => {
    finale({ ascensionDepth: 2 });
    expect(screen.getByText("ascension.congratsAscended:2")).toBeTruthy();
    expect(screen.queryByText("ascension.congrats")).toBeNull();
  });
});

describe("it says what ascending would do, before the choice", () => {
  it("names the rung the next depth switches on, and describes it", () => {
    finale({ ascensionDepth: 0 });
    // Depth 0 -> ascending enters depth 1.
    expect(screen.getByText("ascension.whatDepthAdds:1")).toBeTruthy();
    expect(screen.getByText("Hiring Freeze")).toBeTruthy();
    expect(screen.getByText("The store opens every other level.")).toBeTruthy();
  });

  it("moves on to the next rung at the next depth", () => {
    finale({ ascensionDepth: 2 });
    expect(screen.getByText("ascension.whatDepthAdds:3")).toBeTruthy();
    expect(screen.getByText("Promotion Freeze")).toBeTruthy();
    expect(screen.getByText("No Promotion is awarded this run.")).toBeTruthy();
  });

  it("reminds the player what is already in force, without re-describing it", () => {
    finale({ ascensionDepth: 2 });
    // Named, not described: the rungs below are context, not the question.
    expect(screen.getByText(/ascension\.alsoInForce:Hiring Freeze, Reduced Headcount/)).toBeTruthy();
    expect(screen.queryByText("The store opens every other level.")).toBeNull();
  });

  it("says nothing is added once the ladder is fully climbed", () => {
    // Past the end there is no new rung, and promising one would be a lie.
    finale({ ascensionDepth: LADDER.length });
    expect(screen.getByText("ascension.noNewRung")).toBeTruthy();
  });

  it("still renders with no ladder loaded at all", () => {
    // loadouts.yml can fail to load; the finale must not take the win with it.
    finale({ ladder: [] });
    expect(screen.getByText("ascension.youWin")).toBeTruthy();
    expect(screen.getByText("ascension.noNewRung")).toBeTruthy();
  });
});
