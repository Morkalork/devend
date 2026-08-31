/**
 * The three panels the map builder grew, checked on what they promise.
 *
 * The engines behind them are tested elsewhere (playtest.test.ts,
 * mechanicSpread.test.ts). What is left is the part only rendering shows: does
 * the panel tell the truth about the map in front of it, and does it stop
 * telling the OLD truth when that map changes.
 *
 * That last one is the real risk. A playtest result is expensive to produce and
 * cheap to leave on screen, and a green "won 8 of 8" sitting above a map that
 * has been edited underneath it is worse than no playtest at all: it is a
 * confident answer to a question nobody asked any more.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { PlaytestPanel } from "@/components/admin/PlaytestPanel";
import { RotationStrip } from "@/components/admin/RotationStrip";
import { MechanicSpreadPanel } from "@/components/admin/MechanicSpreadPanel";
import { ROTATION_MIN_LEVEL } from "@/lib/mapRotation";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];
const lvl = (n: number) => LEVELS.find(l => l.level === n)!;

describe("the orientations strip", () => {
  it("shows all four boards for a map that rotates", () => {
    // The whole point: three quarters of what ships was never on screen.
    render(<RotationStrip level={lvl(22)} />);
    expect(screen.getByText("upright")).toBeTruthy();
    expect(screen.getByText("90°")).toBeTruthy();
    expect(screen.getByText("180°")).toBeTruthy();
    expect(screen.getByText("270°")).toBeTruthy();
  });

  it("shows one board for the levels that never rotate, and says why", () => {
    // Drawing four identical thumbnails for level 2 would be a lie of a
    // different kind - implying variety the player will never see.
    expect(lvl(2).level).toBeLessThan(ROTATION_MIN_LEVEL);
    render(<RotationStrip level={lvl(2)} />);
    expect(screen.getByText("upright")).toBeTruthy();
    expect(screen.queryByText("90°")).toBeNull();
    expect(screen.getByText(/always dealt upright/)).toBeTruthy();
  });

  it("survives a canvas it cannot get a context from", () => {
    // jsdom hands back null for getContext('2d'), and so does a browser under
    // memory pressure. The panel must render regardless.
    expect(() => render(<RotationStrip level={lvl(6)} />)).not.toThrow();
  });
});

describe("the mechanics panel", () => {
  it("names the mechanics the current map actually uses", () => {
    // Level 6 is the bent Legacy Wall: a breakable, and now a bend.
    render(<MechanicSpreadPanel levels={LEVELS} current={lvl(6)} />);
    // getAllByText, not getByText: each of these appears twice on purpose -
    // once as a chip for this map and once in the warnings below, because
    // "Bent shape" is currently single-use and level 6 is where it is used.
    expect(screen.getAllByText(/Breakable/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bent shape/).length).toBeGreaterThan(0);
  });

  it("says so plainly when a map uses no headline mechanic", () => {
    const bare = { id: "bare", level: 1, entities: [] } as unknown as LevelConfig;
    render(<MechanicSpreadPanel levels={[bare]} current={bare} />);
    expect(screen.getByText(/no headline mechanic yet/)).toBeTruthy();
  });

  it("surfaces the single-use warnings rather than hiding them behind a toggle", () => {
    // These are the findings the panel exists for, so they must be visible in
    // the default view, not one click away.
    render(<MechanicSpreadPanel levels={LEVELS} current={lvl(6)} />);
    // Three of them today (bend, threadLock, mutator), so this is plural.
    expect(screen.getAllByText(/introduced and never developed/).length).toBeGreaterThan(0);
  });

  it("does not fall over on a level outside every act", () => {
    // actOf returns null for a level number off the ladder, and the panel
    // indexes ACTS with the result.
    const stray = { id: "x", level: 99, entities: [] } as unknown as LevelConfig;
    expect(() => render(<MechanicSpreadPanel levels={LEVELS} current={stray} />)).not.toThrow();
  });
});

describe("the playtest panel", () => {
  it("offers to play and reports nothing until it has", () => {
    render(<PlaytestPanel level={lvl(6)} />);
    expect(screen.getByText(/Play this map/)).toBeTruthy();
    // No verdict, no counts, no stale anything.
    expect(screen.queryByText(/^Won$/)).toBeNull();
  });

  it("drops its results when the map underneath it changes", async () => {
    // THE dangerous case. A verdict describes ONE version of a map; leaving it
    // up after an edit is a confident answer to a question nobody asked.
    //
    // This has to actually PLAY first. The obvious version of this test - render,
    // rerender with a different level, assert no results - passes whether or not
    // the invalidation exists, because there were never any results to clear.
    // Verified by deleting the effect: it stayed green. So the test drives the
    // panel to a real verdict before changing the map under it.
    //
    // Level 2 is used because it never rotates, so the plan is two games rather
    // than eight and the test stays quick.
    vi.useFakeTimers();
    try {
      const { rerender } = render(<PlaytestPanel level={lvl(2)} />);
      await act(async () => { fireEvent.click(screen.getByText(/Play this map/)); });

      // One game per timer tick; a handful of ticks drains a two-game plan.
      for (let i = 0; i < 8; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      }
      expect(screen.queryByText("By orientation"), "the playtest never produced a verdict, so this test cannot see the bug it is for").not.toBeNull();

      await act(async () => { rerender(<PlaytestPanel level={lvl(6)} />); });
      expect(screen.queryByText("By orientation")).toBeNull();
      expect(screen.queryByText(/Bot needed a median/)).toBeNull();
      expect(screen.getByText(/Play this map/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders for a level that cannot rotate without asking for four orientations", () => {
    expect(() => render(<PlaytestPanel level={lvl(2)} />)).not.toThrow();
  });
});
