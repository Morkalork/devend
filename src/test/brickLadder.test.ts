/**
 * The ladder started over for the brick pivot (BRICKS_PLAN.md).
 *
 * `public/map.yml` is the new ladder, built one map at a time; the 45 maps
 * that were there are in `public/maps-archive.yml`, unchanged, and open in the
 * Playground. These hold both halves: the archive is whole and still served,
 * and the two maps the new ladder starts with are what they were asked to be.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LADDER, ARCHIVE, byLevel } from "./fixtures/maps";
import { runBot } from "@/lib/bot/runBot";
import { plainModifiers } from "@/lib/bot/headlessGame";
import { getMapTimeLimit } from "@/lib/mapTiming";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { getActiveRuleSet, setActiveRuleSet } from "@/lib/cardRules";
import { getActiveRoster, setActiveRoster } from "@/lib/roster";
import type { LevelConfig } from "@/types/level";

const src = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("the archive", () => {
  it("is the 45 maps, in a file the game serves", () => {
    expect(existsSync(resolve(__dirname, "../../public/maps-archive.yml"))).toBe(true);
    expect(ARCHIVE).toHaveLength(45);
    expect(ARCHIVE.map(l => l.level)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
  });

  it("opens in the Playground, and is never saved from there", () => {
    const playground = src("components/admin/PlaygroundScreen.tsx");
    expect(playground).toMatch(/fetch\('\/maps-archive\.yml'\)/);
    expect(playground).toMatch(/archiveLevels\.map\(lvl =>/);
    // The two files share ids, so a save from an archived map would overwrite a ladder map.
    expect(playground).toMatch(/if \(!editDraft \|\| fromArchive\) return;/);
    expect(playground).toMatch(/disabled=\{editSaveStatus === 'saving' \|\| fromArchive\}/);
  });

  it("is not what a run is built from", () => {
    expect(src("hooks/useLevelManager.ts")).toMatch(/fetchConfig\('\/map\.yml'\)/);
    expect(src("hooks/useLevelManager.ts")).not.toMatch(/maps-archive/);
  });
});

describe("the new ladder", () => {
  it("is numbered from 1 with no gaps, and every map states its premise", () => {
    expect(LADDER.map(l => l.level)).toEqual(LADDER.map((_, i) => i + 1));
    for (const l of LADDER) {
      expect(l.premise, `${l.id} has no premise`).toMatch(/^The one where /);
      expect(l.premise).not.toContain("—");
    }
  });

  it("keeps the old first map exactly as it was", () => {
    expect(byLevel(LADDER, 1)).toEqual(byLevel(ARCHIVE, 1));
  });
});

describe("map 2: nine bricks, one ball, thirty seconds", () => {
  const map = byLevel(LADDER, 2) as LevelConfig;
  const bricks = (map.entities ?? []) as { id: string; x: number; y: number; width: number; height: number; brittle?: boolean }[];

  it("is a 3x3 block of one-touch bricks in the middle of an otherwise empty board", () => {
    expect(bricks).toHaveLength(9);
    expect(bricks.every(b => b.brittle === true)).toBe(true);
    expect(new Set(bricks.map(b => b.x)).size).toBe(3);
    expect(new Set(bricks.map(b => b.y)).size).toBe(3);
    const cx = (Math.min(...bricks.map(b => b.x)) + Math.max(...bricks.map(b => b.x + b.width))) / 2;
    const cy = (Math.min(...bricks.map(b => b.y)) + Math.max(...bricks.map(b => b.y + b.height))) / 2;
    expect(cx).toBe(450);
    expect(cy).toBe(450);
    // The gap rule (MAP_DESIGN_CARD.md, section 5): 12 or less, or 60 or more.
    const xs = [...new Set(bricks.map(b => b.x))].sort((a, b) => a - b);
    const ys = [...new Set(bricks.map(b => b.y))].sort((a, b) => a - b);
    expect(xs[1] - xs[0] - bricks[0].width).toBeLessThanOrEqual(12);
    expect(ys[1] - ys[0] - bricks[0].height).toBeLessThanOrEqual(12);
  });

  it("is won by breaking seven of the nine (two spare), and by nothing else", () => {
    expect(map.win?.require).toEqual([{ kind: "smashed", count: 7, of: "shards" }]);
    expect(resolveWinSpec(map, NO_RUN_RULES).authored).toBe(true);
    expect(map.maxBalls).toBe(2);
  });

  it("runs a thirty-second clock, though it is in the tutorial band", () => {
    expect(map.timeLimit).toBe(30);
    expect(getMapTimeLimit(map, 2)).toBe(30);
  });

  // The lesson, measured as the ladder is played: under the tree, with the
  // one ball a run starts with (weight, the trait the map is for). The open
  // board does not get there in time, and fencing the ball in does. Sixteen
  // seeds each, the bot's own plain fences.
  const play = (cutEvery: number) => {
    const rules = getActiveRuleSet();
    const roster = getActiveRoster();
    setActiveRuleSet("tree");
    setActiveRoster([{ slot: 1, rungs: { weight: 1 } }]);
    try {
      return Array.from({ length: 16 }, (_, i) => runBot(map, 2, i + 1, {
        modifiers: plainModifiers(), maxFrames: Math.ceil(35 / PHYSICS_STEP), cutEvery, lives: 3,
      }));
    } finally {
      setActiveRuleSet(rules);
      setActiveRoster(roster);
    }
  };

  it("is almost never cleared without a fence", () => {
    // One lucky ball in sixteen, in the last seconds: the open board is a
    // gamble against the clock, never a plan.
    const runs = play(1e9);
    expect(runs.filter(r => r.won).length).toBeLessThanOrEqual(2);
    expect(runs.filter(r => !r.won).every(r => r.failKind === "timeUp")).toBe(true);
  });

  it("is usually cleared with fences, inside the clock", () => {
    // Measured 13 of 16 (2026-11-24); the losses are bricks walled off.
    const wins = play(45).filter(r => r.won);
    expect(wins.length).toBeGreaterThanOrEqual(10);
    for (const r of wins) {
      expect(r.frames * PHYSICS_STEP).toBeLessThanOrEqual(30);
    }
  });
});

describe("the device check", () => {
  it("measures a phone on the archived maps it was tuned on", async () => {
    const { DEVICE_CHECK_LEVELS } = await import("@/lib/deviceCheck/model");
    expect(src("components/admin/DeviceCheckScreen.tsx")).toMatch(/fetch\('\/maps-archive\.yml'\)/);
    for (const n of DEVICE_CHECK_LEVELS) {
      expect(byLevel(ARCHIVE, n), `archive has no level ${n}`).toBeDefined();
    }
  });
});
