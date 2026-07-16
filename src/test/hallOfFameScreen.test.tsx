/**
 * Performance Review screen (HIGHSCORES.md Phase B viewer): renders the
 * Top 10 ladder with build identity, archetype bests, deepest ascension and
 * map records; the welcome button only appears once a run has banked.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/i18n";
import { HallOfFameScreen } from "@/components/game/HallOfFameScreen";
import { WelcomeScreen } from "@/components/game/WelcomeScreen";
import { RunLedgerEntry } from "@/types/hallOfFame";
import { DEFAULT_META_STATS } from "@/types/metaProgression";

afterEach(cleanup);

const runs: RunLedgerEntry[] = [
  {
    score: 612, levelsCompleted: 22, ascensionDepth: 1,
    primaryTag: "lock", secondaryTag: "risk",
    capstoneId: "golden_handshake", capstoneName: "Golden Handshake",
    loadoutIds: ["crunch_time"], savedAt: 1752600000000,
  },
  {
    score: 431, levelsCompleted: 15, ascensionDepth: 0,
    primaryTag: null, secondaryTag: null,
    capstoneId: null, capstoneName: null, loadoutIds: [], savedAt: 1752500000000,
  },
];

describe("HallOfFameScreen", () => {
  it("renders the ladder with scores, build identity, depth and capstone", () => {
    render(
      <HallOfFameScreen
        topRuns={runs}
        archetypeBests={{ lock: 612, freeze: 200 }}
        mapHighscores={{ "level-1": 34, "level-10": 61, "level-2b": 40 }}
        metaStats={{ ...DEFAULT_META_STATS, deepestAscension: 2 }}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText("#1")).toBeTruthy();
    // 612h appears on the ladder AND as the lock archetype best.
    expect(screen.getAllByText("612h").length).toBe(2);
    expect(screen.getByText("431h")).toBeTruthy();
    expect(screen.getByText("Golden Handshake")).toBeTruthy();
    expect(screen.getByText(/Depth 1/)).toBeTruthy();
    // Generalist fallback for the tagless run.
    expect(screen.getByText(/Generalist/i)).toBeTruthy();
    // Archetype grid shows the empty slots too (6 tags, 2 with values).
    expect(screen.getByText("200h")).toBeTruthy();
    expect(screen.getAllByText("-").length).toBe(4);
    // Deepest ascension section.
    expect(screen.getByText("Deepest Ascension")).toBeTruthy();
    // Map records, naturally sorted (level-2b before level-10).
    const ids = screen.getAllByText(/^level-/).map(e => e.textContent);
    expect(ids).toEqual(["level-1", "level-2b", "level-10"]);
  });

  it("welcome shows the Records button only when a callback is provided", () => {
    const { rerender } = render(
      <WelcomeScreen onStartGame={vi.fn()} onTutorial={vi.fn()} onOptions={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: /Records/ })).toBeNull();

    rerender(
      <WelcomeScreen onStartGame={vi.fn()} onTutorial={vi.fn()} onOptions={vi.fn()} onHallOfFame={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /Records/ })).toBeTruthy();
  });
});
