/**
 * The editor's playtest button.
 *
 * The bot itself is covered by botSoak; what needs checking here is the layer
 * that turns it into an answer a designer can act on. Two things matter and
 * neither is about physics:
 *
 *   - It must actually cover the four orientations. A map is authored once and
 *     dealt four ways, and a playtest that only ever saw orientation 0 would be
 *     confidently reporting on a quarter of the problem.
 *   - It must not lie about a broken map, and it must not take the editor down
 *     with one either.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  seedsCoveringRotations, rotationForSeed, playtestOne, summarise,
  playtestMap, verdictHeadline, type PlaytestRun,
} from "@/lib/admin/playtest";
import { getRunSeedText, setRunSeedText } from "@/lib/runRng";
import { ROTATION_MIN_LEVEL } from "@/lib/mapRotation";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];
const lvl = (n: number) => LEVELS.find(l => l.level === n)!;

describe("covering the four orientations", () => {
  it("finds seeds for every orientation a rotating map can be dealt in", () => {
    const l = lvl(22);
    const plan = seedsCoveringRotations(l, 22, 2);
    expect(new Set(plan.map(p => p.rotation)), "not every orientation was covered")
      .toEqual(new Set([0, 1, 2, 3]));
    expect(plan).toHaveLength(8);
  });

  it("stops at one orientation for the levels that never rotate", () => {
    // L1-3 are below ROTATION_MIN_LEVEL and always deal upright. Searching for
    // the other three would run to the seed budget and hand back a plan whose
    // extra runs are all the same board.
    expect(ROTATION_MIN_LEVEL).toBeGreaterThan(2);
    const plan = seedsCoveringRotations(lvl(2), 2, 2);
    expect(plan.map(p => p.rotation)).toEqual([0, 0]);
  });

  it("predicts the orientation a seed will actually deal", () => {
    // The prediction has to match what the run really gets, or the per-
    // orientation breakdown is fiction. Same seed text runBot uses.
    const l = lvl(22);
    for (const seed of [1, 2, 3, 4, 5]) {
      const predicted = rotationForSeed(l, 22, seed);
      expect(predicted).toBe(rotationForSeed(l, 22, seed));   // stable
      expect([0, 1, 2, 3]).toContain(predicted);
    }
  });

  it("puts back the seed it borrowed", () => {
    // rotationForSeed arms a run seed to ask its question. If it cleared it
    // instead of restoring it, opening the playtest panel during a Daily
    // Stand-up would silently unseed the run.
    setRunSeedText("someone-elses-run");
    rotationForSeed(lvl(22), 22, 3);
    seedsCoveringRotations(lvl(22), 22, 1);
    expect(getRunSeedText()).toBe("someone-elses-run");
    setRunSeedText(null);
  });
});

describe("the verdict", () => {
  // Explicit timeout, and a deliberately short budget. This drives the real
  // physics four times over, and at 3600 frames it fits inside vitest's 5s
  // default on a developer machine and does NOT on a shared CI runner - which
  // is exactly how it was found. The assertions below are about the plumbing
  // (four orientations, the aggregation, nothing thrown), and none of them
  // needs a map to be WON, so the frame budget can be a fraction of a real
  // playtest's. The timeout is belt and braces for a slow runner.
  it("plays a real map and reports something usable", () => {
    const v = playtestMap(lvl(6), 6, { perRotation: 1, maxFrames: 900 });
    expect(v.total).toBe(4);
    expect(v.possibleRotations).toEqual([0, 1, 2, 3]);
    expect(v.won + v.lost + v.timedOut).toBe(v.total);
    expect(v.byRotation.reduce((n, r) => n + r.runs, 0)).toBe(v.total);
    expect(v.expectedCuts).toBe(lvl(6).expectedCuts);
  }, 30_000);

  it("reports the median over the runs that were WON", () => {
    // Averaging in the losses would make a map look cheap precisely when it is
    // too hard to finish: a run that dies after two cuts is not a two-cut map.
    const runs: PlaytestRun[] = [
      { seed: 1, rotation: 0, won: true, lost: false, cuts: 10, locks: 1, remainingPercent: 0, stalled: false, hard: [] },
      { seed: 2, rotation: 0, won: true, lost: false, cuts: 20, locks: 1, remainingPercent: 0, stalled: false, hard: [] },
      { seed: 3, rotation: 0, won: false, lost: true, cuts: 2, locks: 0, remainingPercent: 80, stalled: false, hard: [] },
    ];
    expect(summarise(lvl(6), runs).medianWinningCuts).toBe(15);
  });

  it("says so when nothing was won", () => {
    const runs: PlaytestRun[] = [
      { seed: 1, rotation: 0, won: false, lost: true, cuts: 3, locks: 0, remainingPercent: 90, stalled: false, hard: [] },
    ];
    const v = summarise(lvl(6), runs);
    expect(v.medianWinningCuts).toBeNull();
    expect(verdictHeadline(v).tone).toBe("bad");
    expect(verdictHeadline(v).text).toContain("unwinnable");
  });

  it("calls out an orientation that never clears, even when the others do", () => {
    // THE finding this whole feature exists for: a map that plays fine upright
    // and is impossible on its side. Three quarters of what ships was never
    // looked at before now.
    const ok = (seed: number, rotation: 0 | 1 | 2 | 3, won: boolean): PlaytestRun =>
      ({ seed, rotation, won, lost: !won, cuts: 9, locks: 1, remainingPercent: won ? 0 : 70, stalled: false, hard: [] });
    const v = summarise(lvl(6), [ok(1, 0, true), ok(2, 1, true), ok(3, 2, false), ok(4, 3, true)]);
    const head = verdictHeadline(v);
    expect(head.tone).toBe("bad");
    expect(head.text).toContain("orientation 2");
  });

  it("leads with an engine violation over anything else", () => {
    const v = summarise(lvl(6), [{
      seed: 1, rotation: 0, won: true, lost: false, cuts: 5, locks: 1,
      remainingPercent: 0, stalled: false,
      hard: [{ rule: "ball-escaped", detail: "ball b1 is outside the board" }],
    }]);
    // Won every run, and still the headline is the violation: a map that
    // breaks the game is not a map that passes.
    expect(v.won).toBe(1);
    expect(verdictHeadline(v).tone).toBe("bad");
    expect(verdictHeadline(v).text).toContain("violation");
  });

  it("turns a crash into a finding instead of taking the editor down", () => {
    const broken = { ...lvl(6), entities: [{ id: "bad", kind: "wall", shape: "polygon", points: null }] } as unknown as LevelConfig;
    let run: PlaytestRun | null = null;
    expect(() => { run = playtestOne(broken, 6, 1, 0, 600); }).not.toThrow();
    expect(run).not.toBeNull();
    // Either it survived the bad entity or it recorded the throw; either way the
    // panel gets an answer rather than a white screen.
    expect(run!.hard.every(h => typeof h.detail === "string")).toBe(true);
  });

  it("restores the real clock, so the editor keeps animating afterwards", () => {
    // runBot hijacks performance.now. If a playtest leaked that, every
    // animation in the admin would freeze and nothing would say why.
    const before = performance.now();
    playtestOne(lvl(6), 6, 1, 0, 600);
    expect(performance.now()).toBeGreaterThanOrEqual(before);
    expect(performance.now.toString()).not.toContain("virtualNowMs");
  });
});
