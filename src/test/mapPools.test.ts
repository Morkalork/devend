/**
 * mapPools — shared per-map catalogue selection helpers (#53/#54/#55 refactor).
 * The subtle "none bucket" weighted draw and the level-eligibility gate live
 * here now, so they get one focused test instead of three near-copies.
 */
import { describe, it, expect } from "vitest";
import { createRng } from "@/lib/runRng";
import { eligibleByLevel, weightedPick, finiteOrUndefined } from "@/lib/mapPools";

type W = { id?: number | string; weight?: number };

describe("eligibleByLevel", () => {
  const pool = [
    { id: "a" },
    { id: "b", minLevel: 15 },
    { id: "c", maxLevel: 12 },
  ] as Array<{ id: string; minLevel?: number; maxLevel?: number }>;

  it("gates everything below the floor", () => {
    expect(eligibleByLevel(9, pool, 11)).toEqual([]);
  });
  it("applies per-entry min/max around the floor default", () => {
    expect(eligibleByLevel(11, pool, 11).map(e => e.id)).toEqual(["a", "c"]); // b needs 15, c caps at 12
    expect(eligibleByLevel(13, pool, 11).map(e => e.id)).toEqual(["a"]);       // c excluded (>12)
    expect(eligibleByLevel(15, pool, 11).map(e => e.id)).toEqual(["a", "b"]);
  });
});

describe("weightedPick", () => {
  it("returns null on an empty pool or all-zero weights", () => {
    expect(weightedPick([] as W[], 0, createRng("x"))).toBeNull();
    expect(weightedPick([{ weight: 0 }] as W[], 0, createRng("x"))).toBeNull();
  });
  it("with noneWeight 0 always returns an item", () => {
    const items: W[] = [{ id: 1 }, { id: 2 }];
    for (const s of ["a", "b", "c", "d", "e"]) {
      expect(weightedPick(items, 0, createRng(s))).not.toBeNull();
    }
  });
  it("never picks a zero-weight entry", () => {
    const items: W[] = [{ id: "banned", weight: 0 }, { id: "ok", weight: 1 }];
    for (const s of ["a", "b", "c", "d", "e", "f"]) {
      expect(weightedPick(items, 0, createRng(s))?.id).toBe("ok");
    }
  });
  it("a large none bucket sometimes yields null", () => {
    const items: W[] = [{ id: 1 }];
    const outs = ["a", "b", "c", "d", "e", "f", "g", "h"].map(s => weightedPick(items, 100, createRng(s)));
    expect(outs.some(o => o === null)).toBe(true);
  });
  it("is deterministic for a given rng", () => {
    const items: W[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(weightedPick(items, 1, createRng("seed"))).toEqual(weightedPick(items, 1, createRng("seed")));
  });
});

describe("finiteOrUndefined", () => {
  it("passes finite numbers and rejects the rest", () => {
    expect(finiteOrUndefined(3)).toBe(3);
    expect(finiteOrUndefined("5")).toBe(5);
    expect(finiteOrUndefined(undefined)).toBeUndefined();
    expect(finiteOrUndefined("nope")).toBeUndefined();
    expect(finiteOrUndefined(NaN)).toBeUndefined();
  });
});
