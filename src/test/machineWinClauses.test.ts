/**
 * The two clauses the win vocabulary was missing.
 *
 * The Engagement axis has always measured five families of map content -
 * breakables, colored zones, delivery boxes, circuit terminals and data-stream
 * seams - while the win could only NAME three of them. So the game scored a
 * kind of play it could not require: a wiring map's whole premise is that a
 * fence spent lighting a terminal is one you cannot seal with, and the win had
 * no way to ask for a single terminal.
 *
 * Both counters already existed (`lit` per terminal, one `harvested` flag per
 * seam segment), which is the test for whether a clause is real: it reads
 * something the game already keeps rather than inventing a fact to count.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWinCondition, winSpecProblems, winReasonFor } from "@/lib/winSpec";
import { winHighlightRects } from "@/lib/winHighlight";
import type { WinSnapshot, WinSpec } from "@/types/winSpec";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 50, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, delivered: 0, smashed: 0, terminals: 0, harvested: 0,
  bossDefeated: false, allLocked: false, cuts: 0, par: 6, activeSeconds: 0,
  ...over,
});

const spec = (require: WinSpec["require"]): WinSpec =>
  ({ require, alsoWinIf: [], authored: true });

describe("lighting the circuit", () => {
  it("counts lit terminals against the target", () => {
    const p = evaluateWinCondition({ kind: "terminals", count: 2 }, snap({ terminals: 1 }));
    expect(p).toMatchObject({ current: 1, target: 2, met: false, mode: "accumulate" });
    expect(evaluateWinCondition({ kind: "terminals", count: 2 }, snap({ terminals: 2 })).met)
      .toBe(true);
  });

  it("flags a map asked for more terminals than it has", () => {
    // An unwinnable map is SILENT - it simply never finishes - which is the
    // whole reason winSpecProblems exists.
    const level = { circuit: { terminals: [{}, {}] } } as unknown as LevelConfig;
    expect(winSpecProblems(spec([{ kind: "terminals", count: 3 }]), level).join(" "))
      .toMatch(/but the map has 2/);
    expect(winSpecProblems(spec([{ kind: "terminals", count: 2 }]), level)).toEqual([]);
  });

  it("flags a terminals clause on a map with no circuit at all", () => {
    expect(winSpecProblems(spec([{ kind: "terminals", count: 1 }]), {} as LevelConfig).join(" "))
      .toMatch(/but the map has 0/);
  });

  it("reports wiring as its own win reason", () => {
    // Not "cleared to target": a wiring win is a different thing to have done,
    // and the results screen and the highscore ledger both store this.
    expect(winReasonFor(spec([{ kind: "terminals", count: 1 }]), snap({ terminals: 1 })))
      .toBe("wired");
  });

  it("points the map-open pulse at the terminals still dark", () => {
    const rects = winHighlightRects(spec([{ kind: "terminals", count: 2 }]), {
      circuit: { terminals: [
        { x: 100, y: 100, radius: 20, lit: false, ballId: "a" },
        { x: 300, y: 300, radius: 20, lit: true, ballId: "b" },
      ] },
    } as unknown as CanvasGameState);
    // Only the unlit one: a ring around a terminal already lit would be telling
    // the player to do something they have done.
    expect(rects).toEqual([{ x: 80, y: 80, width: 40, height: 40 }]);
  });
});

describe("harvesting the stream", () => {
  it("counts harvested segments against the target", () => {
    expect(evaluateWinCondition({ kind: "harvested", count: 3 }, snap({ harvested: 3 })).met)
      .toBe(true);
    expect(evaluateWinCondition({ kind: "harvested", count: 3 }, snap({ harvested: 2 })).met)
      .toBe(false);
  });

  it("counts SEGMENTS, so a 4-point path offers three", () => {
    // The runtime flags one per segment, and a path of N points has N-1 of
    // them. Reading the point count would let a map ask for one more seam than
    // it has and never finish.
    const level = {
      dataStream: { path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] },
    } as unknown as LevelConfig;
    expect(winSpecProblems(spec([{ kind: "harvested", count: 3 }]), level)).toEqual([]);
    expect(winSpecProblems(spec([{ kind: "harvested", count: 4 }]), level).join(" "))
      .toMatch(/stream has 3/);
  });

  it("rings the seam once rather than once per segment", () => {
    // A stream is a lane you run a fence ALONG. Eight rings down its length
    // would read as eight separate things to do.
    const rects = winHighlightRects(spec([{ kind: "harvested", count: 2 }]), {
      dataStream: { path: [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 250 }] },
    } as unknown as CanvasGameState);
    expect(rects).toEqual([{ x: 100, y: 100, width: 300, height: 150 }]);
  });

  it("reports harvesting as its own win reason", () => {
    expect(winReasonFor(spec([{ kind: "harvested", count: 1 }]), snap({ harvested: 1 })))
      .toBe("harvested");
  });
});

describe("the clauses read what the game already keeps", () => {
  /**
   * The point of the whole addition. A clause that needed a NEW counter would
   * be a second copy of a fact, kept in step by every path that can light a
   * terminal or harvest a seam - and one of those forgetting is a silent
   * scoring bug. These read the same runtime lists the Engagement axis reads.
   */
  it("derives both from the runtime lists, not from a tally", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/physics/applyCut.ts"), "utf8");
    expect(src).toContain("(game.circuit?.terminals ?? []).filter(t => t.lit).length");
    expect(src).toContain("(game.dataStream?.harvested ?? []).filter(Boolean).length");
  });
});
