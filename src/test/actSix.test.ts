/**
 * Act VI: Release (41-45). Everything under the clock, and the end.
 *
 * Like act V, each map stands on one relationship that drifts silently, so
 * each is pinned: the fast ground has to lie where the patrol sweeps, the gate
 * has to stand at the end of the launcher's lane, the wells have to cover the
 * two cheapest corners, the skill check has to keep its slack, and the last
 * boss has to carry everything.
 */
import { describe, it, expect } from "vitest";
import { resolveWinSpec, winSpecProblems, NO_RUN_RULES } from "@/lib/winSpec";
import type { LevelConfig, WallEntity } from "@/types/level";

import { LADDER, LADDER_END } from "./fixtures/maps";

const at = (n: number) => LADDER.find(l => l.level === n)!;
const ACT_VI = [41, 42, 43, 44, 45].map(at);
const PLAYABLE = ACT_VI.filter(l => !l.boss);
type Rect = { x: number; y: number; width: number; height: number; angle?: number };
const entity = <T,>(l: LevelConfig, id: string) => (l.entities ?? []).find(e => e.id === id) as unknown as T;

describe("the act exists and ends the ladder", () => {
  it("has all five maps, and 45 is the last", () => {
    for (const l of ACT_VI) expect(l, "a map is missing").toBeTruthy();
    expect(LADDER_END).toBe(45);
    expect(at(45).boss).toBeTruthy();
  });

  it("authors every playable win, keeps the clear in it, prices the rest, and leaves no back door", () => {
    for (const l of PLAYABLE) {
      const spec = resolveWinSpec(l, NO_RUN_RULES);
      expect(spec.authored, l.id).toBe(true);
      expect(spec.require.some(c => c.kind === "space"), l.id).toBe(true);
      expect(spec.alsoWinIf, l.id).toEqual([]);
      expect(winSpecProblems(spec, l), l.id).toEqual([]);
      for (const c of spec.require.filter(c => c.kind !== "space")) {
        expect(c.bonusPercent ?? 0, `${l.id} ${c.kind}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("41 puts the fast ground in the patrol's lane", () => {
  const l = at(41);

  it("builds fences faster across the band, not slower", () => {
    const z = l.fenceZones![0];
    expect(z.speed).toBeGreaterThan(1.5);
  });

  it("sweeps the patrol along that band", () => {
    const z = l.fenceZones![0];
    const p = entity<{ cy: number; axis: string }>(l, "patrol");
    expect(p.axis).toBe("horizontal");
    expect(p.cy).toBeGreaterThan(z.y);
    expect(p.cy).toBeLessThan(z.y + z.height);
  });

  it("asks for speed inside the clock", () => {
    const sc = resolveWinSpec(l, NO_RUN_RULES).require.find(c => c.kind === "speedClear");
    expect(sc?.kind === "speedClear" && sc.seconds).toBeLessThan(l.timeLimit!);
  });
});

describe("42 sorts the launch at the gate", () => {
  const l = at(42);

  it("lets only green through, and deals green, not first", () => {
    expect(entity<WallEntity>(l, "canary-gate").passTypes).toEqual(["green"]);
    expect(l.ballTypeIds).toContain("green");
    expect(l.ballTypeIds![0]).not.toBe("green");
  });

  it("aims the barrel off the level, so the bounced roster spreads", () => {
    // Fired dead level, the balls ping-ponged between the gate and the left
    // wall on one line for ever, and green, stacked last, never reached it.
    const barrel = entity<Rect>(l, "barrel");
    expect(Math.abs(barrel.angle ?? 0)).toBeGreaterThan(10);
  });

  it("gives the room a second, ordinary doorway", () => {
    // With the gate as the only door, a green ball locked anywhere else
    // stranded the box on 7 seeds of 16.
    const south = entity<Rect>(l, "room-south");
    expect(855 - (south.x + south.width)).toBeGreaterThanOrEqual(60);
  });

  it("keeps the room too big to lock by wandering in", () => {
    const box = (l.coloredAreas ?? []).find(a => a.required !== false)!;
    expect((box.width * box.height) / (810 * 810)).toBeGreaterThan(0.1);
  });
});

describe("43 pulls the balls out of the cheap corners", () => {
  const l = at(43);

  it("covers both top corners with a well pulling away from them", () => {
    const wells = l.gravityWells ?? [];
    expect(wells).toHaveLength(2);
    for (const w of wells) {
      expect(w.y).toBe(45);
      expect(w.pull).toBe("down");
    }
    expect(wells.some(w => w.x === 45) && wells.some(w => w.x + w.width === 855)).toBe(true);
  });

  it("never tilts, so the pull stays one pull", () => {
    expect(l.tiltChance).toBe(0);
  });
});

describe("44 keeps its slack", () => {
  const l = at(44);

  it("has two slabs for a clause that wants one, and a fuse on one of them", () => {
    const slabs = (l.entities ?? []).filter(e => (e as WallEntity).breakable && !(e as WallEntity).brittle);
    expect(slabs.length).toBeGreaterThanOrEqual(2);
    const smash = resolveWinSpec(l, NO_RUN_RULES).require.find(c => c.kind === "smashed");
    expect(smash?.kind === "smashed" && smash.count).toBe(1);
    expect(l.charges?.map(c => c.targetId)).toEqual(["plug"]);
  });

  it("asks for a delivery, a smash and the clear, under a budget", () => {
    const kinds = resolveWinSpec(l, NO_RUN_RULES).require.map(c => c.kind).sort();
    expect(kinds).toEqual(["delivered", "smashed", "space"]);
    expect(l.fenceBudget ?? 0).toBeGreaterThan(l.expectedCuts);
  });
});

describe("45 carries every idea a boss has had", () => {
  it("is a chained pair that takes two traps each, wipes the board and leaks minions", () => {
    const b = at(45).boss!.bossBall!;
    expect(b.count).toBe(2);
    expect(b.chained).toBe(true);
    expect(b.hp).toBe(2);
    expect(b.fenceWipeSeconds ?? 0).toBeGreaterThan(0);
    expect(b.spitIntervalSeconds ?? 0).toBeGreaterThan(0);
  });

  it("fences them in where the first boss was shipped", () => {
    const first = at(10).coloredAreas![0], last = at(45).coloredAreas![0];
    expect([last.x, last.y, last.width, last.height]).toEqual([first.x, first.y, first.width, first.height]);
  });
});
