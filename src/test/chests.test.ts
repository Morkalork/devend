/**
 * Treasure chests (destruct-ups, issue #38): the seeded, weighted reward roll
 * (hybrid authored pool) and the rubber-ball loot-gem physics.
 */
import { describe, it, expect } from "vitest";
import {
  rollChestReward,
  makeChestLoot,
  updateChestLoot,
  surfaceFloorUnder,
  chestLootAlpha,
  CHEST_REWARDS,
  ALL_CHEST_REWARD_IDS,
  LOOT_TTL_SECONDS,
} from "@/lib/chests";

/** Deterministic RNG (mulberry32) for repeatable rolls. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("chest reward roll", () => {
  it("only ever returns a known reward id", () => {
    const r = rng(1);
    for (let i = 0; i < 200; i++) {
      expect(ALL_CHEST_REWARD_IDS).toContain(rollChestReward(undefined, r));
    }
  });

  it("respects an authored pool (hybrid) and ignores unknown ids", () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const id = rollChestReward(["freezeAll", "slowAll", "nonsense"], r);
      expect(["freezeAll", "slowAll"]).toContain(id);
    }
  });

  it("an empty or all-invalid pool falls back to the full set", () => {
    const r = rng(3);
    expect(ALL_CHEST_REWARD_IDS).toContain(rollChestReward([], r));
    expect(ALL_CHEST_REWARD_IDS).toContain(rollChestReward(["bogus"], r));
  });

  it("is deterministic for a given seed (seeded daily/record runs stay identical)", () => {
    const a = Array.from({ length: 20 }, (() => { const g = rng(42); return () => rollChestReward(undefined, g); })());
    const b = Array.from({ length: 20 }, (() => { const g = rng(42); return () => rollChestReward(undefined, g); })());
    expect(a).toEqual(b);
  });

  it("weights matter: freezeAll (w3) is drawn more often than clearFences (w2)", () => {
    const r = rng(99);
    let freeze = 0, clear = 0;
    for (let i = 0; i < 6000; i++) {
      const id = rollChestReward(["freezeAll", "clearFences"], r);
      if (id === "freezeAll") freeze++; else if (id === "clearFences") clear++;
    }
    expect(freeze).toBeGreaterThan(clear); // 3:2 expected
  });

  it("every reward has a colour", () => {
    for (const id of ALL_CHEST_REWARD_IDS) {
      expect(CHEST_REWARDS[id].color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("surfaceFloorUnder", () => {
  it("returns the highest surface spanning x that sits below the point", () => {
    const segs = [
      { x1: 0, y1: 500, x2: 900, y2: 500 },   // low shelf across the board
      { x1: 400, y1: 300, x2: 500, y2: 300 },  // higher shelf, only x∈[400,500]
    ];
    // Above both: the higher (y=300) shelf is hit first.
    expect(surfaceFloorUnder(segs, 450, 100, 800)).toBe(300);
    // Below the higher shelf: it no longer counts, fall to the low one.
    expect(surfaceFloorUnder(segs, 450, 350, 800)).toBe(500);
    // Off to the side of the high shelf: only the low one spans x=200.
    expect(surfaceFloorUnder(segs, 200, 100, 800)).toBe(500);
  });

  it("ignores vertical segments (you can't rest on a wall's side) and falls back to floor", () => {
    const segs = [{ x1: 300, y1: 100, x2: 300, y2: 700 }]; // a vertical wall
    expect(surfaceFloorUnder(segs, 300, 50, 800)).toBe(800);
  });
});

describe("loot gem physics", () => {
  const flat = (floorY: number) => ({ segments: [], floorY });

  it("falls, bounces off the floor, and loses height each bounce (rubber ball)", () => {
    const world = flat(800);
    let loot = [makeChestLoot("l1", "freezeAll", 450, 400, 0)];
    loot[0].vx = 0; loot[0].vy = 0; // straight drop for a clean test
    let peaksAfterBounce: number[] = [];
    let bounced = 0, prevVy = 0;
    for (let s = 0; s < 400; s++) {
      prevVy = loot[0]?.vy ?? 0;
      loot = updateChestLoot(loot, 1 / 120, world, s / 120);
      if (loot.length === 0) break;
      // Detect a bounce: vy flipped from + (down) to - (up) at the floor.
      if (prevVy > 0 && loot[0].vy < 0) { bounced++; peaksAfterBounce.push(Math.abs(loot[0].vy)); }
    }
    expect(bounced).toBeGreaterThanOrEqual(2);            // it bounces multiple times
    // Each successive rebound is weaker (energy lost to restitution).
    for (let i = 1; i < peaksAfterBounce.length; i++) {
      expect(peaksAfterBounce[i]).toBeLessThan(peaksAfterBounce[i - 1]);
    }
  });

  it("settles on the floor and never sinks through it", () => {
    const world = flat(800);
    let loot = [makeChestLoot("l1", "slowAll", 450, 780, 0)];
    for (let s = 0; s < 600; s++) {
      loot = updateChestLoot(loot, 1 / 120, world, s / 120);
      if (loot.length === 0) break;
      if (loot[0]) expect(loot[0].y).toBeLessThanOrEqual(800 + 0.001);
    }
  });

  it("lands on the FIRST surface below it, not the distant floor", () => {
    // A horizontal obstacle top at y=500 spanning x∈[400,500]; floor far below.
    const world = {
      segments: [{ x1: 400, y1: 500, x2: 500, y2: 500 }],
      floorY: 800,
    };
    let loot = [makeChestLoot("l1", "clearFences", 450, 300, 0)];
    loot[0].vx = 0; loot[0].vy = 0; // straight drop onto the shelf
    // The deepest point it reaches is the surface it bounces on (it is culled
    // by its TTL before a rubber bounce fully settles, so track max-y instead).
    let deepest = 0;
    for (let s = 0; s < 400; s++) {
      loot = updateChestLoot(loot, 1 / 120, world, s / 120);
      if (loot.length === 0) break;
      deepest = Math.max(deepest, loot[0].y);
    }
    expect(deepest).toBeCloseTo(500, 0);       // bounced on the shelf, not the floor
    expect(deepest).toBeLessThan(800);
  });

  it("falls past a surface it is not above, down to the floor", () => {
    // The shelf is off to the side (x∈[600,700]); a gem at x=450 misses it.
    const world = {
      segments: [{ x1: 600, y1: 500, x2: 700, y2: 500 }],
      floorY: 800,
    };
    let loot = [makeChestLoot("l1", "freezeAll", 450, 300, 0)];
    loot[0].vx = 0; loot[0].vy = 0;
    let deepest = 0;
    for (let s = 0; s < 400; s++) {
      loot = updateChestLoot(loot, 1 / 120, world, s / 120);
      if (loot.length === 0) break;
      deepest = Math.max(deepest, loot[0].y);
    }
    expect(deepest).toBeCloseTo(800, 0);       // no shelf under it → floor
  });

  it("is culled once its lifetime elapses", () => {
    const world = flat(800);
    let loot = [makeChestLoot("l1", "freezeAll", 450, 400, 0)];
    loot = updateChestLoot(loot, 1 / 120, world, LOOT_TTL_SECONDS + 0.1);
    expect(loot.length).toBe(0);
  });

  it("fades out only in the final third of its life", () => {
    const g = makeChestLoot("l1", "freezeAll", 0, 0, 0);
    expect(chestLootAlpha(g, 0)).toBe(1);
    expect(chestLootAlpha(g, LOOT_TTL_SECONDS * 0.5)).toBe(1);
    expect(chestLootAlpha(g, LOOT_TTL_SECONDS * 0.9)).toBeLessThan(1);
    expect(chestLootAlpha(g, LOOT_TTL_SECONDS)).toBeCloseTo(0, 5);
  });
});
